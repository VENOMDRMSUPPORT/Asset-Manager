/**
 * taskPersistence.ts — lightweight task history persistence
 *
 * Writes completed task summaries to a JSON file so task history survives
 * server restarts. Only summaries (no event arrays) are persisted to keep
 * the file small. The full event log for a completed task is available in
 * memory for the duration of the server session.
 *
 * File location: <data dir>/history.json
 *
 * Data dir resolution order (first match wins):
 *   1. VENOMGPT_DATA_DIR env var
 *   2. DEVMIND_DATA_DIR env var  (backward-compat — migrates data to new path)
 *   3. ~/.venomgpt               (canonical default)
 *
 * Migration: if the canonical ~/.venomgpt/history.json does not exist but
 * the legacy ~/.devmind/history.json does, the legacy file is copied to the
 * new location so no history is lost on upgrade.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { logger } from "./logger.js";
import { registerTaskCompletionHook, hydratePersistedTask, type AgentTaskSummary } from "./sessionManager.js";
import { getSettings } from "./settingsStore.js";

// ─── Data directory resolution ────────────────────────────────────────────────

const LEGACY_DATA_DIR = path.join(os.homedir(), ".devmind");
const CANONICAL_DATA_DIR = path.join(os.homedir(), ".venomgpt");

function resolveDataDir(): string {
  if (process.env["VENOMGPT_DATA_DIR"]) {
    return path.resolve(process.env["VENOMGPT_DATA_DIR"]);
  }
  if (process.env["DEVMIND_DATA_DIR"]) {
    return path.resolve(process.env["DEVMIND_DATA_DIR"]);
  }
  return CANONICAL_DATA_DIR;
}

const DATA_DIR = resolveDataDir();
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

// Maximum number of tasks to keep is read from settings at each write,
// so operators can change it via the Settings page without restarting the server.

interface PersistedHistory {
  version: 1;
  tasks: AgentTaskSummary[];
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

function serialise(summary: AgentTaskSummary): AgentTaskSummary {
  return {
    ...summary,
    createdAt:   new Date(summary.createdAt),
    completedAt: summary.completedAt ? new Date(summary.completedAt) : undefined,
  };
}

// ─── Legacy migration ─────────────────────────────────────────────────────────

/**
 * If the canonical history file doesn't exist but the legacy one does,
 * copy it over so existing history is preserved after the rename.
 */
async function migrateFromLegacyIfNeeded(): Promise<void> {
  const legacyFile = path.join(LEGACY_DATA_DIR, "history.json");

  // Only migrate when using the canonical default dir (not when the user
  // has set a custom dir via env var, which they control themselves).
  if (DATA_DIR !== CANONICAL_DATA_DIR) return;

  try {
    await fs.access(HISTORY_FILE);
    return; // Canonical file already exists — no migration needed
  } catch {
    // Canonical file absent — check for legacy
  }

  try {
    await fs.access(legacyFile);
  } catch {
    return; // No legacy file either — nothing to migrate
  }

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.copyFile(legacyFile, HISTORY_FILE);
    logger.info(
      { from: legacyFile, to: HISTORY_FILE },
      "Migrated task history from legacy .devmind directory to .venomgpt"
    );
  } catch (err) {
    logger.warn({ err, legacyFile, HISTORY_FILE }, "Failed to migrate legacy task history — starting fresh");
  }
}

// ─── Read / write ─────────────────────────────────────────────────────────────

async function readHistory(): Promise<AgentTaskSummary[]> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const data = JSON.parse(raw) as PersistedHistory;
    if (data.version !== 1 || !Array.isArray(data.tasks)) return [];
    return data.tasks.map(serialise);
  } catch {
    return [];
  }
}

async function writeHistory(tasks: AgentTaskSummary[]): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const payload: PersistedHistory = { version: 1, tasks };
    await fs.writeFile(HISTORY_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    logger.warn({ err, file: HISTORY_FILE }, "Failed to write task history");
  }
}

// In-memory shadow of persisted tasks, sorted newest-first
let _persisted: AgentTaskSummary[] = [];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load persisted task history from disk and hydrate the session manager.
 * Handles migration from the legacy .devmind directory automatically.
 * Call this once at server start AFTER setting up the workspace.
 */
export async function loadPersistedHistory(): Promise<void> {
  await migrateFromLegacyIfNeeded();
  _persisted = await readHistory();
  logger.info({ count: _persisted.length, file: HISTORY_FILE }, "Loaded task history");

  for (const summary of _persisted) {
    hydratePersistedTask(summary);
  }
}

/**
 * Clear all persisted task history from disk and reset the in-memory shadow.
 * Called by the settings route when the user clears history via the UI.
 */
export async function clearPersistedHistory(): Promise<void> {
  _persisted = [];
  await writeHistory([]);
  logger.info({ file: HISTORY_FILE }, "Task history cleared");
}

/**
 * Register the session-manager hook so completed tasks are automatically saved.
 * Must be called before tasks start running.
 */
export function initTaskPersistence(): void {
  registerTaskCompletionHook((summary) => {
    // Upsert: replace existing entry or prepend
    const idx = _persisted.findIndex((t) => t.id === summary.id);
    if (idx >= 0) {
      _persisted[idx] = summary;
    } else {
      _persisted.unshift(summary);
    }

    // Trim to the operator-configured capacity (read live from settings)
    const cap = getSettings().historyCapacity;
    if (_persisted.length > cap) {
      _persisted = _persisted.slice(0, cap);
    }

    // Fire-and-forget write
    writeHistory(_persisted).catch(() => { /* already logged inside */ });
  });
}
