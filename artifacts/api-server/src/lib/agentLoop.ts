import { getModelProvider, ModelError, type Message } from "./modelAdapter.js";
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
import { logger } from "./logger.js";

function emit(taskId: string, type: Parameters<typeof addEvent>[1], message: string, data?: Record<string, unknown>): void {
  const event = addEvent(taskId, type, message, data);
  broadcastAgentEvent(taskId, event);
}

function failTask(
  taskId: string,
  task: AgentTask,
  summary: string,
  failure: TaskFailureDetail
): void {
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

// ─── Conversational prompt detection ─────────────────────────────────────────
// These prompts don't need the full agent loop. Handling them separately
// prevents "no valid JSON action" failures on simple greetings.

const CONVERSATIONAL_RE = /^(hi|hello|hey|thanks|thank you|thx|ty|ok|okay|cool|great|bye|goodbye|yes|no|yep|nope|yeah|sure|got it|sounds good|perfect|nice|alright|what|huh)[\s!.,?]*$/i;

function isConversationalPrompt(prompt: string): boolean {
  const t = prompt.trim();
  if (t.length > 80) return false;
  return CONVERSATIONAL_RE.test(t);
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are DevMind, an expert AI coding assistant that executes software engineering tasks autonomously on a local codebase.

You operate in a strict JSON action loop. Each response must be EXACTLY one valid JSON object. No text before or after the JSON.

## Available Actions

### Explore & Read
{"action":"list_dir","path":"relative/path-or-empty-for-root","reason":"why"}
{"action":"read_file","path":"relative/file/path","reason":"why you need this file"}

### Reason
{"action":"think","thought":"your internal analysis of current state and next step"}

### Write & Execute
{"action":"write_file","path":"relative/file/path","content":"complete file contents","reason":"what changed and why"}
{"action":"run_command","command":"shell command","reason":"why","timeout":60}

### Finish
{"action":"done","summary":"what was accomplished","changed_files":["list","of","modified","files"],"commands_run":["commands","that","ran"],"final_status":"complete","remaining":"any remaining issues or empty string"}

## Execution Protocol

ALWAYS follow this workflow:
1. PLAN: Think about what the task requires. What files do you need to see? What changes are needed?
2. INSPECT: Use list_dir and read_file to understand relevant code before changing anything. Never guess file contents.
3. EDIT: Write files one at a time with their COMPLETE content (not diffs or partial edits).
4. VERIFY: Run commands to check your work (build, type-check, test, lint). Examine exit codes.
5. FIX: If a command fails, read the error, understand the root cause, and fix. Retry different approaches.
6. SUMMARIZE: End with a structured "done" report regardless of outcome.

## Rules
- Use RELATIVE paths only. Never use absolute paths.
- ALWAYS read a file before writing it — never assume file contents.
- Write the COMPLETE file content when using write_file, not snippets or diffs.
- If a command fails, examine the error output and attempt a different approach.
- Do not run unnecessary commands or install unrelated packages.
- Maximum 30 steps. Use them efficiently — prefer targeted reads over full directory scans.
- End with "done" whether the task is complete, partially done, or blocked.

## Stopping Conditions
- Use "done" with final_status "complete" when all changes are working.
- Use "done" with final_status "partial" when you made progress but couldn't finish (explain in remaining).
- Use "done" with final_status "blocked" when you cannot proceed due to missing info or permissions.

## Examples

Example 1 — Adding a function:
Step 1: {"action":"think","thought":"I need to add a debounce utility. Let me first read the existing utils file to understand the format and avoid conflicts."}
Step 2: {"action":"read_file","path":"src/utils.ts","reason":"Read existing code before editing"}
Step 3: {"action":"write_file","path":"src/utils.ts","content":"...complete updated file...","reason":"Added debounce function at the end without changing existing exports"}
Step 4: {"action":"run_command","command":"npx tsc --noEmit","reason":"Verify TypeScript compiles cleanly","timeout":30}
Step 5: {"action":"done","summary":"Added debounce utility function","changed_files":["src/utils.ts"],"commands_run":["npx tsc --noEmit"],"final_status":"complete","remaining":""}

Example 2 — Fixing a failing test:
Step 1: {"action":"think","thought":"Need to read the failing test and the module it tests before making any changes."}
Step 2: {"action":"read_file","path":"tests/auth.test.ts","reason":"Understand what the test asserts"}
Step 3: {"action":"read_file","path":"src/auth.ts","reason":"Understand current implementation"}
Step 4: {"action":"write_file","path":"src/auth.ts","content":"...corrected implementation...","reason":"Fixed token validation logic that was causing test failure"}
Step 5: {"action":"run_command","command":"npx jest tests/auth.test.ts","reason":"Run the test to verify the fix","timeout":60}
Step 6: {"action":"done","summary":"Fixed token validation bug in auth.ts. Test now passes.","changed_files":["src/auth.ts"],"commands_run":["npx jest tests/auth.test.ts"],"final_status":"complete","remaining":""}`;

interface ActionResult {
  success: boolean;
  output: string;
}

const MAX_CONTENT_CHARS = 80_000;
const MAX_CONSECUTIVE_PARSE_FAILURES = 3;
const DEFAULT_COMMAND_TIMEOUT_S = 120;
const MAX_COMMAND_TIMEOUT_S = 300;

function pruneMessages(messages: Message[]): Message[] {
  const total = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : 500), 0);
  if (total <= MAX_CONTENT_CHARS) return messages;

  const system = messages[0];
  const rest = messages.slice(1);
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
  action: Record<string, unknown>,
  taskId: string,
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
      emit(taskId, "status", `Listing directory: ${relPath || "workspace root"}`);
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
      const content = String(action["content"] ?? "");
      const reason = String(action["reason"] ?? "");
      logger.debug({ taskId, actionType: "write_file", path: filePath, bytes: content.length }, "Writing file");
      emit(taskId, "file_write", `Writing: ${filePath}`, { path: filePath, reason });
      try {
        await writeFile(filePath, content);
        return { success: true, output: `File written successfully: ${filePath} (${content.length} chars)` };
      } catch (err) {
        logger.warn({ taskId, path: filePath, err }, "write_file failed");
        return { success: false, output: `Error writing file: ${String(err)}` };
      }
    }

    case "run_command": {
      const command = String(action["command"] ?? "");
      const requestedTimeoutS = Number(action["timeout"]) || DEFAULT_COMMAND_TIMEOUT_S;
      const timeoutMs = Math.min(Math.max(requestedTimeoutS, 5), MAX_COMMAND_TIMEOUT_S) * 1000;

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
          (data) => {
            outputBuffer += data;
            scheduleFlush();
          },
          timeoutMs,
          signal
        );

        if (flushTimer) clearTimeout(flushTimer);
        flushOutput();

        logger.info({ taskId, command, exitCode: result.exitCode }, "Command finished");

        const stdoutPreview = result.stdout.slice(0, 4000);
        const stderrPreview = result.stderr.slice(0, 2000);
        const output = [
          `Exit code: ${result.exitCode}`,
          result.stdout ? `stdout:\n${stdoutPreview}${result.stdout.length > 4000 ? "\n...[truncated]" : ""}` : "",
          result.stderr ? `stderr:\n${stderrPreview}${result.stderr.length > 2000 ? "\n...[truncated]" : ""}` : "",
        ].filter(Boolean).join("\n");

        emit(taskId, "command_output", `Exit ${result.exitCode}: ${command.slice(0, 60)}`);
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
      return { success: false, output: `Unknown action type: "${actionType}". Valid actions: think, list_dir, read_file, write_file, run_command, done.` };
    }
  }
}

export async function runAgentTask(prompt: string): Promise<AgentTask> {
  const task = createTask(prompt);
  const taskId = task.id;
  createTaskController(taskId);

  broadcastTaskUpdate(task);

  (async () => {
    try {
      updateTaskStatus(taskId, "running");
      logger.info({ taskId, prompt: prompt.slice(0, 100) }, "Agent task started");

      // ── Workspace validation ──────────────────────────────────────────────
      const wsRoot = isWorkspaceSet() ? getWorkspaceRoot() : null;
      emit(taskId, "status", `Agent started. Workspace: ${wsRoot ?? "not configured"}`);

      if (!wsRoot) {
        failTask(taskId, task, "Workspace not configured", {
          title: "Workspace root is not configured",
          detail: "Set a workspace directory in the UI before running tasks. The workspace must already exist on disk.",
          step: "workspace_validation",
          category: "workspace",
        });
        return;
      }

      // ── Handle conversational prompts directly (bypass agent loop) ────────
      // Simple greetings like "hi", "thanks", "ok" don't need file/command tools.
      // Route them through a single chat call and produce a clean completion.
      if (isConversationalPrompt(prompt)) {
        logger.info({ taskId, prompt }, "Conversational prompt detected — using direct response path");
        emit(taskId, "status", "Conversational prompt — responding directly.");

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
              { role: "system", content: "You are DevMind, a friendly AI coding assistant. Reply briefly and naturally." },
              { role: "user", content: prompt },
            ],
            { maxTokens: 200, taskHint: "conversational" }
          ).then((r) => { reply = r.content; });

          emit(taskId, "thought", reply);
          const completion: TaskCompletion = {
            summary: reply,
            changed_files: [],
            commands_run: [],
            final_status: "complete",
            remaining: "",
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

      // ── Workspace snapshot ────────────────────────────────────────────────
      let workspaceSnapshot = "";
      try {
        const entries = await listDirectory("");
        workspaceSnapshot = formatDirectoryTree(entries);
        emit(taskId, "status", `Workspace ready (${entries.length} top-level entries)`);
        logger.debug({ taskId, entries: entries.length }, "Workspace snapshot loaded");
      } catch (err) {
        workspaceSnapshot = "(could not read workspace)";
        logger.warn({ taskId, err }, "Could not snapshot workspace — continuing anyway");
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
            ? `Category: ${err.category}\nTechnical: ${err.technical}\n\nTip: Copy .env.example to .env in the repo root and fill in ZAI_API_KEY.`
            : String(err),
          step: "model_initialization",
          category: "model",
        });
        return;
      }

      // ── Agent loop ────────────────────────────────────────────────────────
      const messages: Message[] = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Workspace root: ${wsRoot}\n\nWorkspace file structure:\n${workspaceSnapshot}\n\nTask: ${prompt}`,
        },
      ];

      const MAX_STEPS = 30;
      let step = 0;
      let consecutiveParseFailures = 0;
      let lastSummary = "Agent reached maximum steps without completing the task.";
      let completion: TaskCompletion | undefined;

      while (step < MAX_STEPS) {
        if (isTaskCancelled(taskId)) {
          logger.info({ taskId, step }, "Task cancelled by user");
          emit(taskId, "status", "Task cancelled by user.");
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
        logger.debug({ taskId, step, maxSteps: MAX_STEPS }, "Agent step");
        emit(taskId, "status", `Step ${step}/${MAX_STEPS}`);

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
            emit(taskId, "status", "Task cancelled during model call.");
            updateTaskStatus(taskId, "error", "Cancelled by user", undefined, {
              title: "Task cancelled",
              detail: "The task was stopped during a model call.",
              step: `step_${step}`,
              category: "cancelled",
            });
            broadcastTaskUpdate(task);
            return;
          }

          const isModelError = err instanceof ModelError;
          failTask(taskId, task, `Model error at step ${step}: ${isModelError ? err.message : String(err)}`, {
            title: isModelError ? err.message : "AI model call failed",
            detail: isModelError
              ? `Category: ${err.category}\nTechnical: ${err.technical}`
              : String(err),
            step: `step_${step}_model_call`,
            category: "model",
          });
          return;
        }

        messages.push({ role: "assistant", content: responseText });

        // ── Response normalization + parse ──────────────────────────────────
        const normalized = normalizeModelResponse(responseText);

        if (!normalized.ok) {
          consecutiveParseFailures++;
          const reason: NormalizeFailureReason = normalized.reason;
          const detail = normalized.detail;

          logger.warn(
            { taskId, step, consecutiveParseFailures, reason, responsePreview: responseText.slice(0, 200) },
            `Normalize failed [${reason}]`
          );

          const failMsg = `Response normalization failed [${reason}] (attempt ${consecutiveParseFailures}/${MAX_CONSECUTIVE_PARSE_FAILURES}).\n${detail}`;
          emit(taskId, "error", failMsg);

          if (consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
            failTask(taskId, task, `Model returned ${MAX_CONSECUTIVE_PARSE_FAILURES} unparseable responses in a row`, {
              title: `Model failed to produce valid JSON ${MAX_CONSECUTIVE_PARSE_FAILURES} times`,
              detail: `Last failure reason: ${reason}\n${detail}`,
              step: `step_${step}_parse`,
              category: "orchestration",
            });
            return;
          }

          const retryMsg = buildRetryInstruction(reason, responseText.slice(0, 300));
          messages.push({ role: "user", content: retryMsg });
          continue;
        }

        // ── Normalization succeeded ─────────────────────────────────────────
        consecutiveParseFailures = 0;

        const { action, method, warning } = normalized;
        if (method !== "direct_parse") {
          logger.debug({ taskId, step, method, warning }, `Response normalized via ${method}`);
        }
        if (warning) {
          logger.warn({ taskId, step, method, warning }, "Normalization warning");
        }

        const actionType = String(action["action"] ?? "");

        // ── Done action ─────────────────────────────────────────────────────
        if (actionType === "done") {
          const summary = String(action["summary"] ?? "Task complete.");
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

          completion = { summary, changed_files: changedFiles, commands_run: commandsRun, final_status: finalStatus, remaining };
          lastSummary = summary;

          logger.info({ taskId, step, finalStatus, changedFiles, commandsRun }, "Task completed with done action");
          emit(taskId, "done", summary, {
            changed_files: changedFiles,
            commands_run: commandsRun,
            final_status: finalStatus,
            remaining,
          });
          break;
        }

        // ── Execute action ──────────────────────────────────────────────────
        const signal = getTaskSignal(taskId);
        logger.debug({ taskId, step, actionType }, "Executing action");
        const result = await executeAction(action, taskId, signal);

        if (isTaskCancelled(taskId)) {
          emit(taskId, "status", "Task cancelled.");
          updateTaskStatus(taskId, "error", "Cancelled by user", undefined, {
            title: "Task cancelled",
            detail: "The task was stopped after an action completed.",
            step: `step_${step}_${actionType}`,
            category: "cancelled",
          });
          broadcastTaskUpdate(task);
          return;
        }

        messages.push({
          role: "user",
          content: result.success
            ? `Result: ${result.output}`
            : `ERROR: ${result.output}\nAnalyze this error and try a different approach.`,
        });
      }

      if (step >= MAX_STEPS && !completion) {
        logger.warn({ taskId, step }, "Reached maximum step limit");
        emit(taskId, "status", "Reached maximum steps (30). Stopping.");
        lastSummary = "Reached maximum step limit (30). Task may be partially complete.";
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
