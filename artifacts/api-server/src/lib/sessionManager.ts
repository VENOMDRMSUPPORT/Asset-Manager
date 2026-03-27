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
  | "done";

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
  category: "model" | "tool" | "command" | "workspace" | "orchestration" | "cancelled";
}

export interface AgentTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: Date;
  completedAt?: Date;
  events: AgentEvent[];
  summary?: string;
  completion?: TaskCompletion;
  failureDetail?: TaskFailureDetail;
}

const tasks = new Map<string, AgentTask>();
const taskControllers = new Map<string, AbortController>();

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

export function listTasks(): AgentTask[] {
  return Array.from(tasks.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
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
  task.events.push(event);
  return event;
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
    cleanupTaskController(taskId);
  }
  if (summary !== undefined) {
    task.summary = summary;
  }
  if (completion !== undefined) {
    task.completion = completion;
  }
  if (failureDetail !== undefined) {
    task.failureDetail = failureDetail;
  }
}
