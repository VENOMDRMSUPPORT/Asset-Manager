import { spawn } from "child_process";
import { validateCommand, getWorkspaceRoot, isWorkspaceSet, isWindowsPlatform } from "./safety.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCommand(
  command: string,
  onOutput: (data: string, stream: "stdout" | "stderr") => void,
  timeoutMs: number = 120000,
  signal?: AbortSignal
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    validateCommand(command);

    if (signal?.aborted) {
      reject(new Error("Command was cancelled before it started"));
      return;
    }

    const cwd = isWorkspaceSet() ? getWorkspaceRoot() : process.cwd();

    const isWindows = isWindowsPlatform();
    const child = isWindows
      ? spawn("cmd.exe", ["/c", command], {
          cwd,
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn("bash", ["-c", command], {
          cwd,
          env: { ...process.env, FORCE_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
      reject(new Error(`Command timed out after ${timeoutMs / 1000}s: ${command.slice(0, 80)}`));
    }, timeoutMs);

    let onAbort: (() => void) | null = null;
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        try { child.kill("SIGTERM"); } catch {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1000);
        reject(new Error("Command cancelled by user"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onOutput(text, "stdout");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onOutput(text, "stderr");
    });

    child.on("error", (err) => {
      if (onAbort) signal!.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (onAbort) signal!.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}
