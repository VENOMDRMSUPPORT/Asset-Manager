import { getModelProvider, type Message } from "./modelAdapter.js";
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
} from "./sessionManager.js";
import { broadcastAgentEvent, broadcastTaskUpdate, broadcastTerminalOutput } from "./wsServer.js";
import { getWorkspaceRoot, isWorkspaceSet } from "./safety.js";
import { logger } from "./logger.js";

function emit(taskId: string, type: Parameters<typeof addEvent>[1], message: string, data?: Record<string, unknown>): void {
  const event = addEvent(taskId, type, message, data);
  broadcastAgentEvent(taskId, event);
}

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
  const total = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (total <= MAX_CONTENT_CHARS) return messages;

  const system = messages[0];
  const rest = messages.slice(1);
  const keepCount = 8;
  const kept = rest.slice(-keepCount);

  logger.warn({ before: rest.length, after: kept.length }, "Pruned message history to fit context window");
  return [system, ...kept];
}

function parseAction(text: string): Record<string, unknown> | null {
  const cleaned = text.trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as Record<string, unknown>)["action"] === "string") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    } catch {}
    return null;
  }
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
      emit(taskId, "thought", String(action["thought"] ?? ""));
      return { success: true, output: "Thought noted." };
    }

    case "list_dir": {
      const relPath = String(action["path"] ?? "");
      emit(taskId, "status", `Listing directory: ${relPath || "workspace root"}`);
      try {
        const entries = await listDirectory(relPath);
        const tree = formatDirectoryTree(entries);
        return { success: true, output: `Directory listing:\n${tree || "(empty)"}` };
      } catch (err) {
        return { success: false, output: `Error listing directory: ${String(err)}` };
      }
    }

    case "read_file": {
      const filePath = String(action["path"] ?? "");
      emit(taskId, "file_read", `Reading: ${filePath}`, { path: filePath });
      try {
        const { content } = await readFile(filePath);
        const MAX_CHARS = 12_000;
        const preview = content.length > MAX_CHARS
          ? content.slice(0, MAX_CHARS) + `\n...[truncated — file is ${content.length} chars total]`
          : content;
        return { success: true, output: `File contents of ${filePath}:\n\`\`\`\n${preview}\n\`\`\`` };
      } catch (err) {
        return { success: false, output: `Error reading file: ${String(err)}` };
      }
    }

    case "write_file": {
      const filePath = String(action["path"] ?? "");
      const content = String(action["content"] ?? "");
      const reason = String(action["reason"] ?? "");
      emit(taskId, "file_write", `Writing: ${filePath}`, { path: filePath, reason });
      try {
        await writeFile(filePath, content);
        return { success: true, output: `File written successfully: ${filePath} (${content.length} chars)` };
      } catch (err) {
        return { success: false, output: `Error writing file: ${String(err)}` };
      }
    }

    case "run_command": {
      const command = String(action["command"] ?? "");
      const requestedTimeoutS = Number(action["timeout"]) || DEFAULT_COMMAND_TIMEOUT_S;
      const timeoutMs = Math.min(Math.max(requestedTimeoutS, 5), MAX_COMMAND_TIMEOUT_S) * 1000;

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
        return { success: false, output: `Command error: ${String(err)}` };
      }
    }

    case "done": {
      return { success: true, output: String(action["summary"] ?? "Task complete.") };
    }

    default: {
      return { success: false, output: `Unknown action type: "${actionType}". Must be one of: think, list_dir, read_file, write_file, run_command, done.` };
    }
  }
}

