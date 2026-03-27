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

export interface AgentTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: Date;
  completedAt?: Date;
  events: AgentEvent[];
  summary?: string;
}

const tasks = new Map<string, AgentTask>();

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
  summary?: string
): void {
  const task = tasks.get(taskId);
  if (!task) return;

  task.status = status;
  if (status === "done" || status === "error") {
    task.completedAt = new Date();
  }
  if (summary) {
    task.summary = summary;
  }
}
