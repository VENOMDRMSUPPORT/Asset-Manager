/**
 * orchestrator/types.ts — Shared types for the VenomGPT orchestration layer.
 *
 * Defines the core structures used by the task router, planner, action router,
 * and run-state machine that together replace the previous single-loop approach.
 */

// ─── Task categories ──────────────────────────────────────────────────────────

export type TaskCategory =
  | "conversational"
  | "visual_describe"
  | "visual_report"
  | "visual_fix"
  | "visual_improve"
  | "visual_analyze"
  | "code_edit"
  | "code_verify"
  | "text_explain";

// ─── Execution profile ────────────────────────────────────────────────────────

/**
 * Defines the behavioral constraints and strategy for a task category.
 * Each profile caps resource usage and enables/disables optional phases.
 */
export interface ExecutionProfile {
  category:       TaskCategory;
  /** Hard step ceiling for this profile — overrides the operator maxSteps when lower. */
  maxSteps:       number;
  /** Max distinct file reads before the action router blocks additional reads. */
  maxFileReads:   number;
  /** Max distinct file writes allowed in this profile. */
  maxFileWrites:  number;
  /** If true, the action router blocks `done` when there are unverified writes. */
  requiresVerify: boolean;
  /** If true, a structured planning model call fires before the main execution loop. */
  planningPhase:  boolean;
  /** Human-readable description of this profile (logged, shown as route event). */
  description:    string;
}

// ─── Execution plan ───────────────────────────────────────────────────────────

/**
 * Structured plan produced by the planning phase before the main loop.
 * Injected into the agent's context as an explicit roadmap.
 */
export interface ExecutionPlan {
  goal:            string;
  approach:        string;
  filesToRead:     string[];
  expectedChanges: string[];
  verification:    string;
}

// ─── Run phase state machine ──────────────────────────────────────────────────

/**
 * Explicit phase tracking for task execution.
 * Transitions: initializing → [planning] → executing → [verifying|repairing] → complete|failed
 */
export type RunPhase =
  | "initializing"
  | "planning"
  | "executing"
  | "verifying"
  | "repairing"
  | "wrapping_up"
  | "complete"
  | "failed";

// ─── Run state ────────────────────────────────────────────────────────────────

/**
 * Structured execution state that replaces scattered local variables in the
 * agent loop. Updated by the action router after each step.
 */
export interface RunState {
  phase:                    RunPhase;
  step:                     number;
  /** Effective max steps (min of operator setting and profile cap). */
  maxSteps:                 number;
  profile:                  ExecutionProfile;
  plan:                     ExecutionPlan | null;
  /** Distinct file paths that have been successfully read this session. */
  filesRead:                Set<string>;
  /** Distinct file paths that have been successfully written this session. */
  filesWritten:             Set<string>;
  /** All commands run (in order) — used for evidence tracking at done. */
  commandsRun:              string[];
  lastActionType:           string | null;
  lastActionFailed:         boolean;
  /** Count of consecutive failed actions — triggers repair-limit nudge. */
  consecutiveFailures:      number;
  consecutiveParseFailures: number;
  /** Files written since the last successful verification — used for the verify gate. */
  unverifiedWrites:         Set<string>;
  /** Count of verification steps completed (successful run_command or read-back after write). */
  verificationsDone:        number;
  /**
   * Number of shell commands blocked because they were detected as file-read
   * bypass attempts (cat, sed -n, head, tail). Visible in logs for debugging.
   */
  shellReadsBlocked:        number;
}

export function createRunState(profile: ExecutionProfile, operatorMaxSteps: number): RunState {
  return {
    phase:                    "initializing",
    step:                     0,
    maxSteps:                 Math.min(operatorMaxSteps, profile.maxSteps),
    profile,
    plan:                     null,
    filesRead:                new Set(),
    filesWritten:             new Set(),
    commandsRun:              [],
    lastActionType:           null,
    lastActionFailed:         false,
    consecutiveFailures:      0,
    consecutiveParseFailures: 0,
    unverifiedWrites:         new Set(),
    verificationsDone:        0,
    shellReadsBlocked:        0,
  };
}
