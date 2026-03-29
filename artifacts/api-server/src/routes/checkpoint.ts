/**
 * routes/checkpoint.ts — Task checkpoint API routes.
 *
 * These routes expose the Phase 10 checkpoint model to the operator:
 *
 *   GET  /api/agent/tasks/:taskId/checkpoint  — checkpoint status + file list
 *   POST /api/agent/tasks/:taskId/apply       — accept changes permanently
 *   POST /api/agent/tasks/:taskId/discard     — restore all files to pre-task state
 *
 * All three routes require the task to exist and to have a checkpoint
 * (i.e., the task must have performed at least one successful file write).
 */

import { Router, type IRouter } from "express";
import { getTask } from "../lib/sessionManager.js";
import {
  getCheckpoint,
  serializeCheckpoint,
  applyCheckpoint,
  discardCheckpoint,
} from "../lib/orchestrator/checkpoint.js";
import { invalidateProjectIndex } from "../lib/projectIndex.js";
import { broadcastTaskUpdate } from "../lib/wsServer.js";

const router: IRouter = Router();

// ─── GET checkpoint status ────────────────────────────────────────────────────

router.get("/agent/tasks/:taskId/checkpoint", (req, res) => {
  const { taskId } = req.params;

  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "not_found", message: `Task ${taskId} not found` });
    return;
  }

  const cp = getCheckpoint(taskId);
  if (!cp) {
    res.status(404).json({
      error: "no_checkpoint",
      message: `Task ${taskId} has no checkpoint (task made no file writes or checkpoint data was lost on server restart)`,
    });
    return;
  }

  res.json(serializeCheckpoint(cp));
});

// ─── Apply checkpoint ─────────────────────────────────────────────────────────

router.post("/agent/tasks/:taskId/apply", (req, res) => {
  const { taskId } = req.params;

  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "not_found", message: `Task ${taskId} not found` });
    return;
  }

  if (task.status === "running") {
    res.status(400).json({
      error: "task_running",
      message: "Cannot apply checkpoint while the task is still running",
    });
    return;
  }

  const cp = getCheckpoint(taskId);
  if (!cp) {
    res.status(404).json({
      error: "no_checkpoint",
      message: `Task ${taskId} has no checkpoint`,
    });
    return;
  }

  try {
    applyCheckpoint(taskId);
    broadcastTaskUpdate(task);
    res.json({
      success: true,
      message: `Checkpoint applied — ${cp.snapshots.size} file(s) accepted permanently`,
      status: "applied",
    });
  } catch (err) {
    res.status(400).json({ error: "apply_failed", message: String(err) });
  }
});

// ─── Discard checkpoint ───────────────────────────────────────────────────────

router.post("/agent/tasks/:taskId/discard", async (req, res) => {
  const { taskId } = req.params;

  const task = getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "not_found", message: `Task ${taskId} not found` });
    return;
  }

  if (task.status === "running") {
    res.status(400).json({
      error: "task_running",
      message: "Cannot discard checkpoint while the task is still running",
    });
    return;
  }

  const cp = getCheckpoint(taskId);
  if (!cp) {
    res.status(404).json({
      error: "no_checkpoint",
      message: `Task ${taskId} has no checkpoint`,
    });
    return;
  }

  try {
    const restored = await discardCheckpoint(taskId);

    // Invalidate project intelligence cache — files on disk have changed
    invalidateProjectIndex();
    broadcastTaskUpdate(task);

    res.json({
      success: true,
      message: `Checkpoint discarded — ${restored.length} file(s) restored to pre-task state`,
      restoredFiles: restored,
      status: "discarded",
    });
  } catch (err) {
    res.status(400).json({ error: "discard_failed", message: String(err) });
  }
});

export default router;
