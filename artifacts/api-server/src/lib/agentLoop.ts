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
// Determines whether a visual task wants a FILE REPORT (describe/document what
// is visible) vs. a CODE FIX (find and repair a CSS/visual defect in the code).
// "report" → fast grounded 3-section prompt, no CSS inference, agent writes directly
// "fix"    → full 6-section CSS defect report, agent inspects files before editing

const VISUAL_REPORT_RE = /\b(write|create|save|generate|produce|make)\b.{0,50}\b(file|report|document|note|description|summary|info|log)\b|\b(document|describe|record|note|log|put|capture)\b.{0,40}\b(error|issue|problem|bug|warning|exception|crash|fail|screen|screenshot|visible|shown)/i;

function classifyVisualIntent(prompt: string): "report" | "fix" {
  return VISUAL_REPORT_RE.test(prompt) ? "report" : "fix";
}

// ─── Vision analysis system prompts ───────────────────────────────────────────

// "fix" path: full 6-section CSS defect forensics (unchanged — only for CSS repair tasks)
const VISION_FIX_SYSTEM = `You are a senior frontend engineer specialised in diagnosing visual defects in web and mobile applications from screenshots.

Your job: examine the screenshot(s) and produce a precise, code-actionable defect report that a developer can use to open the right file and fix the right CSS rule.

Discipline rules:
• Report only what is VISUALLY PRESENT in the screenshot. Never invent or infer invisible state.
• Label every finding as OBSERVED (visible fact) or INFERRED (engineering inference drawn from visible evidence).
• Use frontend/CSS vocabulary precisely: flex, grid, overflow, z-index, position, margin, padding, gap, clip, viewport, breakpoint, transform, align-items, justify-content, min-height, max-width, etc.
• Be spatially precise: describe WHERE in the viewport each defect appears — top/bottom/left/right, inside/outside which container, which layer.
• Name visible UI regions and components clearly: navbar, sidebar, card, modal, table row, button, form field, panel, tab bar, tooltip, overlay, scrollable container, etc.
• When something is cut off, partially obscured, or outside the screenshot boundary, say so explicitly.
• Do not guess at business logic, server state, or framework internals not visible in the screenshot.
• When multiple defects are present, list them individually — do not group them into vague summaries.`;

// "report" path: fast grounded 3-section description — no CSS bias, no fabrication
const VISION_REPORT_SYSTEM = `You are a software debugging assistant. Your job is to look at a screenshot and produce a concise, strictly grounded description of what is visible.

Strict grounding rules — you MUST follow these:
• OBSERVED section: only facts directly readable from the screenshot. Quote error messages verbatim. No inference, no speculation.
• LIKELY INFERENCE section: reasonable conclusions drawn from visible evidence. Each item MUST be labelled "INFERENCE:".
• CANNOT CONFIRM section: anything that cannot be determined from the screenshot alone — hidden logs, server state, API calls, root causes not shown visually. List these explicitly so the reader knows what was NOT confirmed.

Never invent: server-side error codes, API failures, hidden terminal output, entitlement issues, fallback chain failures, or CSS root causes — unless those are literally printed in the screenshot.
Be brief and factual. Stop after the three sections. Do not repeat yourself.`;

