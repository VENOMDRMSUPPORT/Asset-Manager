import { getModelProvider, ModelError, type Message, type MessageContentPart } from "./modelAdapter.js";
import { normalizeModelResponse, buildRetryInstruction, type NormalizeFailureReason } from "./responseNormalizer.js";
import { listDirectory, readFile, writeFile } from "./fileTools.js";
import { runCommand } from "./terminal.js";
import {
  createTask,
  createTaskController,
  getTaskSignal,
  isTaskCancelled,
  updateTaskStatus,
  setTaskMeta,
  addEvent,
  type AgentTask,
  type TaskCompletion,
  type TaskFailureDetail,
} from "./sessionManager.js";
import { broadcastAgentEvent, broadcastTaskUpdate, broadcastTerminalOutput } from "./wsServer.js";
import { getWorkspaceRoot, isWorkspaceSet } from "./safety.js";
import {
  getProjectIndex,
  selectRelevantFiles,
  selectVisualDebugFiles,
  selectVisualAwareFiles,
  extractVisualKeywords,
  buildProjectSummary,
  invalidateProjectIndex,
  type ProjectIndex,
} from "./projectIndex.js";
import { logger } from "./logger.js";

// ─── Event helpers ────────────────────────────────────────────────────────────

function emit(taskId: string, type: Parameters<typeof addEvent>[1], message: string, data?: Record<string, unknown>): void {
  const event = addEvent(taskId, type, message, data);
  broadcastAgentEvent(taskId, event);
}

function failTask(taskId: string, task: AgentTask, summary: string, failure: TaskFailureDetail): void {
  logger.error(
    { taskId, category: failure.category, step: failure.step, detail: failure.detail },
    `Task failed [${failure.category}] at step "${failure.step}": ${failure.title}`
  );
  emit(taskId, "error", `${failure.title}\n\n${failure.detail}`, {
    category: failure.category,
    step: failure.step,
    title: failure.title,
    detail: failure.detail,
  });
  updateTaskStatus(taskId, "error", summary, undefined, failure);
  broadcastTaskUpdate(task);
}

// ─── Conversational bypass ────────────────────────────────────────────────────
// Short greetings and acks go through a single lightweight chat call rather
// than the full agent loop. This prevents "no valid JSON action" parse errors.

const CONVERSATIONAL_RE = /^(hi|hello|hey|thanks|thank you|thx|ty|ok|okay|cool|great|bye|goodbye|yes|no|yep|nope|yeah|sure|got it|sounds good|perfect|nice|alright|what|huh)[\s!.,?]*$/i;

function isConversationalPrompt(prompt: string): boolean {
  const t = prompt.trim();
  if (t.length > 80) return false;
  return CONVERSATIONAL_RE.test(t);
}

// ─── System prompt ────────────────────────────────────────────────────────────
// Enforces: stage discipline, verification after edits, repair protocol,
// evidence-based completion, and minimal-read efficiency.

const SYSTEM_PROMPT = `You are VenomGPT, an expert AI coding assistant that executes software engineering tasks autonomously on a local codebase.

You operate in a strict JSON action loop. Each response must be EXACTLY one valid JSON object — nothing else.

CRITICAL — ONE ACTION PER RESPONSE:
Never combine a think with a write_file or any other action in the same response.
If you want to plan first, send ONLY the think action. Then on the next turn send the next action.
Returning multiple JSON objects in one response will cause a parse error and waste a step.

## Available Actions

{"action":"list_dir","path":"relative/path-or-empty-for-root","reason":"why"}
{"action":"read_file","path":"relative/file/path","reason":"why you need this file"}
{"action":"think","thought":"[STAGE] your analysis"}
{"action":"write_file","path":"relative/file/path","content":"complete file contents","reason":"what changed and why"}
{"action":"run_command","command":"shell command","reason":"why","timeout":60}
{"action":"done","summary":"evidence-based summary","changed_files":["exact list"],"commands_run":["exact list"],"final_status":"complete|partial|blocked","remaining":"unresolved issues or empty"}

## Execution Stages

Always annotate your think actions with a stage tag:

- [PLANNING] — understand the task; identify which files need to change and what verification you will run
- [INSPECTING] — reading files to understand current state before editing
- [EDITING] — about to write a file; explain what will change and why
- [VERIFYING] — confirming the edit or command succeeded
- [REPAIRING] — diagnosing a failure; deciding how to fix it
- [WRAPPING UP] — final review before done; confirming evidence

## Workflow

1. PLAN: identify the minimum files you need to read and what you will change
2. INSPECT: read ONLY the files relevant to the task (do not scan entire project)
3. EDIT: write files one at a time with their COMPLETE content
4. VERIFY: after every write_file, confirm the change is correct:
   - Run a build/lint/type-check command (preferred), OR
   - Read the file back to confirm the content is correct
5. REPAIR: if verification fails, diagnose the specific failure and fix it once
6. SUMMARIZE: report what was done and what evidence confirms it

## Verification Protocol (mandatory)

After every write_file you MUST verify:
- Run the appropriate build/check command (e.g. npx tsc --noEmit, npm test, python -c "import X"), OR
- Read the written file back to confirm the content

Do NOT call done before verifying. A done without verification evidence is a weak completion.

## Repair Protocol

When a command fails or verification fails:
1. Think [REPAIRING]: identify the SPECIFIC error from the output. Read the relevant file or error message.
2. Fix the root cause with write_file (if the content is wrong) or a different command.
3. Verify again after the repair.
4. If the same fix fails twice: call done with final_status "partial" explaining exactly what failed and why.
5. NEVER repeat the exact same failing command. Always change something first.

## Evidence Requirements

Your done action MUST reflect reality:
- changed_files: list EVERY file you actually called write_file on (exact paths, no omissions)
- commands_run: list EVERY command you actually ran with run_command
- summary: explain what was done AND what evidence confirms it (e.g. "TypeScript compiled clean — exit 0", "test passed", "file verified by read-back")
- If something failed or is unfinished: say so honestly in remaining

## Step Discipline

- Maximum 25 steps. Use them efficiently.
- Read the MINIMUM files needed. If the task is "edit function X in file Y", read file Y — not the whole project.
- The project intelligence section above already identifies likely relevant files — start there.
- Do not list directories unless you genuinely need to explore structure.
- Do not read files unrelated to the task.
- Think deeply before reading — plan what you need first.

## Rules

- Use RELATIVE paths only. Never use absolute paths.
- ALWAYS read a file before writing it — never assume file contents. EXCEPTION: if you are creating a brand-new file that does not yet exist, write it directly without reading first.
- Write the COMPLETE file content when using write_file, not snippets or diffs.
- Do not run unnecessary commands or install unrelated packages.
- End with "done" whether the task is complete, partial, or blocked.

## Completion Statuses

- "complete": task is done AND has been verified with real evidence
- "partial": made real progress, but could not fully complete (explain in remaining)
- "blocked": cannot proceed without information or access you do not have (explain in remaining)

## Examples

Example 1 — Adding a utility function with verification:
{"action":"think","thought":"[PLANNING] Need to add a debounce util. Read src/utils.ts first, then verify TypeScript compiles."}
{"action":"read_file","path":"src/utils.ts","reason":"read before writing to avoid conflict"}
{"action":"write_file","path":"src/utils.ts","content":"...complete file...","reason":"added debounce at end"}
{"action":"run_command","command":"npx tsc --noEmit","reason":"verify TypeScript compiles after edit","timeout":30}
{"action":"done","summary":"Added debounce utility to src/utils.ts. TypeScript compiled clean (exit 0).","changed_files":["src/utils.ts"],"commands_run":["npx tsc --noEmit"],"final_status":"complete","remaining":""}

Example 2 — Repair after a failing command:
{"action":"run_command","command":"npm test","reason":"verify the fix","timeout":60}
[test fails with "Cannot find module './auth'"]
{"action":"think","thought":"[REPAIRING] Import path is wrong — file is auth.ts not ./auth. Need to update the import."}
{"action":"read_file","path":"src/index.ts","reason":"read the broken import before fixing it"}
{"action":"write_file","path":"src/index.ts","content":"...corrected import...","reason":"fix import path"}
{"action":"run_command","command":"npm test","reason":"verify repair succeeded","timeout":60}
{"action":"done","summary":"Fixed wrong import path in src/index.ts. npm test now passes.","changed_files":["src/index.ts"],"commands_run":["npm test","npm test"],"final_status":"complete","remaining":""}`;

