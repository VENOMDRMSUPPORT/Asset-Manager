import { randomUUID } from "crypto";

export type TaskStatus = "pending" | "running" | "done" | "error";

export type AgentEventType =
  | "status"
  | "thought"
  | "file_read"
  | "file_write"
  | "command"
  | "command_output"
  | "error"
  | "done"
  /** Emitted once at task start with the resolved execution profile (category, caps). */
  | "route"
  /** Emitted after the planning phase with the structured execution plan. */
  | "plan"
  /**
   * Emitted at task completion when the task wrote at least one file.
   * Contains a serialised CheckpointSummary — file list, status, timestamps.
   * The operator can call POST /api/agent/tasks/:id/discard to revert all changes,
   * or POST /api/agent/tasks/:id/apply to mark them as permanently accepted.
   */
  | "checkpoint"
  /**
   * Emitted at every task exit path (done, error, cancel, maxSteps).
   * Contains a structured payload with step usage, gate telemetry, and phase.
   */
  | "execution_summary";

export interface AgentEvent {
  type: AgentEventType;
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export interface TaskCompletion {
  summary: string;
  changed_files: string[];
  commands_run: string[];
  final_status: "complete" | "partial" | "blocked";
  remaining: string;
}

export interface TaskFailureDetail {
  title: string;
  detail: string;
  step: string;
  category:
    | "model"
    | "missing_api_key"
    | "invalid_api_key"
    | "model_not_found"
    | "insufficient_balance"
    | "rate_limit"
    | "network_error"
    | "base_url_error"
    | "context_length"
    | "tool"
    | "command"
    | "workspace"
    | "orchestration"
    | "cancelled";
}

export type VisionStatus = "success" | "degraded" | "unavailable";

export interface AgentTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: Date;
  completedAt?: Date;
  durationMs?: number;
  events: AgentEvent[];
  summary?: string;
  completion?: TaskCompletion;
  failureDetail?: TaskFailureDetail;
  /** Number of images attached to this task (0 = text-only). Persisted. */
  imageCount?: number;
  /** What happened with visual analysis for this task. Persisted. */
  visionStatus?: VisionStatus;
  /** How the visual intent was classified for this task. */
  visualIntent?: string;
}

// Serialisable summary used for the task list endpoint and persistence.
// Excludes the (potentially large) events array.
export type AgentTaskSummary = Omit<AgentTask, "events">;

// Per-task event cap — prevents unbounded memory growth on long-running tasks.
const MAX_EVENTS_PER_TASK = 300;

const tasks = new Map<string, AgentTask>();
const taskControllers = new Map<string, AbortController>();

// ─── Persistence hook ─────────────────────────────────────────────────────────
// Populated by taskPersistence.ts at startup so the session manager never
// imports persistence directly (avoids circular deps and keeps concerns clean).
let _onTaskCompleted: ((task: AgentTaskSummary) => void) | null = null;

export function registerTaskCompletionHook(fn: (task: AgentTaskSummary) => void): void {
  _onTaskCompleted = fn;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createTask(prompt: string): AgentTask {
  const task: AgentTask = {
    id: randomUUID(),
    prompt,
    status: "pending",
    createdAt: new Date(),
    events: [],
  };
  tasks.set(task.id, task);
  return task;
}

/**
 * Set image/vision metadata on a task immediately after creation.
 * Called by agentLoop before the async agent loop begins.
 */
export function setTaskMeta(taskId: string, meta: { imageCount?: number; visionStatus?: VisionStatus; visualIntent?: string }): void {
  const task = tasks.get(taskId);
  if (!task) return;
  if (meta.imageCount     !== undefined) task.imageCount    = meta.imageCount;
  if (meta.visionStatus   !== undefined) task.visionStatus  = meta.visionStatus;
  if (meta.visualIntent   !== undefined) task.visualIntent  = meta.visualIntent;
}

export function createTaskController(taskId: string): AbortController {
  const controller = new AbortController();
  taskControllers.set(taskId, controller);
  return controller;
}

export function getTaskSignal(taskId: string): AbortSignal | undefined {
  return taskControllers.get(taskId)?.signal;
}

export function isTaskCancelled(taskId: string): boolean {
  return taskControllers.get(taskId)?.signal.aborted ?? false;
}

export function cancelTask(taskId: string): boolean {
  const controller = taskControllers.get(taskId);
  const task = tasks.get(taskId);
  if (!controller || !task || task.status !== "running") return false;
  controller.abort();
  return true;
}

export function cleanupTaskController(taskId: string): void {
  taskControllers.delete(taskId);
}

export function getTask(id: string): AgentTask | undefined {
  return tasks.get(id);
}

/** Full task list including events (kept for internal use and single-task fetch). */
export function listTasks(): AgentTask[] {
  return Array.from(tasks.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

/**
 * Slim task list without events — used for the /api/agent/tasks list endpoint.
 * Keeps response payloads small; consumers fetch events on demand via /tasks/:id.
 */
export function listTasksSummary(): AgentTaskSummary[] {
  return listTasks().map(({ events: _events, ...summary }) => summary);
}

/** Return stored events for a specific task (may be empty if task not found). */
export function getTaskEvents(taskId: string): AgentEvent[] {
  return tasks.get(taskId)?.events ?? [];
}

export function deleteTask(taskId: string): boolean {
  const task = tasks.get(taskId);
  if (!task) return false;
  if (task.status === "running") {
    cancelTask(taskId);
  }
  tasks.delete(taskId);
  taskControllers.delete(taskId);
  return true;
}

/** Returns all task summaries (no events) — used by diagnostics and settings. */
export function getAllTaskSummaries(): AgentTaskSummary[] {
  return listTasksSummary();
}

/** Remove every non-running task from memory. Running tasks are unaffected. */
export function clearAllTasks(): void {
  for (const [id, task] of tasks.entries()) {
    if (task.status !== "running") {
      tasks.delete(id);
      taskControllers.delete(id);
    }
  }
}

export function addEvent(
  taskId: string,
  type: AgentEventType,
  message: string,
  data?: Record<string, unknown>
): AgentEvent {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const event: AgentEvent = { type, message, data, timestamp: new Date() };

  // Cap events to prevent unbounded memory growth on very long tasks
  if (task.events.length < MAX_EVENTS_PER_TASK) {
    task.events.push(event);
  }
  // Still return the event even if not stored (it will still be broadcast via WS)

  return event;
}

/** Hydrate a completed task from persisted data (used on server start). */
export function hydratePersistedTask(summary: AgentTaskSummary): void {
  if (tasks.has(summary.id)) return; // already in memory (e.g. from this session)
  const task: AgentTask = { ...summary, events: [] };
  tasks.set(task.id, task);
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  summary?: string,
  completion?: TaskCompletion,
  failureDetail?: TaskFailureDetail
): void {
  const task = tasks.get(taskId);
  if (!task) return;

  task.status = status;
  if (status === "done" || status === "error") {
    task.completedAt = new Date();
    task.durationMs = task.completedAt.getTime() - task.createdAt.getTime();
    cleanupTaskController(taskId);
  }
  if (summary !== undefined) task.summary = summary;
  if (completion !== undefined) task.completion = completion;
  if (failureDetail !== undefined) task.failureDetail = failureDetail;

  // Notify the persistence layer when a task completes or errors
  if ((status === "done" || status === "error") && _onTaskCompleted) {
    const { events: _events, ...taskSummary } = task;
    try {
      _onTaskCompleted(taskSummary);
    } catch {
      // Persistence errors must never crash the session manager
    }
  }
}
