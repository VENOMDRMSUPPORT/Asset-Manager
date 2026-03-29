/**
 * orchestrator/taskRouter.ts — Task classification and execution profile selection.
 *
 * Maps each incoming task (prompt + visual context) to an execution profile that
 * defines its step budget, file-access caps, verification requirements, and
 * whether a planning phase runs before the main loop.
 *
 * This replaces the implicit "all tasks get 25 steps and unlimited file reads"
 * model with intentional, per-category execution strategies.
 */

import type { VisualIntent } from "../agentLoop.js";
import type { TaskCategory, ExecutionProfile } from "./types.js";

// ─── Profile registry ─────────────────────────────────────────────────────────

const PROFILE_CONFIGS: Record<TaskCategory, Omit<ExecutionProfile, "category">> = {
  //                         maxSteps  reads  writes  verify  plan
  conversational:  { maxSteps:  2, maxFileReads: 0, maxFileWrites: 0, requiresVerify: false, planningPhase: false,
    description: "Conversational — direct response, no file access" },
  visual_describe: { maxSteps:  3, maxFileReads: 0, maxFileWrites: 0, requiresVerify: false, planningPhase: false,
    description: "Describe screenshot — answer only, no file access" },
  visual_report:   { maxSteps:  6, maxFileReads: 0, maxFileWrites: 1, requiresVerify: true,  planningPhase: false,
    description: "Visual report — write findings file then verify" },
  visual_fix:      { maxSteps: 12, maxFileReads: 2, maxFileWrites: 3, requiresVerify: true,  planningPhase: false,
    description: "Visual fix — inspect ≤2 files, write fix, verify" },
  visual_improve:  { maxSteps: 14, maxFileReads: 2, maxFileWrites: 4, requiresVerify: true,  planningPhase: false,
    description: "Visual improve — inspect ≤2 files, implement improvements, verify" },
  visual_analyze:  { maxSteps:  5, maxFileReads: 1, maxFileWrites: 0, requiresVerify: false, planningPhase: false,
    description: "Visual analyze — structured assessment, optional 1-file read" },
  code_edit:       { maxSteps: 25, maxFileReads: 10, maxFileWrites: 8, requiresVerify: true, planningPhase: true,
    description: "Code editing — full loop with planning phase and verification" },
  code_verify:     { maxSteps:  8, maxFileReads:  5, maxFileWrites: 0, requiresVerify: false, planningPhase: false,
    description: "Verification/inspection — read and run commands, no writes" },
  text_explain:    { maxSteps:  6, maxFileReads:  4, maxFileWrites: 0, requiresVerify: false, planningPhase: false,
    description: "Explanation — read relevant context, answer, done" },
};

// ─── Keyword classifiers for text-only tasks ──────────────────────────────────

/** Code mutation verbs — clear signal this is a code edit task. */
const CODE_EDIT_VERBS_RE = /\b(write|add|create|fix|build|implement|change|update|refactor|remove|delete|edit|migrate|convert|rewrite|replace|set up|wire|connect|make it|generate|scaffold|stub|initialize|init|install)\b/i;

/** Pure verification queries — run/check only, no writes. */
const CODE_VERIFY_RE = /^(check|verify|run|test|validate|is (there|it|the|this)|does|did|show me|find|list|search|grep|look at|scan|audit|can you (check|run|test|verify|show|confirm))\b/i;

/** Pure explanation / question — answer only, no code changes. */
const TEXT_EXPLAIN_RE = /^(what|how|why|explain|describe|tell me|walk me through|can you explain|what is|what are|what does|what did|who|when|is this|how (does|do|is|can|should)|why (is|does|did|are|isn't|doesn't))\b/i;

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Classify the task and return the matching execution profile.
 * For visual tasks, the profile is determined by the visual intent.
 * For text tasks, keyword-based classification is used with code_edit as the
 * safe default (avoids under-scoping legitimate engineering tasks).
 */
export function routeTask(
  prompt:        string,
  isVisual:      boolean,
  visualIntent?: VisualIntent,
): ExecutionProfile {
  // ── Visual tasks — route directly from visual intent ──────────────────────
  if (isVisual && visualIntent) {
    const category = `visual_${visualIntent}` as TaskCategory;
    return { category, ...PROFILE_CONFIGS[category] };
  }

  const t = prompt.trim();

  // ── Code edit verbs override everything — explicit mutation intent ─────────
  if (CODE_EDIT_VERBS_RE.test(t)) {
    return { category: "code_edit", ...PROFILE_CONFIGS.code_edit };
  }

  // ── Pure verification / inspection ────────────────────────────────────────
  if (CODE_VERIFY_RE.test(t)) {
    return { category: "code_verify", ...PROFILE_CONFIGS.code_verify };
  }

  // ── Pure explanation / question ───────────────────────────────────────────
  if (TEXT_EXPLAIN_RE.test(t)) {
    return { category: "text_explain", ...PROFILE_CONFIGS.text_explain };
  }

  // ── Default: code editing (safest general fallback) ───────────────────────
  return { category: "code_edit", ...PROFILE_CONFIGS.code_edit };
}
