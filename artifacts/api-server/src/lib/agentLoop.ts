import { getModelProvider, type Message } from "./modelAdapter.js";
import { listDirectory, readFile, writeFile } from "./fileTools.js";
import { runCommand } from "./terminal.js";
import {
  createTask,
  addEvent,
  updateTaskStatus,
  type AgentTask,
} from "./sessionManager.js";
import { broadcastAgentEvent, broadcastTaskUpdate, broadcastTerminalOutput } from "./wsServer.js";
import { getWorkspaceRoot, isWorkspaceSet } from "./safety.js";
import { logger } from "./logger.js";

function emit(taskId: string, type: Parameters<typeof addEvent>[1], message: string, data?: Record<string, unknown>): void {
  const event = addEvent(taskId, type, message, data);
  broadcastAgentEvent(taskId, event);
}

const SYSTEM_PROMPT = `You are DevMind, an expert AI coding assistant that executes software engineering tasks autonomously on a local codebase.

You operate in a JSON-based agentic loop. At each step, you output EXACTLY one JSON action object. Do not output anything outside the JSON.

Available actions:
1. Read a file:
{"action":"read_file","path":"relative/path/to/file","reason":"why you need it"}

2. List directory:
{"action":"list_dir","path":"relative/path/or/empty-string-for-root","reason":"why"}

3. Write/edit a file:
{"action":"write_file","path":"relative/path","content":"full file content as string","reason":"what you changed and why"}

4. Run a terminal command:
{"action":"run_command","command":"shell command","reason":"why you need to run it"}

5. Think (internal reasoning, no side effects):
{"action":"think","thought":"your reasoning about the current state and what to do next"}

6. Finish the task:
{"action":"done","summary":"clear summary of what was accomplished, what files were changed, what commands were run, and any remaining issues"}

Rules:
- Always start with "think" to analyze the task.
- Explore the codebase with list_dir and read_file before making changes.
- Make changes one file at a time with write_file.
- Run commands to verify your changes (e.g., build, test, lint).
- If a command fails, read the error and attempt to fix it.
- Do not ask for user confirmation during execution. Make reasonable assumptions.
- Do not hallucinate file contents — always read first.
- The workspace root is already configured. Use relative paths only.
- Maximum 30 steps per task to prevent infinite loops.
- End with "done" when the task is complete or you cannot continue.`;

interface ActionResult {
  success: boolean;
  output: string;
}

async function executeAction(
  action: Record<string, string>,
  taskId: string
): Promise<ActionResult> {
  switch (action["action"]) {
    case "think": {
      emit(taskId, "thought", action["thought"] || "");
      return { success: true, output: "Thought noted." };
    }

    case "list_dir": {
      const relPath = action["path"] || "";
      emit(taskId, "status", `Listing directory: ${relPath || "workspace root"}`);
      try {
        const entries = await listDirectory(relPath);
        const formatted = formatEntries(entries, "");
        return { success: true, output: `Directory listing:\n${formatted}` };
      } catch (err) {
        return { success: false, output: `Error listing directory: ${String(err)}` };
      }
    }

    case "read_file": {
      const filePath = action["path"] || "";
      emit(taskId, "file_read", `Reading file: ${filePath}`, { path: filePath });
      try {
        const { content } = await readFile(filePath);
        const preview = content.length > 8000 ? content.slice(0, 8000) + "\n...[truncated]" : content;
        return { success: true, output: `File contents of ${filePath}:\n\`\`\`\n${preview}\n\`\`\`` };
      } catch (err) {
        return { success: false, output: `Error reading file: ${String(err)}` };
      }
    }

    case "write_file": {
      const filePath = action["path"] || "";
      const content = action["content"] || "";
      emit(taskId, "file_write", `Writing file: ${filePath}`, { path: filePath });
      try {
        await writeFile(filePath, content);
        return { success: true, output: `File written successfully: ${filePath}` };
      } catch (err) {
        return { success: false, output: `Error writing file: ${String(err)}` };
      }
    }

    case "run_command": {
      const command = action["command"] || "";
      emit(taskId, "command", `Running: ${command}`, { command });
      try {
        const result = await runCommand(command, (data) => {
          broadcastTerminalOutput(data);
          emit(taskId, "command_output", data.trim().slice(0, 500));
        });

        const output = `Exit code: ${result.exitCode}\nstdout:\n${result.stdout.slice(0, 3000)}\nstderr:\n${result.stderr.slice(0, 1000)}`;
        return { success: result.exitCode === 0, output };
      } catch (err) {
        return { success: false, output: `Command execution error: ${String(err)}` };
      }
    }

    case "done": {
      return { success: true, output: action["summary"] || "Task complete." };
    }

    default: {
      return { success: false, output: `Unknown action: ${action["action"]}` };
    }
  }
}

