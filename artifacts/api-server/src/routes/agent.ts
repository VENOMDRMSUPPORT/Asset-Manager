import { Router, type IRouter } from "express";
import { runAgentTask } from "../lib/agentLoop.js";
import { getTask, listTasks, cancelTask, deleteTask } from "../lib/sessionManager.js";
import { broadcastTaskUpdate } from "../lib/wsServer.js";

const router: IRouter = Router();

router.post("/agent/tasks", async (req, res) => {
  const { prompt } = req.body as { prompt?: string };

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "missing_prompt", message: "prompt is required" });
    return;
  }

  try {
    const task = await runAgentTask(prompt.trim());
    res.json({ taskId: task.id, status: task.status });
  } catch (err) {
    res.status(400).json({ error: "agent_error", message: String(err) });
  }
});

router.get("/agent/tasks", (_req, res) => {
  const tasks = listTasks();
  res.json({ tasks });
});

router.get("/agent/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const task = getTask(taskId);

  if (!task) {
    res.status(404).json({ error: "not_found", message: `Task ${taskId} not found` });
    return;
  }

  res.json(task);
});

router.post("/agent/tasks/:taskId/cancel", (req, res) => {
  const { taskId } = req.params;
  const task = getTask(taskId);

  if (!task) {
    res.status(404).json({ error: "not_found", message: `Task ${taskId} not found` });
    return;
  }

  if (task.status !== "running") {
    res.status(400).json({
      error: "not_running",
      message: `Task ${taskId} is not currently running (status: ${task.status})`,
    });
    return;
  }

  const cancelled = cancelTask(taskId);
  if (cancelled) {
    broadcastTaskUpdate(task);
    res.json({ success: true, message: "Task cancellation requested" });
  } else {
    res.status(400).json({ error: "cancel_failed", message: "Could not cancel task" });
  }
});

router.delete("/agent/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const task = getTask(taskId);

  if (!task) {
    res.status(404).json({ error: "not_found", message: `Task ${taskId} not found` });
    return;
  }

  if (task.status === "running") {
    res.status(400).json({
      error: "still_running",
      message: "Cannot delete a running task. Cancel it first.",
    });
    return;
  }

  const deleted = deleteTask(taskId);
  if (deleted) {
    res.json({ success: true, message: `Task ${taskId} deleted` });
  } else {
    res.status(500).json({ error: "delete_failed", message: "Could not delete task" });
  }
});

export default router;
