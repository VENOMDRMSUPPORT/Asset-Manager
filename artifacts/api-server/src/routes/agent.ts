import { Router, type IRouter } from "express";
import { runAgentTask } from "../lib/agentLoop.js";
import { getTask, listTasks } from "../lib/sessionManager.js";

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

export default router;