// ─── Stage-aware status emission ──────────────────────────────────────────────

/**
 * Emit a human-readable stage label BEFORE an action executes.
 * This gives the user a real-time narration of what the agent is doing.
 */
function emitStage(
  taskId:      string,
  step:        number,
  maxSteps:    number,
  actionType:  string,
  action:      Record<string, unknown>,
  lastFailed:  boolean
): void {
  let label: string;

  switch (actionType) {
    case "think": {
      // Extract stage tag from the thought if present
      const thought = String(action["thought"] ?? "");
      const match = thought.match(/^\[(PLANNING|INSPECTING|EDITING|VERIFYING|REPAIRING|WRAPPING UP)\]/i);
      if (match) {
        const stage = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        label = `${stage}…`;
      } else {
        label = "Planning…";
      }
      break;
    }
    case "list_dir": {
      const p = String(action["path"] || "");
      label = `Exploring: ${p || "workspace root"}`;
      break;
    }
    case "read_file": {
      const p = String(action["path"] || "");
      label = `Inspecting: ${p}`;
      break;
    }
    case "write_file": {
      const p = String(action["path"] || "");
      label = `Editing: ${p}`;
      break;
    }
    case "run_command": {
      label = lastFailed ? "Repairing…" : "Verifying…";
      break;
    }
    case "done": {
      label = "Wrapping up…";
      break;
    }
    default: {
      label = `Processing: ${actionType}`;
    }
  }

  emit(taskId, "status", `[${step}/${maxSteps}] ${label}`);
}

// ─── Action executor ──────────────────────────────────────────────────────────

interface ActionResult {
  success: boolean;
  output: string;
}

const MAX_CONTENT_CHARS       = 80_000;
const MAX_CONSECUTIVE_PARSE_FAILURES = 3;
const DEFAULT_COMMAND_TIMEOUT_S = 120;
const MAX_COMMAND_TIMEOUT_S     = 300;

function pruneMessages(messages: Message[]): Message[] {
  const total = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : 500), 0);
  if (total <= MAX_CONTENT_CHARS) return messages;

  const system = messages[0];
  const rest   = messages.slice(1);
  const keepCount = 8;
  const kept = rest.slice(-keepCount);

  logger.warn({ before: rest.length, after: kept.length }, "Pruned message history to fit context window");
  return [system, ...kept];
}

function formatDirectoryTree(entries: Awaited<ReturnType<typeof listDirectory>>, indent = ""): string {
  return entries
    .map((e) => {
      if (e.type === "directory") {
        const children = e.children ? formatDirectoryTree(e.children, indent + "  ") : "";
        return `${indent}${e.name}/\n${children}`;
      }
      return `${indent}${e.name}`;
    })
    .join("\n");
}

async function executeAction(
  action:  Record<string, unknown>,
  taskId:  string,
  signal?: AbortSignal
): Promise<ActionResult> {
  const actionType = String(action["action"] ?? "");

  switch (actionType) {
    case "think": {
      const thought = String(action["thought"] ?? "");
      logger.debug({ taskId, actionType: "think" }, `Think: ${thought.slice(0, 120)}`);
      emit(taskId, "thought", thought);
      return { success: true, output: "Thought noted." };
    }

    case "list_dir": {
      const relPath = String(action["path"] ?? "");
      logger.debug({ taskId, actionType: "list_dir", path: relPath }, "Listing directory");
      try {
        const entries = await listDirectory(relPath);
        const tree = formatDirectoryTree(entries);
        return { success: true, output: `Directory listing:\n${tree || "(empty)"}` };
      } catch (err) {
        logger.warn({ taskId, path: relPath, err }, "list_dir failed");
        return { success: false, output: `Error listing directory: ${String(err)}` };
      }
    }

    case "read_file": {
      const filePath = String(action["path"] ?? "");
      logger.debug({ taskId, actionType: "read_file", path: filePath }, "Reading file");
      emit(taskId, "file_read", `Reading: ${filePath}`, { path: filePath });
      try {
        const { content } = await readFile(filePath);
        const MAX_CHARS = 12_000;
        const preview = content.length > MAX_CHARS
          ? content.slice(0, MAX_CHARS) + `\n...[truncated — file is ${content.length} chars total]`
          : content;
        return { success: true, output: `File contents of ${filePath}:\n\`\`\`\n${preview}\n\`\`\`` };
      } catch (err) {
        logger.warn({ taskId, path: filePath, err }, "read_file failed");
        return { success: false, output: `Error reading file: ${String(err)}` };
      }
    }

    case "write_file": {
      const filePath = String(action["path"] ?? "");
      const content  = String(action["content"] ?? "");
      const reason   = String(action["reason"] ?? "");
      logger.debug({ taskId, actionType: "write_file", path: filePath, bytes: content.length }, "Writing file");
      emit(taskId, "file_write", `Writing: ${filePath}`, { path: filePath, reason });
      try {
        await writeFile(filePath, content);
        return { success: true, output: `File written: ${filePath} (${content.length} chars). Now verify this change is correct.` };
      } catch (err) {
        logger.warn({ taskId, path: filePath, err }, "write_file failed");
        return { success: false, output: `Error writing file: ${String(err)}` };
      }
    }

    case "run_command": {
      const command           = String(action["command"] ?? "");
      const requestedTimeoutS = Number(action["timeout"]) || DEFAULT_COMMAND_TIMEOUT_S;
      const timeoutMs         = Math.min(Math.max(requestedTimeoutS, 5), MAX_COMMAND_TIMEOUT_S) * 1000;

      logger.info({ taskId, actionType: "run_command", command, timeoutS: timeoutMs / 1000 }, "Running command");
      emit(taskId, "command", `Running: ${command}`, { command, timeoutS: timeoutMs / 1000 });

      let outputBuffer = "";
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushOutput = () => {
        if (outputBuffer) {
          const chunk = outputBuffer;
          outputBuffer = "";
          broadcastTerminalOutput(chunk);
        }
      };

      const scheduleFlush = () => {
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            flushOutput();
          }, 150);
        }
      };

      try {
        const result = await runCommand(
          command,
          (data) => { outputBuffer += data; scheduleFlush(); },
          timeoutMs,
          signal
        );

        if (flushTimer) clearTimeout(flushTimer);
        flushOutput();

        logger.info({ taskId, command, exitCode: result.exitCode }, "Command finished");

        const stdoutPreview = result.stdout.slice(0, 4_000);
        const stderrPreview = result.stderr.slice(0, 2_000);
        const output = [
          `Exit code: ${result.exitCode}`,
          result.stdout ? `stdout:\n${stdoutPreview}${result.stdout.length > 4_000 ? "\n...[truncated]" : ""}` : "",
          result.stderr ? `stderr:\n${stderrPreview}${result.stderr.length > 2_000 ? "\n...[truncated]" : ""}` : "",
        ].filter(Boolean).join("\n");

        const exitLabel = result.exitCode === 0 ? "✓" : `✗ exit ${result.exitCode}`;
        emit(taskId, "command_output", `${exitLabel}: ${command.slice(0, 80)}`);

        return { success: result.exitCode === 0, output };
      } catch (err) {
        if (flushTimer) clearTimeout(flushTimer);
        flushOutput();
        logger.warn({ taskId, command, err }, "Command threw an error");
        return { success: false, output: `Command error: ${String(err)}` };
      }
    }

    case "done": {
      return { success: true, output: String(action["summary"] ?? "Task complete.") };
    }

    default: {
      return {
        success: false,
        output: `Unknown action: "${actionType}". Valid: think, list_dir, read_file, write_file, run_command, done.`,
      };
    }
  }
}