async function analyzeVisualContext(
  model:      ReturnType<typeof getModelProvider>,
  images:     string[],
  userPrompt: string,
  taskId:     string,
  intent:     "report" | "fix"
): Promise<string> {
  const imageCount = images.length;
  const countLabel = imageCount > 1 ? `${imageCount} screenshots` : "this screenshot";

  emit(taskId, "status", `Analyzing ${countLabel} with vision model…`);
  logger.info({ taskId, imageCount, intent }, "[VenomGPT] Starting visual analysis phase");

  const imageParts: MessageContentPart[] = images.map(url => ({
    type:      "image_url",
    image_url: { url },
  }));

  // ── "report" path: fast 3-section grounded description ────────────────────
  // Designed for "write a file about this error/screenshot" tasks.
  // Short prompt → short response → faster end-to-end latency.
  if (intent === "report") {
    const reportPromptText = `Developer task: "${userPrompt}"

Examine ${countLabel} and produce a grounded description. Use exactly these three sections:

## OBSERVED
List every fact that is directly visible: error messages (quote verbatim), UI elements, text content, visible state, colour, position. Include nothing that is not actually shown.

## LIKELY INFERENCE
What can be reasonably concluded from the visible evidence? Label every item with "INFERENCE:" so it is not confused with observation.

## CANNOT CONFIRM
List what cannot be determined from this screenshot alone: hidden logs, server state, API calls, root causes not shown on screen. Be specific — this section prevents the developer from making unsupported assumptions.

Keep each section concise. Quote any error text exactly as shown.`;

    const analysisMessages: Message[] = [
      { role: "system", content: VISION_REPORT_SYSTEM },
      { role: "user",   content: [{ type: "text", text: reportPromptText }, ...imageParts] },
    ];

    const result = await model.chat(analysisMessages, {
      maxTokens: 1200,   // short report — 3 focused sections, no CSS forensics
      taskHint:  "vision",
    });

    logger.info(
      { taskId, analysisLength: result.content.length, model: result.modelUsed, lane: result.laneUsed, intent },
      "[VenomGPT] Visual analysis complete (report path)"
    );

    const preview = result.content.slice(0, 400) + (result.content.length > 400 ? "…" : "");
    emit(taskId, "thought", `[INSPECTING] Visual analysis (${result.modelUsed ?? "vision model"}):\n${preview}`);
    return result.content;
  }

  // ── "fix" path: full 6-section CSS defect forensics ───────────────────────
  const fixPromptText = `Developer task: "${userPrompt}"

You are examining ${countLabel}. Produce a structured frontend defect report. Be precise, specific, and code-actionable.

## 1. VISIBLE STATE
List each distinct UI region or component visible. For each: describe its current visual state, layout, text content, and any styling detail relevant to the task. Note where it appears in the viewport.

## 2. LAYOUT DEFECT CHECKLIST
For each category below, state any defect clearly and precisely. If none observed, write "✓ not observed".

SPACING & ALIGNMENT — Misaligned elements, uneven gaps between siblings, unexpected margin/padding collapse, elements butting against container edges incorrectly?

OVERFLOW & CLIPPING — Content cut off at a container edge, unwanted scrollbars appearing, content hidden behind a fixed/sticky element, text or images visually cropped?

FLEX / GRID LAYOUT — Items failing to distribute correctly, wrong wrap behavior, flex children collapsing to zero, grid cells the wrong size, items not filling available space?

Z-INDEX & STACKING — Elements overlapping in the wrong order, content hidden under another layer, tooltip/dropdown/modal not above its context, shadow or border clipped by stacking context?

SIZING — Element too wide or too narrow (ignoring its container), too tall or too short, aspect ratio wrong, element not growing/shrinking as expected?

TYPOGRAPHY — Text truncated with or without ellipsis, text overflowing its container, wrong font size or weight relative to surrounding text, baseline misalignment between adjacent text elements?

COLOR & STYLE — Wrong background color, missing border or shadow, element showing default browser styling (no CSS applied), opacity or visibility wrong?

COMPONENT STATE — Wrong state shown: error state when content is expected, loading spinner when data is ready, empty state placeholder still showing, disabled styling on an enabled element?

RESPONSIVE / VIEWPORT — Elements reflowing, collapsing, or overflowing at the current viewport width in a way that looks unintentional?

## 3. CSS ROOT-CAUSE INFERENCE
For each defect found above, give the most likely CSS cause. Format:
"[Defect] → [LIKELY|POSSIBLE] CAUSE: [CSS property or pattern]"

Label each LIKELY (high visual confidence) or POSSIBLE (plausible but uncertain without code).

## 4. COMPONENT OWNERSHIP
For each defect, identify: (a) the visible element where the symptom appears, (b) the parent component most likely responsible, (c) whether the fix is in: inline styles | component CSS/Tailwind | shared stylesheet | parent layout container.

## 5. TASK RELEVANCE
Which defects are directly relevant to the task? What visual change is needed? Which component or CSS rule is the primary target?

## 6. LIMITS
What cannot be confirmed from this screenshot alone? What requires reading the source code? Be specific.

Be direct and actionable. The developer must be able to open the right file and identify the right rule.`;

  const analysisMessages: Message[] = [
    { role: "system", content: VISION_FIX_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: fixPromptText },
        ...imageParts,
      ],
    },
  ];

  const result = await model.chat(analysisMessages, {
    maxTokens:  3500,   // 6-section CSS defect report needs more room
    taskHint:   "vision",
  });

  logger.info(
    { taskId, analysisLength: result.content.length, model: result.modelUsed, lane: result.laneUsed, intent },
    "[VenomGPT] Visual analysis complete (fix path)"
  );

  // Emit a truncated preview so the operator can see the analysis in the feed
  const preview = result.content.slice(0, 400) + (result.content.length > 400 ? "…" : "");
  emit(taskId, "thought", `[INSPECTING] Visual analysis (${result.modelUsed ?? "vision model"}):\n${preview}`);

  return result.content;
}

// ─── Main task runner ─────────────────────────────────────────────────────────