export async function runAgentTask(prompt: string): Promise<AgentTask> {
  const task = createTask(prompt);
  const taskId = task.id;
  const controller = createTaskController(taskId);

  broadcastTaskUpdate(task);

  (async () => {
    try {
      updateTaskStatus(taskId, "running");

      const wsRoot = isWorkspaceSet() ? getWorkspaceRoot() : "not configured";
      emit(taskId, "status", `Agent started. Workspace: ${wsRoot}`);

      if (!isWorkspaceSet()) {
        emit(taskId, "error", "Workspace root is not configured. Set it in the UI before running tasks.");
        updateTaskStatus(taskId, "error", "Workspace not configured");
        broadcastTaskUpdate(task);
        return;
      }

      let workspaceSnapshot = "";
      try {
        const entries = await listDirectory("");
        workspaceSnapshot = formatDirectoryTree(entries);
        emit(taskId, "status", "Workspace file tree loaded");
      } catch {
        workspaceSnapshot = "(could not read workspace)";
      }

      let model;
      try {
        model = getModelProvider();
      } catch (err) {
        emit(taskId, "error", `AI model configuration error: ${String(err)}. Check that ZAI_API_KEY is set correctly in your .env file.`);
        updateTaskStatus(taskId, "error", `Model config error: ${String(err)}`);
        broadcastTaskUpdate(task);
        return;
      }

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
          emit(taskId, "status", "Task cancelled by user.");
          lastSummary = "Cancelled by user.";
          updateTaskStatus(taskId, "error", lastSummary);
          broadcastTaskUpdate(task);
          return;
        }

        step++;
        emit(taskId, "status", `Step ${step}/${MAX_STEPS}`);

        let responseText = "";
        try {
          await model.chatStream(
            pruneMessages(messages),
            (chunk) => { responseText += chunk; },
            { maxTokens: 4096, temperature: 0.1 }
          );
        } catch (err) {
          if (isTaskCancelled(taskId)) {
            emit(taskId, "status", "Task cancelled during model call.");
            updateTaskStatus(taskId, "error", "Cancelled by user");
            broadcastTaskUpdate(task);
            return;
          }
          emit(taskId, "error", `Model call failed: ${String(err)}`);
          updateTaskStatus(taskId, "error", `Model error: ${String(err)}`);
          broadcastTaskUpdate(task);
          return;
        }

        messages.push({ role: "assistant", content: responseText });

        const action = parseAction(responseText);
        if (!action) {
          consecutiveParseFailures++;
          const failMsg = `Could not parse a JSON action from model response (attempt ${consecutiveParseFailures}/${MAX_CONSECUTIVE_PARSE_FAILURES}). Response was:\n${responseText.slice(0, 300)}`;
          emit(taskId, "error", failMsg);

          if (consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
            const errorMsg = `Model failed to produce valid JSON ${MAX_CONSECUTIVE_PARSE_FAILURES} times in a row. Stopping to avoid wasting steps. Try rephrasing your task.`;
            emit(taskId, "error", errorMsg);
            updateTaskStatus(taskId, "error", errorMsg);
            broadcastTaskUpdate(task);
            return;
          }

          messages.push({
            role: "user",
            content: `ERROR: Your last response was not valid JSON. You MUST output exactly one JSON object with an "action" field. Nothing else. Example:\n{"action":"think","thought":"I need to re-analyze the task."}`,
          });
          continue;
        }

        consecutiveParseFailures = 0;

        const actionType = String(action["action"] ?? "");

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

          emit(taskId, "done", summary, {
            changed_files: changedFiles,
            commands_run: commandsRun,
            final_status: finalStatus,
            remaining,
          });
          break;
        }

        const signal = getTaskSignal(taskId);
        const result = await executeAction(action, taskId, signal);

        if (isTaskCancelled(taskId)) {
          emit(taskId, "status", "Task cancelled.");
          updateTaskStatus(taskId, "error", "Cancelled by user");
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
        emit(taskId, "status", "Reached maximum steps (30). Stopping.");
        lastSummary = "Reached maximum step limit (30). Task may be partially complete.";
      }

      updateTaskStatus(taskId, "done", lastSummary, completion);
      broadcastTaskUpdate(task);
    } catch (err) {
      logger.error({ err }, "Agent loop unexpected error");
      emit(taskId, "error", `Unexpected agent error: ${String(err)}`);
      updateTaskStatus(taskId, "error", String(err));
      broadcastTaskUpdate(task);
    }
  })();

  return task;
}
