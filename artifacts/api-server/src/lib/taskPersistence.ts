/**
 * taskPersistence.ts — lightweight task history persistence
 *
 * Writes completed task summaries to a JSON file so task history survives
 * server restarts. Only summaries (no event arrays) are persisted to keep
 * the file small. The full event log for a completed task is available in
 * memory for the duration of the server session.
 *
 * File location: <data dir>/.devmind/history.json
 * Data dir defaults to the OS temp dir, overridden by DEVMIND_DATA_DIR env var.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { logger } from "./logger.js";
import { registerTaskCompletionHook, hydratePersistedTask, type AgentTaskSummary } from "./sessionManager.js";

const DATA_DIR = process.env["DEVMIND_DATA_DIR"]
  ? path.resolve(process.env["DEVMIND_DATA_DIR"])
  : path.join(os.homedir(), ".devmind");

const HISTORY_FILE = path.join(DATA_DIR, "history.json");

// Maximum number of tasks to keep in the history file
const MAX_PERSISTED_TASKS = 100;

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
 * Call this once at server start AFTER setting up the workspace.
 */
export async function loadPersistedHistory(): Promise<void> {
  _persisted = await readHistory();
  logger.info({ count: _persisted.length, file: HISTORY_FILE }, "Loaded task history");

  for (const summary of _persisted) {
    hydratePersistedTask(summary);
  }
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

    // Trim to max
    if (_persisted.length > MAX_PERSISTED_TASKS) {
      _persisted = _persisted.slice(0, MAX_PERSISTED_TASKS);
    }

    // Fire-and-forget write
    writeHistory(_persisted).catch(() => { /* already logged inside */ });
  });
}
