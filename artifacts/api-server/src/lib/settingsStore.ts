/**
 * settingsStore.ts — VenomGPT runtime settings
 *
 * Provides a typed, persisted settings store used throughout the backend.
 * Settings are stored at <data-dir>/settings.json and read at startup.
 * All fields have safe defaults so the app works with no settings file.
 *
 * Design rule: settings must control REAL behaviour, never decoration.
 *
 * File: ~/.venomgpt/settings.json (or VENOMGPT_DATA_DIR / DEVMIND_DATA_DIR)
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { logger } from "./logger.js";

// ─── Data-dir resolution (mirrors taskPersistence.ts) ────────────────────────

const CANONICAL_DATA_DIR = path.join(os.homedir(), ".venomgpt");

function resolveDataDir(): string {
  if (process.env["VENOMGPT_DATA_DIR"]) return path.resolve(process.env["VENOMGPT_DATA_DIR"]);
  if (process.env["DEVMIND_DATA_DIR"])  return path.resolve(process.env["DEVMIND_DATA_DIR"]);
  return CANONICAL_DATA_DIR;
}

const DATA_DIR      = resolveDataDir();
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface VenomGPTSettings {
  // ─── Agent execution ────────────────────────────────────────────────────────
  /** Max JSON action steps per task (5–50). Controls how complex a task can be. */
  maxSteps: number;
  /** Default per-command timeout in seconds (30–300). */
  commandTimeoutSecs: number;
  /** Whether to emit [thought] events to the output panel. */
  showThinkEvents: boolean;

  // ─── AI model overrides ──────────────────────────────────────────────────────
  /** Pin the primary (coding/agentic) model. null = auto-routing. */
  agentModelOverride: string | null;
  /** Pin the vision model. null = auto-routing. */
  visionModelOverride: string | null;

  // ─── History ─────────────────────────────────────────────────────────────────
  /** Maximum number of tasks to keep in history.json (25 | 50 | 100 | 200). */
  historyCapacity: number;
}

export const DEFAULTS: Readonly<VenomGPTSettings> = {
  maxSteps:            25,
  commandTimeoutSecs: 120,
  showThinkEvents:    true,
  agentModelOverride:   null,
  visionModelOverride:  null,
  historyCapacity:    100,
} as const;

// Bounds enforced on every write
const BOUNDS = {
  maxSteps:           { min: 5,  max: 50  },
  commandTimeoutSecs: { min: 30, max: 300 },
  historyCapacity:    { allowed: [25, 50, 100, 200] as number[] },
} as const;

// ─── In-memory singleton ─────────────────────────────────────────────────────

let _settings: VenomGPTSettings = { ...DEFAULTS };

export function getSettings(): Readonly<VenomGPTSettings> {
  return _settings;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function sanitize(raw: Partial<VenomGPTSettings>): VenomGPTSettings {
  const base = { ..._settings };

  if (typeof raw.maxSteps === "number") {
    base.maxSteps = clamp(raw.maxSteps, BOUNDS.maxSteps.min, BOUNDS.maxSteps.max);
  }
  if (typeof raw.commandTimeoutSecs === "number") {
    base.commandTimeoutSecs = clamp(raw.commandTimeoutSecs, BOUNDS.commandTimeoutSecs.min, BOUNDS.commandTimeoutSecs.max);
  }
  if (typeof raw.showThinkEvents === "boolean") {
    base.showThinkEvents = raw.showThinkEvents;
  }
  if ("agentModelOverride" in raw) {
    base.agentModelOverride = raw.agentModelOverride ? String(raw.agentModelOverride) : null;
  }
  if ("visionModelOverride" in raw) {
    base.visionModelOverride = raw.visionModelOverride ? String(raw.visionModelOverride) : null;
  }
  if (typeof raw.historyCapacity === "number") {
    const allowed = BOUNDS.historyCapacity.allowed;
    base.historyCapacity = allowed.includes(raw.historyCapacity) ? raw.historyCapacity : DEFAULTS.historyCapacity;
  }

  return base;
}

// ─── Disk I/O ─────────────────────────────────────────────────────────────────

async function write(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(_settings, null, 2), "utf8");
  } catch (err) {
    logger.warn({ err, file: SETTINGS_FILE }, "Failed to write settings");
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load persisted settings from disk. Falls back to defaults if missing / invalid.
 * Call once at server start.
 */
export async function loadSettings(): Promise<void> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<VenomGPTSettings>;
    _settings = sanitize(parsed);
    logger.info({ settings: _settings, file: SETTINGS_FILE }, "Loaded settings");
  } catch {
    // Missing or corrupt — start with defaults (no error, this is normal first-run)
    _settings = { ...DEFAULTS };
    logger.info({ settings: _settings }, "No settings file found — using defaults");
  }
}

/**
 * Apply a partial settings update, validate, persist to disk.
 * Returns the updated settings.
 */
export async function updateSettings(patch: Partial<VenomGPTSettings>): Promise<VenomGPTSettings> {
  _settings = sanitize(patch);
  await write();
  logger.info({ patch, result: _settings }, "Settings updated");
  return _settings;
}

/**
 * Reset all settings to defaults and persist.
 */
export async function resetSettings(): Promise<VenomGPTSettings> {
  _settings = { ...DEFAULTS };
  await write();
  logger.info("Settings reset to defaults");
  return _settings;
}

export { SETTINGS_FILE, DATA_DIR };
