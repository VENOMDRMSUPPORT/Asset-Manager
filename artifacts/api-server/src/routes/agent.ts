import { Router, type IRouter } from "express";
import { runAgentTask } from "../lib/agentLoop.js";
import {
  getTask,
  listTasksSummary,
  getTaskEvents,
  cancelTask,
  deleteTask,
} from "../lib/sessionManager.js";
import { broadcastTaskUpdate } from "../lib/wsServer.js";
import { getFallbackChain } from "../lib/zaiCapabilities.js";
import { getModelProvider } from "../lib/modelAdapter.js";

const router: IRouter = Router();

// ─── Image validation ─────────────────────────────────────────────────────────

const MAX_IMAGES           = 5;
// Client-side JPEG compression (max 1280 px, 85 % quality) keeps real screenshots
// well under 500 KB as base64.  4 MB is a generous server-side safety cap that
// rejects maliciously-crafted payloads while never rejecting legitimate screenshots.
const MAX_IMAGE_BYTES      = 4 * 1024 * 1024; // 4 MB per image
const ALLOWED_IMAGE_PREFIXES = ["data:image/", "https://"];

function validateImages(raw: unknown): { images: string[]; error?: string } {
  if (raw === undefined || raw === null) return { images: [] };
  if (!Array.isArray(raw))              return { images: [], error: "images must be an array" };
  if (raw.length > MAX_IMAGES)          return { images: [], error: `at most ${MAX_IMAGES} images allowed per task` };

  const images: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== "string") {
      return { images: [], error: `images[${i}] must be a string` };
    }
    const ok = ALLOWED_IMAGE_PREFIXES.some(p => item.startsWith(p));
    if (!ok) {
      return { images: [], error: `images[${i}] must be a data URL (data:image/...) or https:// URL` };
    }
    if (item.startsWith("data:") && item.length > MAX_IMAGE_BYTES * (4 / 3)) {
      return { images: [], error: `images[${i}] exceeds the 6 MB size limit` };
    }
    images.push(item);
  }
  return { images };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post("/agent/tasks", async (req, res) => {
  const { prompt, images: rawImages } = req.body as { prompt?: string; images?: unknown };

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "missing_prompt", message: "prompt is required" });
    return;
  }

  const { images, error: imageError } = validateImages(rawImages);
  if (imageError) {
    res.status(400).json({ error: "invalid_images", message: imageError });
    return;
  }

  try {
    const task = await runAgentTask(prompt.trim(), images);
    res.json({ taskId: task.id, status: task.status });
  } catch (err) {
    res.status(400).json({ error: "agent_error", message: String(err) });
  }
});

// Slim list — excludes events array for fast payload
router.get("/agent/tasks", (_req, res) => {
  const tasks = listTasksSummary();
  res.json({ tasks });
});

// Full task including all stored events — used for replay
router.get("/agent/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const task = getTask(taskId);

  if (!task) {
    res.status(404).json({ error: "not_found", message: `Task ${taskId} not found` });
    return;
  }

  res.json(task);
});

// Events-only endpoint for lightweight replay without re-fetching full task body
router.get("/agent/tasks/:taskId/events", (req, res) => {
  const { taskId } = req.params;
  const task = getTask(taskId);

  if (!task) {
    res.status(404).json({ error: "not_found", message: `Task ${taskId} not found` });
    return;
  }

  res.json({ taskId, events: getTaskEvents(taskId) });
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

// ─── Provider capability surface ─────────────────────────────────────────────
//
// Returns a provider-agnostic view of what the current AI configuration
// supports.  Used by the frontend and operator tooling for honest capability
// reporting — no guessing, no fake feature flags.

router.get("/agent/capabilities", (_req, res) => {
  const hasZai    = !!process.env["ZAI_API_KEY"];
  const hasReplit = !!process.env["OPENAI_API_KEY"];
  const provider  = hasZai ? "zai" : hasReplit ? "replit" : "none";

  const model         = getModelProvider();
  const visualCap     = model.getVisualTaskCapability();

  const agenticChain = hasZai
    ? getFallbackChain("agentic").map((c) => `${c.modelId} (${c.lane})`)
    : ["gpt-5.2 (replit-openai)"];

  res.json({
    provider,
    agentic: {
      available:     provider !== "none",
      primaryModel:  hasZai ? "glm-5.1" : hasReplit ? "gpt-5.2" : null,
      fallbackChain: agenticChain,
    },
    vision: {
      // Populated entirely from the provider's VisualTaskCapability descriptor.
      // No hardcoded values here — adding a new provider just requires
      // implementing getVisualTaskCapability() in its ModelProvider class.
      capable:             visualCap.capable,
      primaryModel:        visualCap.primaryVisionModel,
      modelChain:          visualCap.visionModelChain,
      runtimeStatus:       "unknown",  // tested at call time, not at boot
      maxImagesPerRequest: visualCap.maxImagesPerRequest,
      maxImageSizeBytes:   visualCap.maxImageSizeBytes,
      note:                visualCap.note,
    },
    multimodal: {
      imageIntake:      true,                // UI + backend validated image submission
      visionAnalysis:   visualCap.capable,   // two-phase: vision model → text → coding agent
      codeAwareBridge:  true,                // visual debug file scan + protocol injected on success
      mcpEnrichment:    false,               // not yet wired (no MCP servers configured)
    },
  });
});

export default router;