function formatEntries(entries: Awaited<ReturnType<typeof listDirectory>>, indent: string): string {
  return entries
    .map((e) => {
      if (e.type === "directory") {
        const childLines = e.children ? formatEntries(e.children, indent + "  ") : "";
        return `${indent}${e.name}/\n${childLines}`;
      }
      return `${indent}${e.name}`;
    })
    .join("\n");
}

function parseAction(text: string): Record<string, string> | null {
  const cleaned = text.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

export async function runAgentTask(prompt: string): Promise<AgentTask> {
  const task = createTask(prompt);
  const taskId = task.id;

  broadcastTaskUpdate(task);

  (async () => {
    try {
      updateTaskStatus(taskId, "running");

      const wsRoot = isWorkspaceSet() ? getWorkspaceRoot() : "not configured";
      emit(taskId, "status", `Agent started. Workspace: ${wsRoot}`);

      const model = getModelProvider();
      const messages: Message[] = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Workspace root: ${wsRoot}\n\nTask: ${prompt}`,
        },
      ];

      const MAX_STEPS = 30;
      let step = 0;
      let lastSummary = "Task completed.";

      while (step < MAX_STEPS) {
        step++;
        emit(taskId, "status", `Step ${step}/${MAX_STEPS} — thinking...`);

        let responseText = "";
        try {
          await model.chatStream(
            messages,
            (chunk) => { responseText += chunk; },
            { maxTokens: 2048, temperature: 0.1 }
          );
        } catch (err) {
          emit(taskId, "error", `Model error: ${String(err)}`);
          updateTaskStatus(taskId, "error", `Model error: ${String(err)}`);
          broadcastTaskUpdate({ ...task, status: "error" });
          return;
        }

        messages.push({ role: "assistant", content: responseText });

        const action = parseAction(responseText);
        if (!action) {
          emit(taskId, "error", `Could not parse action from model response: ${responseText.slice(0, 200)}`);
          messages.push({
            role: "user",
            content: "ERROR: Your response must be a single valid JSON object. Output only JSON, nothing else.",
          });
          continue;
        }

        if (action["action"] === "done") {
          lastSummary = action["summary"] || "Task complete.";
          emit(taskId, "done", lastSummary);
          break;
        }

        const result = await executeAction(action, taskId);

        messages.push({
          role: "user",
          content: result.success
            ? `Result: ${result.output}`
            : `ERROR: ${result.output}\nPlease try a different approach.`,
        });

        if (step >= MAX_STEPS) {
          emit(taskId, "status", "Maximum steps reached. Stopping.");
          lastSummary = "Reached maximum step limit. Task may be partially complete.";
          break;
        }
      }

      updateTaskStatus(taskId, "done", lastSummary);
      const finalTask = { ...task, status: "done" as const, summary: lastSummary, completedAt: new Date() };
      broadcastTaskUpdate(finalTask);
    } catch (err) {
      logger.error({ err }, "Agent loop error");
      emit(taskId, "error", `Unexpected error: ${String(err)}`);
      updateTaskStatus(taskId, "error", String(err));
      broadcastTaskUpdate({ ...task, status: "error" as const });
    }
  })();

  return task;
}
