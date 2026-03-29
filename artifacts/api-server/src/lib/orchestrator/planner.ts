/**
 * orchestrator/planner.ts — Structured planning phase for code-edit tasks.
 *
 * Before the main execution loop starts on code_edit tasks, the planner makes a
 * single focused model call to produce a structured JSON plan:
 *
 *   { goal, approach, files_to_read, expected_changes, verification }
 *
 * The plan:
 *   1. Gets emitted as a "plan" event (visible in the task feed)
 *   2. Gets injected into the agent's user context as an explicit roadmap
 *   3. Allows the action router to prime the read set with expected files
 *
 * If the planner fails for any reason (timeout, bad parse, model error), the task
 * continues without a plan — the main loop degrades gracefully.
 */

import type { ExecutionPlan } from "./types.js";
import type { Message } from "../modelAdapter.js";

// ─── Planner system prompt ────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a task planner for VenomGPT, an AI coding assistant.
Your job: analyze the task and workspace context, then output a MINIMAL structured JSON plan.

Output ONLY the JSON object below — nothing else. No markdown fences. No prose. Just the JSON.

{
  "goal": "one sentence: what will be done",
  "approach": "2-3 sentences: which files, what changes, what technique",
  "files_to_read": ["path/to/file"],
  "expected_changes": ["path/to/file"],
  "verification": "one concrete verification command or 'read-back'"
}

Rules:
- files_to_read: ONLY files you MUST read before editing. Maximum 5. Do NOT list files you can write fresh.
- expected_changes: realistic list of files to be modified or created. Maximum 6.
- verification: one concrete shell command (e.g. "npx tsc --noEmit", "npm test") or "read-back" for write-only tasks.
- Be concise. No arrays longer than 6 items. No text outside the JSON object.
- If the task is ambiguous, still produce the best plan you can.`;

// ─── Plan parser ──────────────────────────────────────────────────────────────

function parsePlan(text: string): ExecutionPlan | null {
  // Strip markdown fences if present
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  // Find the first { ... } block in case there's surrounding text
  const start = cleaned.indexOf("{");
  const end   = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const plan: ExecutionPlan = {
      goal:            String(raw["goal"]            ?? ""),
      approach:        String(raw["approach"]        ?? ""),
      filesToRead:     Array.isArray(raw["files_to_read"])    ? (raw["files_to_read"]    as unknown[]).map(String).filter(Boolean) : [],
      expectedChanges: Array.isArray(raw["expected_changes"]) ? (raw["expected_changes"] as unknown[]).map(String).filter(Boolean) : [],
      verification:    String(raw["verification"]    ?? ""),
    };

    // Sanity-check: must have at least a goal
    if (!plan.goal) return null;

    // Enforce caps on array lengths
    if (plan.filesToRead.length > 5)     plan.filesToRead     = plan.filesToRead.slice(0, 5);
    if (plan.expectedChanges.length > 6) plan.expectedChanges = plan.expectedChanges.slice(0, 6);

    return plan;
  } catch {
    return null;
  }
}

// ─── Planning phase runner ────────────────────────────────────────────────────

/**
 * Run the planning phase for a code-edit task.
 * Returns a structured ExecutionPlan, or null if planning fails.
 * Failure is always silent — the main loop continues without a plan.
 */
export async function runPlanningPhase(
  model: {
    chat: (
      messages: Message[],
      opts?: Record<string, unknown>
    ) => Promise<{ content: string }>;
  },
  context:  string,
  taskHint: string = "agentic",
): Promise<ExecutionPlan | null> {
  const messages: Message[] = [
    { role: "system", content: PLANNER_SYSTEM },
    { role: "user",   content: context },
  ];

  try {
    const result = await model.chat(messages, {
      maxTokens: 800,
      taskHint,
      temperature: 0.05,  // near-deterministic for planning
    });
    return parsePlan(result.content);
  } catch {
    return null;
  }
}

// ─── Plan formatter (for injection into agent context) ────────────────────────

/**
 * Format an ExecutionPlan as a compact text block for injection into the
 * agent's user message. This gives the main loop an explicit roadmap.
 */
export function formatPlanForContext(plan: ExecutionPlan): string {
  const lines: string[] = [
    "EXECUTION PLAN",
    "══════════════════════════════════════════════════",
    `Goal: ${plan.goal}`,
    `Approach: ${plan.approach}`,
  ];

  if (plan.filesToRead.length > 0) {
    lines.push(`Files to read: ${plan.filesToRead.join(", ")}`);
  }
  if (plan.expectedChanges.length > 0) {
    lines.push(`Expected changes: ${plan.expectedChanges.join(", ")}`);
  }
  if (plan.verification) {
    lines.push(`Verification: ${plan.verification}`);
  }

  lines.push(
    "══════════════════════════════════════════════════",
    "Follow this plan. Read the listed files first, make the expected changes, then verify.",
    "Do NOT deviate without a clear reason. Do NOT read files not listed above unless you discover a dependency.",
  );

  return lines.join("\n");
}
