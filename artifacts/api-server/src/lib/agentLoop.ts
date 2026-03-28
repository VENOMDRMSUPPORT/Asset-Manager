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
  addEvent,
  type AgentTask,
  type TaskCompletion,
  type TaskFailureDetail,
} from "./sessionManager.js";
import { broadcastAgentEvent, broadcastTaskUpdate, broadcastTerminalOutput } from "./wsServer.js";
import { getWorkspaceRoot, isWorkspaceSet } from "./safety.js";
import { getProjectIndex, selectRelevantFiles, buildProjectSummary, invalidateProjectIndex } from "./projectIndex.js";
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

You operate in a strict JSON action loop. Each response must be EXACTLY one valid JSON object. No text before or after the JSON.

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
- ALWAYS read a file before writing it — never assume file contents.
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

const VISION_ANALYSIS_SYSTEM = `You are a precise visual analysis assistant for a software developer.
Your job is to extract coding-relevant observations from screenshots or images.
Be specific about what is VISIBLE. Do not guess or hallucinate.
Separate what is observed from what is inferred.`;

async function analyzeVisualContext(
  model:     ReturnType<typeof getModelProvider>,
  images:    string[],
  userPrompt: string,
  taskId:    string
): Promise<string> {
  const imageCount = images.length;
  const countLabel = imageCount > 1 ? `${imageCount} screenshots` : "this screenshot";

  emit(taskId, "status", `Analyzing ${countLabel} with vision model…`);
  logger.info({ taskId, imageCount }, "[VenomGPT] Starting visual analysis phase");

  const imageParts: MessageContentPart[] = images.map(url => ({
    type:      "image_url",
    image_url: { url },
  }));

  const promptText = `Developer task: "${userPrompt}"

Analyze ${countLabel} and provide a structured visual inspection report for a developer:

## 1. VISIBLE STATE
Describe exactly what is shown — UI components, layout, text content, error messages, code visible on screen, terminal output, or anything else visible.

## 2. VISIBLE DEFECTS
List every observable problem: layout misalignments, truncated/overlapping content, error states, broken styles, wrong colors, empty states that should have content, incorrect text, etc. Be specific — name the component or area.

## 3. RELEVANT CODE AREAS
Based on what you see, identify which component types, file patterns, or UI layer is likely responsible. Be specific where you can (e.g. "the navigation sidebar", "the data table pagination", "the error boundary").

## 4. TASK RELEVANCE
Directly relate what you see to the developer's task. What specifically in the screenshot needs to change to satisfy the task?

## 5. AMBIGUITIES / LIMITS
What cannot be determined from the image alone? What would require reading the actual source code to understand?

Ground every observation in what is VISIBLY PRESENT. If an area is outside the screenshot, say so.`;

  const analysisMessages: Message[] = [
    { role: "system", content: VISION_ANALYSIS_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: promptText },
        ...imageParts,
      ],
    },
  ];

  const result = await model.chat(analysisMessages, {
    maxTokens:  2000,
    taskHint:   "vision",
  });

  logger.info(
    { taskId, analysisLength: result.content.length, model: result.modelUsed, lane: result.laneUsed },
    "[VenomGPT] Visual analysis complete"
  );

  // Emit a truncated preview so the operator can see the analysis in the feed
  const preview = result.content.slice(0, 400) + (result.content.length > 400 ? "…" : "");
  emit(taskId, "thought", `[INSPECTING] Visual analysis (${result.modelUsed ?? "vision model"}):\n${preview}`);

  return result.content;
}

// ─── Main task runner ─────────────────────────────────────────────────────────

export async function runAgentTask(prompt: string, images: string[] = []): Promise<AgentTask> {
  const taskMeta = classifyTask(images);
  const task     = createTask(prompt);
  const taskId   = task.id;
  createTaskController(taskId);

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

      try {
        // Raw tree (root level only for large projects — kept for structure overview)
        const entries = await listDirectory("");
        workspaceSnapshot = formatDirectoryTree(entries);

        // Project index with relevance scoring
        const index = await getProjectIndex(wsRoot);
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
      // If the task includes images, run them through the vision model first.
      // The visual analysis output is then injected as context for the agentic
      // model — which never sees raw image data (it receives structured text).
      let visualContext = "";
      if (taskMeta.isVisual) {
        emit(taskId, "status", `Visual task — ${taskMeta.imageCount} image${taskMeta.imageCount > 1 ? "s" : ""} attached`);
        logger.info({ taskId, imageCount: taskMeta.imageCount }, "[VenomGPT] Visual task detected");

        if (!model.isVisionCapable()) {
          failTask(taskId, task, "Vision model unavailable on current provider", {
            title: "Vision analysis not available",
            detail: [
              "This task includes screenshot attachments, but the current AI provider does not support vision.",
              "",
              "To enable multimodal tasks:",
              "  1. Get a Z.AI API key at https://z.ai/manage-apikey/apikey-list",
              "  2. Add ZAI_API_KEY=your_key to your .env file",
              "  3. Restart the server",
              "",
              "Z.AI provides glm-4.6v (vision) + glm-5.1 (coding) — both needed for screenshot-driven tasks.",
            ].join("\n"),
            step: "vision_capability_check",
            category: "model",
          });
          return;
        }

        try {
          visualContext = await analyzeVisualContext(model, images, prompt, taskId);
        } catch (err) {
          const isModelError = err instanceof ModelError;
          failTask(taskId, task, `Visual analysis failed: ${isModelError ? err.message : String(err)}`, {
            title: isModelError ? err.message : "Visual analysis failed",
            detail: isModelError
              ? `Category: ${err.category}\nTechnical: ${err.technical}`
              : String(err),
            step: "visual_analysis",
            category: "model",
          });
          return;
        }

        emit(taskId, "status", "Visual analysis complete — proceeding with code execution…");
      }

      // ── Build initial prompt ──────────────────────────────────────────────
      const userPromptParts = [
        `Workspace: ${wsRoot}`,
      ];
      if (projectIntelligence) {
        userPromptParts.push(`Project intelligence:\n${projectIntelligence}`);
      }
      userPromptParts.push(`File structure:\n${workspaceSnapshot}`);

      // Visual context is injected between workspace context and the task
      if (visualContext) {
        userPromptParts.push(
          `Visual context (from screenshot analysis):\n` +
          `The developer attached ${taskMeta.imageCount} screenshot${taskMeta.imageCount > 1 ? "s" : ""}. ` +
          `The following visual analysis was produced by a vision model before this coding session:\n\n` +
          visualContext +
          `\n\nUse this visual evidence to guide your code changes. ` +
          `Ground your actions in what is VISIBLE above, not assumptions.`
        );
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