export async function runAgentTask(prompt: string, images: string[] = []): Promise<AgentTask> {
  const taskMeta      = classifyTask(images);
  const visualIntent  = taskMeta.isVisual ? classifyVisualIntent(prompt) : "fix";
  const task     = createTask(prompt);
  const taskId   = task.id;
  createTaskController(taskId);

  // Stamp imageCount immediately so the UI can show it even while running
  if (taskMeta.isVisual) {
    setTaskMeta(taskId, { imageCount: taskMeta.imageCount });
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
      emit(taskId, "status", "Analysing workspace…");

      let workspaceSnapshot = "";
      let projectIntelligence = "";
      let projectIndex: ProjectIndex | null = null;   // kept for visual debug file selection

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
          const intentLabel = visualIntent === "report" ? "report writing" : "code fix";
          emit(taskId, "status", `Visual analysis complete (${intentLabel} path) — proceeding…`);
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
      userPromptParts.push(`File structure:\n${workspaceSnapshot}`);

      // ── Visual context + intent-appropriate protocol ──────────────────────
      // Only injected when visual analysis actually succeeded.
      // "report" intent → direct write protocol (no file inspection)
      // "fix"    intent → CSS investigation protocol + file bridge
      if (visualContext) {
        // 1. Visual analysis findings (both intents)
        userPromptParts.push(
          `VISUAL ANALYSIS — ${taskMeta.imageCount} screenshot${taskMeta.imageCount > 1 ? "s" : ""} analysed:\n\n` +
          visualContext
        );

        if (visualIntent === "report") {
          // ── Report protocol: analyze → write file directly → verify ──────
          // No CSS file investigation. No reading existing files.
          // The agent has everything it needs from the visual analysis above.
          userPromptParts.push(
            `VISUAL REPORT PROTOCOL:

Your task is to write a file containing a grounded description of what was observed in the screenshot(s).

STEP 1 — WRITE: Create the target file immediately. You do NOT need to read any existing files first.
  • Use only the OBSERVED section of the visual analysis as primary evidence.
  • Clearly label LIKELY INFERENCE items as inferences.
  • Do NOT include claims from CANNOT CONFIRM unless you explicitly note the uncertainty.
  • Do NOT invent system-internal failures, API errors, or root causes not visible in the screenshot.

STEP 2 — VERIFY: Read the file back once to confirm the content was written correctly.

STEP 3 — DONE: Report what was written with final_status "complete".

IMPORTANT: Do NOT read existing code files. Do NOT run build commands. Do NOT scan the workspace. You have everything you need. Go directly to write_file.`
          );
          logger.debug({ taskId, visualIntent }, "[VenomGPT] Using report protocol (direct write)");

        } else {
          // ── Fix protocol: inspect CSS files → edit → verify ──────────────
          // Code-aware file bridge scored by CSS/component relevance.
          let fileBridgeSection = "";
          if (projectIndex) {
            const visualDebugFiles = selectVisualDebugFiles(projectIndex, prompt, 10);
            if (visualDebugFiles.length > 0) {
              fileBridgeSection =
                `\nFILES TO INVESTIGATE (scored by visual-debug relevance):\n` +
                visualDebugFiles.map((f) => `  ${f.path}`).join("\n");
              logger.debug(
                { taskId, fileCount: visualDebugFiles.length, files: visualDebugFiles.map((f) => f.path) },
                "[VenomGPT] Visual debug file scan complete"
              );
            }
          }

          userPromptParts.push(
            `VISUAL FIX PROTOCOL:${fileBridgeSection}

How to execute a visual fix correctly:

STEP 1 — PLANNING: Read the visual analysis above. Identify the specific defect(s) and the CSS root-cause inference provided. Plan which CSS property/component you need to fix BEFORE reading any code.

STEP 2 — INSPECTING: Read the listed files (or the most relevant subset) to find the exact CSS rule responsible. Do not read files unrelated to the defect. Match: defect type → likely CSS property → the file where that rule lives.

  Defect type → where to look:
  • Spacing/alignment → padding, margin, gap on the container or its children
  • Overflow/clipping → overflow: hidden, max-height, height on ancestor containers
  • Flex/grid → display: flex/grid on the parent, then justify-content, align-items, flex-wrap, grid-template
  • Z-index/stacking → position: relative/absolute/fixed, z-index, isolation: isolate
  • Sizing → width, height, min-*, max-*, flex-basis, flex-grow, flex-shrink
  • Typography → overflow, text-overflow: ellipsis, white-space: nowrap, max-width on text containers
  • State visibility → conditional class logic, display: none / visibility: hidden, opacity: 0

STEP 3 — EDITING: Fix the CSS rule in the component that OWNS the layout (not a descendant symptom). Write the complete file content.

STEP 4 — VERIFYING: After writing, confirm the change targets the exact visual symptom described in the analysis. Your done action must cite: what was visually broken → which CSS rule you changed → how this resolves the observed defect.`
          );
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