// ─── Visual task classification ───────────────────────────────────────────────

interface VisualTaskMeta {
  isVisual:   boolean;
  imageCount: number;
}

function classifyTask(images: string[]): VisualTaskMeta {
  return { isVisual: images.length > 0, imageCount: images.length };
}

// ─── Visual analysis (phase 1 of multimodal tasks) ───────────────────────────
//
// When images are attached, this function calls the vision model (glm-4.6v on
// the PAAS lane) BEFORE the main agentic loop.  The resulting analysis is
// plain text that gets prepended to the main agent's user context — so the
// agentic model (glm-5.1, Anthropic lane) never receives raw image data.
//
// This two-phase design lets the best vision model handle image understanding
// while the best coding model handles planning + execution.

// ─── Visual task intent classification ────────────────────────────────────────
//
// Five distinct image-task categories, classified by prompt language:
//
//   "describe"  — "what is this?", "explain this error", "what do you see?"
//                 User wants a direct natural-language answer. No file writing.
//                 Fastest path: vision → direct done (0 agent file ops).
//
//   "report"    — "write a file about this", "document this error", "save a report"
//                 User wants findings written to a file.
//                 Path: vision → write_file → verify → done.
//
//   "fix"       — "fix this layout bug", "why is X broken", "something is wrong"
//                 User wants a specific defect found and repaired in the code.
//                 Path: vision → inspect CSS files → edit → verify → done.
//
//   "improve"   — "improve this UI", "make this better", "enhance this component"
//                 User wants general UX/visual improvements, not bug fixes.
//                 Path: vision → explore relevant files → implement improvements → verify.
//
//   "analyze"   — "analyze this design", "audit this UI", "review this component"
//                 User wants a comprehensive assessment without a specific fix target.
//                 Path: vision → write analysis file or respond directly → done.
//
// Classification uses a priority-ordered set of rules. The first matching rule wins.
// Default (no match): "fix" — safest fallback, least likely to omit useful work.

export type VisualIntent = "describe" | "report" | "fix" | "improve" | "analyze";

