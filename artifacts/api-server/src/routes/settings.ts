/**
 * settings.ts — REST API for VenomGPT operator settings
 *
 * GET    /api/settings         — current settings + provider + history stats
 * PATCH  /api/settings         — update one or more settings fields
 * POST   /api/settings/reset   — reset all settings to defaults
 * DELETE /api/settings/history — clear all task history
 */

import { Router } from "express";
import { getSettings, updateSettings, resetSettings, SETTINGS_FILE, DATA_DIR } from "../lib/settingsStore.js";
import { ZAI_MODEL_REGISTRY } from "../lib/zaiCapabilities.js";
import { getAllTaskSummaries, clearAllTasks } from "../lib/sessionManager.js";
import { clearPersistedHistory } from "../lib/taskPersistence.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function providerInfo() {
  const hasZai    = !!process.env["ZAI_API_KEY"];
  const hasReplit = !!(process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] && process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]);
  const name      = hasZai ? "Z.AI" : hasReplit ? "Replit OpenAI" : "none";
  const keySet    = hasZai || hasReplit;

  const agentModels = ZAI_MODEL_REGISTRY
    .filter(m => m.capabilities.some(c => ["text_coding","agentic"].includes(c)))
    .map(m => ({ modelId: m.modelId, displayName: m.displayName, lane: m.preferredLane, free: m.priceInputPer1M === null }));

  const visionModels = ZAI_MODEL_REGISTRY
    .filter(m => m.capabilities.includes("vision"))
    .map(m => ({ modelId: m.modelId, displayName: m.displayName, lane: m.preferredLane, free: m.priceInputPer1M === null }));

  return { name, keySet, hasZai, hasReplit, agentModels, visionModels };
}

function historyStats() {
  const tasks = getAllTaskSummaries();
  return {
    count: tasks.length,
    filePath: SETTINGS_FILE.replace("settings.json", "history.json"),
    dataDir: DATA_DIR,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/settings
 * Returns current settings + provider metadata + history stats.
 */
router.get("/api/settings", (_req, res) => {
  res.json({
    settings: getSettings(),
    provider: providerInfo(),
    history: historyStats(),
  });
});

/**
 * PATCH /api/settings
 * Accepts a partial VenomGPTSettings object. Unknown keys are ignored.
 * Validation is performed inside updateSettings().
 */
router.patch("/api/settings", async (req, res) => {
  try {
    const patch = req.body as Record<string, unknown>;
    const updated = await updateSettings(patch as never);
    logger.info({ patch }, "Settings updated via API");
    res.json({ settings: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /api/settings/reset
 * Resets all settings to factory defaults.
 */
router.post("/api/settings/reset", async (_req, res) => {
  const defaults = await resetSettings();
  res.json({ settings: defaults });
});

/**
 * DELETE /api/settings/history
 * Clears all persisted task history (on disk) and the in-memory task list.
 */
router.delete("/api/settings/history", async (_req, res) => {
  try {
    await clearPersistedHistory();
    clearAllTasks();
    logger.info("Task history cleared via settings API");
    res.json({ ok: true, message: "Task history cleared" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