// Matches pure explanatory/conversational questions with no action keyword.
// Intentionally conservative — FIX_RE runs BEFORE this in the classifier.
const DESCRIBE_RE  = /^(what|explain|tell me|can you explain|show me what|is this|how (does|is) (this|the)|what('s| is| are| do| can| did))\b|^(summarize|what do you (see|notice|think)|what (happened|is happening|does this|is shown))|^(i (don't|do not|can't|cannot) understand)/i;
const DESCRIBE_RE2 = /\b(what('s| is| are| does)|explain (this|the|what|why|how)|tell me (about|what|why|how)|what (error|message|issue|problem|text|does this|is this|do you see)|why (is|does|did|are|isn't|doesn't)\s+(there|this|that|the)|how (does|is) (this|the)|summarize (this|the)|what (happened|is happening)|understand (this|what))\b/i;

// Explicit file write or document request — highest priority.
const REPORT_RE    = /\b(write|create|save|generate|produce|make)\b.{0,50}\b(file|report|document|note|description|summary|info|log)\b|\b(document|record|log|put|capture)\b.{0,40}\b(error|issue|problem|bug|warning|exception|crash|fail|screen|screenshot|visible|shown)\b/i;

// UI/UX enhancement suggestions, not defect repair.
// Handles "make X look better", "make X nicer", "make it better" etc.
const IMPROVE_RE   = /\b(improve|enhance|make\s+(?:it\s+|this\s+|the\s+)?(?:\w+\s+)?(better|nicer|cleaner|faster|smoother)|upgrade|refine|polish|suggest(ions?)?|recommendation|how (can|could|should|to) (improve|enhance|make|be better))\b/i;

// Comprehensive assessment — "analyze" needs full word forms (not just prefix)
// because \b would fail inside multi-char words like "analyze" with prefix "analyz".
const ANALYZE_RE   = /\b(analyz[a-z]*|analys[a-z]*|audit|review|assess[a-z]*|evaluat[a-z]*|examine|go through|look over|check (the|this|my)|what('s| is) wrong with|overview of|assessment of)\b/i;

// Specific defect to repair — tested BEFORE describe so "why is X misaligned"
// routes to fix rather than matching the "why is" describe prefix.
const FIX_RE       = /\b(fix|repair|resolve|broken|not working|doesn'?t work|wrong|issue|bug|defect|glitch|misaligned|overflow(ing)?|clipping|layout (problem|issue|bug)|off by|too (wide|narrow|tall|short|big|small)|overlapping|doesn'?t (show|render|display|load|work)|not (showing|rendering|displaying|loading))\b/i;

export function classifyVisualIntent(prompt: string): VisualIntent {
  const p = prompt.trim();
  // 1. Report: explicit file write intent — always highest priority
  if (REPORT_RE.test(p))                            return "report";
  // 2. Improve: enhancement / suggestion language
  if (IMPROVE_RE.test(p))                           return "improve";
  // 3. Analyze: comprehensive assessment language
  if (ANALYZE_RE.test(p))                           return "analyze";
  // 4. Fix: specific defect keywords — runs BEFORE describe so that
  //    "why is X misaligned" routes to fix rather than to describe
  if (FIX_RE.test(p))                               return "fix";
  // 5. Describe: pure conversational/explanatory questions
  if (DESCRIBE_RE.test(p) || DESCRIBE_RE2.test(p)) return "describe";
  // Default: fix is safest when intent is ambiguous and an image is attached
  return "fix";
}

// ─── Vision analysis system prompts — one per intent ─────────────────────────

// "describe": concise natural-language explanation, no jargon required
const VISION_DESCRIBE_SYSTEM = `You are a helpful assistant who explains what is visible in screenshots clearly and concisely.
Your job: look at the screenshot(s) and give a clear, direct answer to the user's question.
Rules:
• Only describe what is literally visible. Do not invent hidden state, server errors, or root causes.
• Use plain language. Avoid CSS/engineering jargon unless the user asked for it.
• Quote any visible error messages or text verbatim.
• If you cannot determine something from the screenshot alone, say so explicitly.
• Be concise. Answer the question directly.`;

// "report": grounded 3-section structured description for file writing
const VISION_REPORT_SYSTEM = `You are a software debugging assistant. Your job is to look at a screenshot and produce a concise, strictly grounded description of what is visible.
Strict grounding rules — you MUST follow these:
• OBSERVED section: only facts directly readable from the screenshot. Quote error messages verbatim. No inference, no speculation.
• LIKELY INFERENCE section: reasonable conclusions drawn from visible evidence. Each item MUST be labelled "INFERENCE:".
• CANNOT CONFIRM section: anything that cannot be determined from the screenshot alone — hidden logs, server state, API calls, root causes not shown visually. List explicitly.
Never invent: server-side error codes, API failures, hidden terminal output, entitlement issues, or CSS root causes — unless literally printed in the screenshot.
Be brief and factual. Stop after the three sections.`;

// "fix": precise CSS defect forensics for targeted bug repair
const VISION_FIX_SYSTEM = `You are a senior frontend engineer specialised in diagnosing visual defects in web and mobile applications from screenshots.
Your job: examine the screenshot(s) and produce a precise, code-actionable defect report a developer can use to open the right file and fix the right CSS rule.
Rules:
• Report only what is VISUALLY PRESENT. Never invent invisible state.
• Label findings as OBSERVED (visible fact) or INFERRED (inference from visible evidence).
• Use CSS vocabulary precisely: flex, grid, overflow, z-index, position, margin, padding, gap, etc.
• Be spatially precise: TOP/BOTTOM/LEFT/RIGHT, inside/outside which container, which layer.
• Name UI regions clearly: navbar, sidebar, card, modal, table row, button, form field, panel.
• When content is cut off or obscured, say so explicitly.
• List multiple defects individually — do not group them.`;

// "improve": UX/visual enhancement opportunities, not bug fixes
const VISION_IMPROVE_SYSTEM = `You are a senior UX and frontend engineer reviewing a UI for improvement opportunities.
Your job: identify concrete, implementable improvements to the visible UI — not bugs, but enhancements.
Rules:
• Focus on: spacing, visual hierarchy, typography, color contrast, alignment, component density, empty states, feedback affordances.
• For each improvement, state: CURRENT STATE → SUGGESTED CHANGE → EXPECTED BENEFIT.
• Be specific about what CSS or component change would achieve each improvement.
• Do not invent problems that aren't visible. Only suggest changes based on what you actually see.
• Prioritize: high-impact changes first. Limit to the 5 most valuable improvements.`;

// "analyze": balanced comprehensive assessment without a specific fix target
const VISION_ANALYZE_SYSTEM = `You are a senior frontend engineer and UX reviewer conducting a structured analysis of a UI screenshot.
Your job: provide a balanced, comprehensive assessment covering both strengths and areas for improvement.
Structure your analysis as:
• WHAT IS SHOWN: describe what you see clearly (components, layout, content)
• WORKING WELL: what is implemented correctly, following good practices
• AREAS FOR IMPROVEMENT: specific issues or enhancement opportunities (label as bugs vs enhancements)
• PRIORITY RECOMMENDATION: the single most impactful change to make next
Rules:
• Be grounded in what is visible. Label inferences as such.
• Avoid vague praise or vague criticism — be specific.
• Do not invent server state or hidden errors not visible in the screenshot.`;

// ─── Token budgets per intent ──────────────────────────────────────────────────
// Sized to the minimum needed to produce a useful response for each path.
// Smaller budgets → faster responses. Only "fix" needs full forensics detail.

const VISION_MAX_TOKENS: Record<VisualIntent, number> = {
  describe:  700,   // concise answer, no sections needed
  report:   1200,   // 3 structured sections
  fix:      2500,   // 5-section defect forensics (reduced from 3500)
  improve:  1800,   // 5 prioritized improvement items
  analyze:  1800,   // 4-section balanced assessment
};

// ─── Vision analysis prompts per intent ───────────────────────────────────────

function buildVisionPrompt(intent: VisualIntent, userPrompt: string, countLabel: string): string {
  switch (intent) {
    case "describe":
      return `User question: "${userPrompt}"

Look at ${countLabel} and answer the user's question directly.
Quote any visible error messages or text verbatim.
Only describe what you can actually see. If something cannot be determined from the screenshot, say so.
Be concise and direct.`;

    case "report":
      return `Developer task: "${userPrompt}"

Examine ${countLabel} and produce a grounded description using exactly these three sections:

## OBSERVED
List every fact directly visible: error messages (quote verbatim), UI elements, text content, visible state, colour, position. Include nothing not actually shown.

## LIKELY INFERENCE
Conclusions reasonably drawn from visible evidence. Label every item with "INFERENCE:".

## CANNOT CONFIRM
What cannot be determined from this screenshot alone: hidden logs, server state, API calls, root causes not on screen. Be specific.

Keep each section concise. Quote error text exactly as shown.`;

    case "fix":
      return `Developer task: "${userPrompt}"

Examine ${countLabel}. Produce a code-actionable defect report.

## 1. VISIBLE STATE
Each distinct UI region visible: current visual state, layout, text content, styling. Note viewport position.

## 2. DEFECTS FOUND
For each defect: (a) describe precisely what is wrong, (b) where in the viewport, (c) which element/component.
Categories to check: spacing/alignment, overflow/clipping, flex/grid layout, z-index/stacking, sizing, typography, color/style, component state, responsive/viewport.
Write "✓ none observed" for categories with no defect.

## 3. CSS ROOT-CAUSE INFERENCE
For each defect: "[Defect] → LIKELY|POSSIBLE CAUSE: [CSS property]". Label confidence.

## 4. COMPONENT OWNERSHIP
For each defect: (a) visible element with symptom, (b) likely parent component responsible, (c) fix location: inline | component CSS | shared stylesheet | parent container.

## 5. LIMITS
What cannot be confirmed without reading source code? Be specific.

Be direct. Developer must be able to open the right file and find the right rule.`;

    case "improve":
      return `Developer task: "${userPrompt}"

Review ${countLabel} for UI/UX improvement opportunities (not bugs — enhancements).

List the top 5 improvements in priority order. For each:

IMPROVEMENT [N]: [Brief title]
CURRENT: [What you see now]
CHANGE: [Specific CSS/component change to make]
BENEFIT: [Why this improves the user experience]

Focus on: visual hierarchy, spacing consistency, typography, color contrast, alignment, density, affordances.
Only suggest changes based on what is actually visible. Be specific about implementation.`;

    case "analyze":
      return `Developer task: "${userPrompt}"

Provide a structured analysis of ${countLabel}.

## WHAT IS SHOWN
Describe the UI: components visible, layout, content, purpose.

## WORKING WELL
What is implemented correctly or follows good practices? Be specific.

## AREAS FOR IMPROVEMENT
List specific issues. For each: label as BUG (functional defect) or ENHANCEMENT (quality improvement). State what change is needed.

## PRIORITY RECOMMENDATION
The single most impactful change to make next, and why.

Be grounded in what is visible. Label inferences as such. Do not invent hidden errors.`;
  }
}

async function analyzeVisualContext(
  model:      ReturnType<typeof getModelProvider>,
  images:     string[],
  userPrompt: string,
  taskId:     string,
  intent:     VisualIntent
): Promise<string> {
  const imageCount = images.length;
  const countLabel = imageCount > 1 ? `${imageCount} screenshots` : "this screenshot";
  const systemMap: Record<VisualIntent, string> = {
    describe: VISION_DESCRIBE_SYSTEM,
    report:   VISION_REPORT_SYSTEM,
    fix:      VISION_FIX_SYSTEM,
    improve:  VISION_IMPROVE_SYSTEM,
    analyze:  VISION_ANALYZE_SYSTEM,
  };

  emit(taskId, "status", `Analyzing ${countLabel} [${intent}] with vision model…`);
  logger.info({ taskId, imageCount, intent }, "[VenomGPT] Starting visual analysis phase");

  const imageParts: MessageContentPart[] = images.map(url => ({
    type:      "image_url",
    image_url: { url },
  }));

  const promptText = buildVisionPrompt(intent, userPrompt, countLabel);
  const maxTokens  = VISION_MAX_TOKENS[intent];

  const analysisMessages: Message[] = [
    { role: "system", content: systemMap[intent] },
    { role: "user",   content: [{ type: "text", text: promptText }, ...imageParts] },
  ];

  const result = await model.chat(analysisMessages, { maxTokens, taskHint: "vision" });

  logger.info(
    { taskId, intent, analysisLength: result.content.length, model: result.modelUsed, lane: result.laneUsed, maxTokens },
    `[VenomGPT] Visual analysis complete (${intent} path)`
  );

  const preview = result.content.slice(0, 400) + (result.content.length > 400 ? "…" : "");
  emit(taskId, "thought", `[INSPECTING] Visual analysis — ${intent} (${result.modelUsed ?? "vision model"}):\n${preview}`);

  return result.content;
}

// ─── Visual-to-code bridge ────────────────────────────────────────────────────
//
// Phase 07: After visual analysis succeeds, this function builds a structured
// bridge between the vision model's findings and actual file-system targets.
//
// It extracts keywords from the visual analysis text (component names, CSS
// terms, UI region names) and uses those — in addition to the user's original
// prompt keywords — to score and rank files in the project index.
//
// The result is a formatted section that tells the agent:
//   - which files visually-derived evidence points to (and why)
//   - what visual terms were extracted from the analysis
//   - how to sequence its inspection given the evidence
//
// This replaces the previous approach of scoring files only on the user prompt,
// which missed the richer vocabulary produced by the vision model.

function buildVisualCodeBridge(
  index:         ProjectIndex,
  userPrompt:    string,
  visualContext: string,
  maxFiles:      number = 8
): string {
  const scored    = selectVisualAwareFiles(index, userPrompt, visualContext, maxFiles);
  const keywords  = extractVisualKeywords(visualContext);

  const lines: string[] = [];

  lines.push("VISUAL-CODE BRIDGE:");
  lines.push("(Evidence-grounded file targets derived from screenshot analysis + project index)");
  lines.push("");

  if (keywords.length > 0) {
    lines.push(`Visual terms extracted from screenshot: ${keywords.slice(0, 12).join(", ")}`);
    lines.push("");
  }

  if (scored.length === 0) {
    lines.push("No files scored above threshold for visual-debug relevance.");
    lines.push("Inspect: CSS/style files and layout components at the project root first.");
  } else {
    lines.push("Ranked file targets (visual evidence + prompt relevance combined):");
    for (const { file, reasons } of scored) {
      const reasonStr = reasons.length > 0 ? ` — ${reasons.slice(0, 3).join("; ")}` : "";
      lines.push(`  ${file.path}${reasonStr}`);
    }
    lines.push("");
    lines.push("Start inspection from the TOP of this list.");
    lines.push("If a file does not contain the defect, move to the next.");
    lines.push("Do NOT read files below the visible defect's ownership area.");
  }

  return lines.join("\n");
}

// ─── Main task runner ─────────────────────────────────────────────────────────

export async function runAgentTask(prompt: string, images: string[] = []): Promise<AgentTask> {
  const taskMeta      = classifyTask(images);
  const visualIntent  = taskMeta.isVisual ? classifyVisualIntent(prompt) : "fix";
  const task     = createTask(prompt);
  const taskId   = task.id;
  createTaskController(taskId);

  // Stamp imageCount and visualIntent immediately so the UI can show them
  if (taskMeta.isVisual) {
    setTaskMeta(taskId, { imageCount: taskMeta.imageCount, visualIntent });
  }

  broadcastTaskUpdate(task);

  (async () => {
    try {
      updateTaskStatus(taskId, "running");
      logger.info({ taskId, prompt: prompt.slice(0, 100) }, "Agent task started");

      // ── Workspace validation ──────────────────────────────────────────────
      const wsRoot = isWorkspaceSet() ? getWorkspaceRoot() : null;
      emit(taskId, "status", `Workspace: ${wsRoot ?? "not configured"}`);

      if (!wsRoot) {
        failTask(taskId, task, "Workspace not configured", {
          title: "Workspace root is not configured",
          detail: "Set a workspace directory in the UI before running tasks.",
          step: "workspace_validation",
          category: "workspace",
        });
        return;
      }

      // ── Conversational bypass ─────────────────────────────────────────────
      if (isConversationalPrompt(prompt)) {
        logger.info({ taskId, prompt }, "Conversational prompt — direct response path");
        emit(taskId, "status", "Responding…");

        let model;
        try {
          model = getModelProvider();
        } catch (err) {
          const isModelError = err instanceof ModelError;
          failTask(taskId, task, `Model error: ${isModelError ? err.message : String(err)}`, {
            title: isModelError ? err.message : "Failed to initialize AI model",
            detail: isModelError ? `Category: ${err.category}\nTechnical: ${err.technical}` : String(err),
            step: "model_initialization",
            category: "model",
          });
          return;
        }

        try {
          let reply = "";
          await model.chat(
            [
              { role: "system", content: "You are VenomGPT, a friendly AI coding assistant. Reply briefly and naturally." },
              { role: "user", content: prompt },
            ],
            { maxTokens: 200, taskHint: "conversational" }
          ).then((r) => { reply = r.content; });

          emit(taskId, "thought", reply);
          const completion: TaskCompletion = {
            summary: reply, changed_files: [], commands_run: [], final_status: "complete", remaining: "",
          };
          emit(taskId, "done", reply, { changed_files: [], commands_run: [], final_status: "complete", remaining: "" });
          updateTaskStatus(taskId, "done", reply, completion);
          broadcastTaskUpdate(task);
        } catch (err) {
          const isModelError = err instanceof ModelError;
          failTask(taskId, task, `Model call failed: ${isModelError ? err.message : String(err)}`, {
            title: isModelError ? err.message : "AI model call failed",
            detail: isModelError ? `Category: ${err.category}\nTechnical: ${err.technical}` : String(err),
            step: "conversational_call",
            category: "model",
          });
        }
        return;
      }

      // ── Project intelligence ──────────────────────────────────────────────
      // Build (or retrieve from cache) the project index and select files
      // likely relevant to this specific prompt. This replaces the raw
      // full-tree dump with a focused, metadata-enriched summary.
      //
      // Skip for "describe" visual intent: user wants a direct answer from the
      // screenshot — no file reading, writing, or CSS inspection needed.
      // Skipping saves ~1–2s of I/O and avoids injecting irrelevant file context.

      let workspaceSnapshot = "";
      let projectIntelligence = "";
      let projectIndex: ProjectIndex | null = null;   // kept for visual debug file selection

      const skipWorkspaceScan = taskMeta.isVisual && visualIntent === "describe";

      if (skipWorkspaceScan) {
        emit(taskId, "status", "Describe intent — skipping workspace scan…");
        logger.debug({ taskId, visualIntent }, "[VenomGPT] Workspace scan skipped (describe path)");
      } else {
        emit(taskId, "status", "Analysing workspace…");
        try {
          // Raw tree (root level only for large projects — kept for structure overview)
          const entries = await listDirectory("");
          workspaceSnapshot = formatDirectoryTree(entries);

          // Project index with relevance scoring
          const index = await getProjectIndex(wsRoot);
          projectIndex = index;  // exposed for visual debug file selection below
          const relevantFiles = selectRelevantFiles(index, prompt, 20);
          projectIntelligence = buildProjectSummary(index, relevantFiles);

          emit(taskId, "status", `Workspace ready — ${index.totalFiles} files indexed`);
          logger.debug({ taskId, totalFiles: index.totalFiles, relevantFiles: relevantFiles.length }, "Project index ready");
        } catch (err) {
          workspaceSnapshot = "(could not read workspace)";
          projectIntelligence = "";
          logger.warn({ taskId, err }, "Could not build project index — continuing");
        }
      }

      // ── Model initialization ──────────────────────────────────────────────
      let model;
      try {
        model = getModelProvider();
        logger.info({ taskId }, "Model provider acquired");
      } catch (err) {
        const isModelError = err instanceof ModelError;
        failTask(taskId, task, `Model configuration error: ${isModelError ? err.message : String(err)}`, {
          title: isModelError ? err.message : "Failed to initialize AI model",
          detail: isModelError
            ? `Category: ${err.category}\nTechnical: ${err.technical}\n\nTip: Ensure ZAI_API_KEY is set.`
            : String(err),
          step: "model_initialization",
          category: "model",
        });
        return;
      }

      // ── Multimodal intake (phase 1: visual analysis) ──────────────────────
      // If the task includes images, visual analysis MUST succeed before the
      // agent loop starts.  There is no silent text-only fallback for visual
      // tasks — if vision is unavailable the task is failed honestly so the
      // developer knows exactly what happened and can resubmit appropriately.
      //
      // Success  → rich visual context injected into the agent's prompt.
      // Failure  → task fails with a clear, specific explanation.  Period.
      let visualContext = "";

      if (taskMeta.isVisual) {
        emit(taskId, "status", `Visual task — ${taskMeta.imageCount} image${taskMeta.imageCount > 1 ? "s" : ""} attached`);
        logger.info({ taskId, imageCount: taskMeta.imageCount, visualIntent }, "[VenomGPT] Visual task detected");

        // ── Provider-level vision check ───────────────────────────────────
        // Some providers (Replit OpenAI integration) have no vision model at
        // all.  Fail immediately rather than dropping into a text-only loop.
        if (!model.isVisionCapable()) {
          setTaskMeta(taskId, { visionStatus: "unavailable" });
          logger.warn({ taskId }, "[VenomGPT] Visual task blocked — provider has no vision capability");
          failTask(taskId, task, "Screenshot analysis requires a vision-capable AI provider", {
            title: "Vision not available on current provider",
            detail:
              `This task includes ${taskMeta.imageCount} screenshot${taskMeta.imageCount > 1 ? "s" : ""} ` +
              `but the current AI provider does not support vision models.\n\n` +
              `To analyse screenshots, set ZAI_API_KEY to use Z.AI (glm-4.6v / glm-4.6v-flash).\n\n` +
              `If you need text-based code assistance without the screenshots, resubmit the task without attaching images.`,
            step: "visual_analysis",
            category: "model",
          });
          return;
        }

        // ── Vision model call ─────────────────────────────────────────────
        try {
          visualContext = await analyzeVisualContext(model, images, prompt, taskId, visualIntent);
          setTaskMeta(taskId, { visionStatus: "success" });
          emit(taskId, "status", `Visual analysis complete [${visualIntent}] — proceeding…`);
        } catch (err) {
          const isModelError = err instanceof ModelError;
          const category = isModelError ? err.category : "unknown";
          const shortReason = isModelError ? err.message : String(err);

          // All vision failures → fail the task honestly.
          // No category is "safe" to silently degrade into a text-only loop;
          // entitlement/rate-limit errors are as blocking as auth errors for a
          // visual task — the screenshot simply cannot be analysed.
          setTaskMeta(taskId, { visionStatus: "degraded" });
          logger.warn(
            { taskId, category, reason: shortReason },
            "[VenomGPT] Visual analysis failed — failing task honestly"
          );
          failTask(taskId, task, "Screenshot analysis could not be completed", {
            title: "Vision model unavailable — screenshot task cannot proceed",
            detail:
              `This task includes ${taskMeta.imageCount} screenshot${taskMeta.imageCount > 1 ? "s" : ""} ` +
              `but the vision model failed (${category}: ${shortReason}).\n\n` +
              `Screenshot analysis was not performed. The task has been stopped to avoid producing ` +
              `a misleading text-only response that ignores the visual content you provided.\n\n` +
              `To resolve:\n` +
              `• Ensure your Z.AI account has the vision model package enabled\n` +
              `• Or resubmit the task without images and describe the visual issue in text`,
            step: "visual_analysis",
            category: "model",
          });
          return;
        }
      }

      // ── Build initial prompt ──────────────────────────────────────────────
      const userPromptParts = [
        `Workspace: ${wsRoot}`,
      ];
      if (projectIntelligence) {
        userPromptParts.push(`Project intelligence:\n${projectIntelligence}`);
      }
      if (workspaceSnapshot) {
        userPromptParts.push(`File structure:\n${workspaceSnapshot}`);
      }

      // ── Visual context + intent-appropriate protocol ──────────────────────
      // Injected only when visual analysis succeeded.
      // Each of the 5 intents gets a purpose-built protocol that matches what
      // the user actually wants done — from a direct answer to a full CSS fix.
      if (visualContext) {
        userPromptParts.push(
          `VISUAL ANALYSIS — ${taskMeta.imageCount} screenshot${taskMeta.imageCount > 1 ? "s" : ""} analysed (${visualIntent} intent):\n\n` +
          visualContext
        );

        switch (visualIntent) {

          case "describe": {
            // ── Describe protocol: vision → respond directly → done ──────────
            // Fastest possible path. No file reads, no file writes, no commands.
            // The agent emits exactly one action: done.
            userPromptParts.push(
              `VISUAL DESCRIBE PROTOCOL:

The visual analysis above contains everything needed to answer the user's question.

STEP 1 — RESPOND: Use the done action immediately. Put your direct answer in the summary field.
  • Answer the user's specific question based on the visual analysis.
  • Quote visible error messages or text verbatim.
  • If something cannot be determined from the screenshot, say so.
  • Be concise and direct.

Do NOT write files. Do NOT read files. Do NOT run commands. Respond with done immediately.`
            );
            logger.debug({ taskId, visualIntent }, "[VenomGPT] Using describe protocol (direct answer)");
            break;
          }

          case "report": {
            // ── Report protocol: vision → write file → verify → done ─────────
            // No CSS investigation. Write findings directly from visual analysis.
            userPromptParts.push(
              `VISUAL REPORT PROTOCOL:

Your task is to write a file containing a grounded description of what was observed in the screenshot(s).

STEP 1 — WRITE: Create the target file immediately. You do NOT need to read any existing files first.
  • Use only the OBSERVED section of the visual analysis as primary evidence.
  • Clearly label LIKELY INFERENCE items as inferences.
  • Do NOT include claims from CANNOT CONFIRM unless explicitly noting the uncertainty.
  • Do NOT invent system-internal failures, API errors, or root causes not visible in the screenshot.

STEP 2 — VERIFY: Read the file back once to confirm the content was written correctly.

STEP 3 — DONE: Report what was written with final_status "complete".

Do NOT read existing code files. Do NOT run build commands. Go directly to write_file.`
            );
            logger.debug({ taskId, visualIntent }, "[VenomGPT] Using report protocol (direct write)");
            break;
          }

          case "fix": {
            // ── Fix protocol: vision → visual-code bridge → inspect → edit → verify ─
            // Phase 07: file selection now scored against BOTH prompt keywords AND
            // keywords extracted from the vision analysis (component names, CSS
            // terms, UI region names).  The bridge section explicitly shows the
            // agent WHY each file was selected so it can prioritise correctly.
            let bridgeSection = "";
            if (projectIndex) {
              const bridgeKeywords = extractVisualKeywords(visualContext);
              bridgeSection = "\n\n" + buildVisualCodeBridge(projectIndex, prompt, visualContext, 8);
              emit(taskId, "status",
                `[Phase07] Visual-code bridge: ${bridgeKeywords.length} terms extracted → file targets ranked`
              );
              logger.debug(
                { taskId, visualTerms: bridgeKeywords.length, bridgeSection: bridgeSection.slice(0, 200) },
                "[VenomGPT][Phase07] Visual-code bridge built for fix intent"
              );
            }
            userPromptParts.push(
              `VISUAL FIX PROTOCOL:${bridgeSection}

STEP 1 — PLANNING: Identify the specific defect(s) and CSS root-cause from the analysis.
  State your plan: which component owns the layout, which CSS property is wrong, what the fix will be.
  Do this BEFORE reading any code.

STEP 2 — INSPECTING: Read files from the VISUAL-CODE BRIDGE ranked list above (most relevant first).
  Stop reading once you have found the exact rule responsible for the visible defect.
  Defect → where to look:
  • Spacing/alignment → padding, margin, gap on container or children
  • Overflow/clipping → overflow: hidden, max-height, height on ancestor containers
  • Flex/grid → display: flex/grid on parent, then justify-content, align-items, flex-wrap, grid-template
  • Z-index/stacking → position: relative/absolute/fixed, z-index, isolation: isolate
  • Sizing → width, height, min-*, max-*, flex-basis, flex-grow, flex-shrink
  • Typography → overflow, text-overflow: ellipsis, white-space: nowrap, max-width on text containers
  • State visibility → conditional class logic, display: none / visibility: hidden, opacity: 0

STEP 3 — EDITING: Fix the CSS rule in the component that OWNS the layout. Write the complete file.

STEP 4 — VERIFYING: Confirm the change targets the exact visual symptom.
  Done action must state: VISUAL DEFECT → FILE → RULE CHANGED → RESOLUTION.`
            );
            logger.debug({ taskId, visualIntent }, "[VenomGPT] Using fix protocol (Phase 07 visual-code bridge)");
            break;
          }

          case "improve": {
            // ── Improve protocol: vision → visual-code bridge → explore → implement ─
            // Phase 07: same bridge approach as fix — scored by visual terms.
            let bridgeSection = "";
            if (projectIndex) {
              const bridgeKeywords = extractVisualKeywords(visualContext);
              bridgeSection = "\n\n" + buildVisualCodeBridge(projectIndex, prompt, visualContext, 8);
              emit(taskId, "status",
                `[Phase07] Visual-code bridge: ${bridgeKeywords.length} terms extracted → component targets ranked`
              );
              logger.debug(
                { taskId, visualTerms: bridgeKeywords.length },
                "[VenomGPT][Phase07] Visual-code bridge built for improve intent"
              );
            }
            userPromptParts.push(
              `VISUAL IMPROVE PROTOCOL:${bridgeSection}

The visual analysis above lists specific UI/UX improvement opportunities.

STEP 1 — PLAN: Decide which improvements from the analysis are highest-value and feasible.
  State which visual-code bridge files you will read first and why.

STEP 2 — EXPLORE: Read the relevant component files (VISUAL-CODE BRIDGE list above) to understand current implementation.
  Focus only on the files that own the components shown in the screenshot.

STEP 3 — IMPLEMENT: Apply the improvements. Each change must trace back to a specific finding in the analysis:
  • Prefer Tailwind utility changes for spacing, color, typography.
  • Prefer component structure changes for hierarchy or density issues.
  • Prefer CSS variable changes for system-wide consistency.
  Do not refactor unrelated code.

STEP 4 — VERIFY: Read the changed file(s) back to confirm edits are correct.

STEP 5 — DONE: Summarize: VISUAL FINDING → CODE CHANGE → EXPECTED RESULT for each improvement made.`
            );
            logger.debug({ taskId, visualIntent }, "[VenomGPT] Using improve protocol (Phase 07 visual-code bridge)");
            break;
          }

          case "analyze": {
            // ── Analyze protocol: vision → assess → optionally inspect code ───
            // Phase 07: for analyze intent, also inject the visual-code bridge
            // so the agent CAN inspect code if the analysis points to specific
            // components — but it must decide whether code inspection is needed.
            let bridgeSection = "";
            if (projectIndex) {
              const bridgeKeywords = extractVisualKeywords(visualContext);
              bridgeSection = "\n\n" + buildVisualCodeBridge(projectIndex, prompt, visualContext, 6);
              if (bridgeKeywords.length > 0) {
                emit(taskId, "status",
                  `[Phase07] Visual-code bridge: ${bridgeKeywords.length} terms → code targets available if needed`
                );
              }
              logger.debug(
                { taskId, visualTerms: bridgeKeywords.length },
                "[VenomGPT][Phase07] Visual-code bridge built for analyze intent"
              );
            }
            userPromptParts.push(
              `VISUAL ANALYZE PROTOCOL:${bridgeSection}

The visual analysis above contains a structured assessment of the screenshot(s).

Determine the most useful response:
• If the user asked for a written analysis/report → write it to a file directly, then verify, then done.
• If the user wants a direct assessment → use done with your analysis as the summary.
• If the analysis identified a specific defect in a named component → you MAY inspect the relevant file
  from the VISUAL-CODE BRIDGE above to verify whether the code matches the visual finding.
  Only do this if it meaningfully improves the quality of the analysis. Do not read files speculatively.

Either way:
  • State what is visually observed, what is inferred, and what remains unconfirmed.
  • Cover both working aspects and areas for improvement.
  • State the single highest-priority actionable next step.
  • Do not invent root causes not shown visually or confirmed by code inspection.`
            );
            logger.debug({ taskId, visualIntent }, "[VenomGPT] Using analyze protocol (Phase 07 with code bridge)");
            break;
          }
        }
      }

      userPromptParts.push(`Task: ${prompt}`);

      const messages: Message[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPromptParts.join("\n\n") },
      ];

      // ── Execution tracking ────────────────────────────────────────────────
      // These track what actually happened for evidence-based completion gates.
      const filesWritten  = new Set<string>();
      const commandsActuallyRun: string[] = [];
      let   lastActionFailed  = false; // did the immediately preceding action fail?
      let   consecutiveRepairs = 0;    // how many consecutive failures in a row?

      const MAX_STEPS               = 25;
      const MAX_CONSECUTIVE_REPAIRS = 3; // give up the repair loop after this many
      let step = 0;
      let consecutiveParseFailures = 0;
      let lastSummary = "Agent reached maximum steps without completing the task.";
      let completion: TaskCompletion | undefined;

      // ── Agent loop ────────────────────────────────────────────────────────
      while (step < MAX_STEPS) {
        if (isTaskCancelled(taskId)) {
          logger.info({ taskId, step }, "Task cancelled by user");
          emit(taskId, "status", "Cancelled by user.");
          updateTaskStatus(taskId, "error", "Cancelled by user.", undefined, {
            title: "Task cancelled",
            detail: "The task was stopped by the user.",
            step: `step_${step}`,
            category: "cancelled",
          });
          broadcastTaskUpdate(task);
          return;
        }

        step++;

        // ── Model call ──────────────────────────────────────────────────────
        let responseText = "";
        try {
          await model.chatStream(
            pruneMessages(messages),
            (chunk) => { responseText += chunk; },
            { maxTokens: 4096, temperature: 0.1, taskHint: "agentic" }
          );
          logger.debug({ taskId, step, responseLength: responseText.length }, "Model response received");
        } catch (err) {
          if (isTaskCancelled(taskId)) {
            emit(taskId, "status", "Cancelled during model call.");
            updateTaskStatus(taskId, "error", "Cancelled by user", undefined, {
              title: "Task cancelled",
              detail: "Stopped during a model call.",
              step: `step_${step}`,
              category: "cancelled",
            });
            broadcastTaskUpdate(task);
            return;
          }
          const isModelError = err instanceof ModelError;
          failTask(taskId, task, `Model error at step ${step}: ${isModelError ? err.message : String(err)}`, {
            title: isModelError ? err.message : "AI model call failed",
            detail: isModelError ? `Category: ${err.category}\nTechnical: ${err.technical}` : String(err),
            step: `step_${step}_model_call`,
            category: "model",
          });
          return;
        }

        messages.push({ role: "assistant", content: responseText });

        // ── Response normalization ──────────────────────────────────────────
        const normalized = normalizeModelResponse(responseText);

        if (!normalized.ok) {
          consecutiveParseFailures++;
          const reason: NormalizeFailureReason = normalized.reason;
          const detail = normalized.detail;

          logger.warn(
            { taskId, step, consecutiveParseFailures, reason, responsePreview: responseText.slice(0, 200) },
            `Normalize failed [${reason}]`
          );

          if (consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
            // Final failure — surface as a visible error
            const failMsg = `Model returned ${MAX_CONSECUTIVE_PARSE_FAILURES} unparseable responses in a row.\nLast failure: [${reason}] ${detail.slice(0, 300)}`;
            emit(taskId, "error", failMsg);
            failTask(taskId, task, `Model returned ${MAX_CONSECUTIVE_PARSE_FAILURES} unparseable responses in a row`, {
              title: `Model failed to produce valid JSON ${MAX_CONSECUTIVE_PARSE_FAILURES} times`,
              detail: `Last failure reason: ${reason}\n${detail}`,
              step: `step_${step}_parse`,
              category: "orchestration",
            });
            return;
          }

          // Early failure (attempt 1 or 2) — emit a quiet status, not an error.
          // Most models recover on the first retry; showing a red error card is noisy.
          emit(taskId, "status", `Retrying response format (attempt ${consecutiveParseFailures})…`);

          const retryMsg = buildRetryInstruction(reason, responseText.slice(0, 300));
          messages.push({ role: "user", content: retryMsg });
          continue;
        }

        consecutiveParseFailures = 0;

        const { action, method, warning } = normalized;
        // Only log non-trivial normalization paths
        if (method !== "direct_parse" && method !== "fence_stripped") {
          logger.debug({ taskId, step, method, warning }, `Response normalized via ${method}`);
        }
        if (warning && method !== "json_repaired") {
          // json_repaired is expected and not concerning — skip the warn log
          logger.warn({ taskId, step, method, warning }, "Normalization warning");
        }

        const actionType = String(action["action"] ?? "");

        // ── Emit stage label before executing ──────────────────────────────
        emitStage(taskId, step, MAX_STEPS, actionType, action, lastActionFailed);

        // ── Done action ─────────────────────────────────────────────────────
        if (actionType === "done") {
          const summary     = String(action["summary"] ?? "Task complete.");
          const changedFiles = Array.isArray(action["changed_files"])
            ? (action["changed_files"] as unknown[]).map(String)
            : [];
          const commandsRun = Array.isArray(action["commands_run"])
            ? (action["commands_run"] as unknown[]).map(String)
            : [];
          const finalStatus = ["complete", "partial", "blocked"].includes(String(action["final_status"]))
            ? (String(action["final_status"]) as TaskCompletion["final_status"])
            : "complete";
          const remaining = String(action["remaining"] ?? "");

          // ── Evidence cross-check ────────────────────────────────────────
          // Compare what the agent CLAIMS it changed vs. what was ACTUALLY written.
          // Log a warning if there's a discrepancy but don't block the completion.
          const unclaimedWrites = [...filesWritten].filter(f => !changedFiles.includes(f));
          const phantomClaims   = changedFiles.filter(f => filesWritten.size > 0 && !filesWritten.has(f));

          if (unclaimedWrites.length > 0) {
            logger.warn({ taskId, unclaimedWrites }, "Agent did not list all written files in done.changed_files");
            emit(taskId, "status", `Note: unclaimed file writes: ${unclaimedWrites.join(", ")}`);
          }
          if (phantomClaims.length > 0) {
            logger.warn({ taskId, phantomClaims }, "Agent claimed files in done.changed_files that were never written");
          }

          // Use actual tracked data to augment claimed lists
          const mergedChangedFiles = [...new Set([...changedFiles, ...unclaimedWrites])];
          const mergedCommandsRun  = commandsActuallyRun.length > 0
            ? [...new Set([...commandsRun, ...commandsActuallyRun])]
            : commandsRun;

          completion = {
            summary,
            changed_files: mergedChangedFiles,
            commands_run:  mergedCommandsRun,
            final_status:  finalStatus,
            remaining,
          };
          lastSummary = summary;

          logger.info({ taskId, step, finalStatus, mergedChangedFiles, mergedCommandsRun }, "Task completed");
          emit(taskId, "done", summary, {
            changed_files: mergedChangedFiles,
            commands_run:  mergedCommandsRun,
            final_status:  finalStatus,
            remaining,
          });
          break;
        }

        // ── Execute action ──────────────────────────────────────────────────
        const signal = getTaskSignal(taskId);
        logger.debug({ taskId, step, actionType }, "Executing action");
        const result = await executeAction(action, taskId, signal);

        if (isTaskCancelled(taskId)) {
          emit(taskId, "status", "Cancelled.");
          updateTaskStatus(taskId, "error", "Cancelled by user", undefined, {
            title: "Task cancelled",
            detail: "Stopped after an action completed.",
            step: `step_${step}_${actionType}`,
            category: "cancelled",
          });
          broadcastTaskUpdate(task);
          return;
        }

        // ── Update execution tracking ───────────────────────────────────────
        if (actionType === "write_file" && result.success) {
          filesWritten.add(String(action["path"] ?? ""));
          // After a successful write, invalidate the project index so the next
          // task sees the updated file metadata (recency, size).
          invalidateProjectIndex();
        }

        if (actionType === "run_command") {
          commandsActuallyRun.push(String(action["command"] ?? ""));
        }

        // ── Repair tracking ─────────────────────────────────────────────────
        const prevFailed = lastActionFailed;
        lastActionFailed = !result.success;

        if (!result.success) {
          consecutiveRepairs++;
          if (consecutiveRepairs >= MAX_CONSECUTIVE_REPAIRS) {
            // Force the agent toward a graceful partial completion rather than
            // continuing to spin on a broken repair loop.
            logger.warn({ taskId, step, consecutiveRepairs }, "Too many consecutive failures — injecting repair-limit nudge");
            messages.push({
              role: "user",
              content: `ERROR: ${result.output}\n\nThis is the ${consecutiveRepairs}rd consecutive failure. You are close to the repair limit. If this cannot be fixed in one more attempt, call done with final_status "partial" and explain exactly what failed in the remaining field.`,
            });
            continue;
          }
        } else {
          consecutiveRepairs = 0;
        }

        // ── Build tool result message for the model ─────────────────────────
        let resultMsg: string;
        if (result.success) {
          resultMsg = `Result: ${result.output}`;
          // After a write_file, prompt the agent to verify
          if (actionType === "write_file") {
            resultMsg += "\n\nIMPORTANT: You wrote a file. Now VERIFY this change is correct — run a build/lint/type-check command or read the file back before calling done.";
          }
        } else {
          const repairHint = prevFailed
            ? `\nThis is failure #${consecutiveRepairs}. Think [REPAIRING] about what specifically went wrong and try a different approach.`
            : `\nAnalyse this error carefully. Use think [REPAIRING] to diagnose the root cause before retrying.`;
          resultMsg = `ERROR: ${result.output}${repairHint}`;
        }

        messages.push({ role: "user", content: resultMsg });
      }

      // ── Step limit reached ────────────────────────────────────────────────
      if (step >= MAX_STEPS && !completion) {
        logger.warn({ taskId, step }, "Reached maximum step limit");
        emit(taskId, "status", `Reached step limit (${MAX_STEPS}). Stopping.`);
        lastSummary = `Reached step limit (${MAX_STEPS}). Task may be partially complete.`;
        // Attach actual tracked data to the partial completion
        if (filesWritten.size > 0 || commandsActuallyRun.length > 0) {
          completion = {
            summary: lastSummary,
            changed_files: [...filesWritten],
            commands_run:  commandsActuallyRun,
            final_status:  "partial",
            remaining:     "Hit the step limit before task was verified complete.",
          };
        }
      }

      logger.info({ taskId, lastSummary, hasCompletion: !!completion }, "Task finished");
      updateTaskStatus(taskId, "done", lastSummary, completion);
      broadcastTaskUpdate(task);
    } catch (err) {
      logger.error({ taskId: task.id, err }, "Agent loop unexpected error");
      emit(task.id, "error", `Unexpected agent error: ${String(err)}`);
      updateTaskStatus(task.id, "error", String(err), undefined, {
        title: "Unexpected internal error",
        detail: String(err),
        step: "unknown",
        category: "orchestration",
      });
      broadcastTaskUpdate(task);
    }
  })();

  return task;
}
