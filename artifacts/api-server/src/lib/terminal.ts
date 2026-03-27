import { spawn } from "child_process";
import { validateCommand, getWorkspaceRoot, isWorkspaceSet } from "./safety.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCommand(
  command: string,
  onOutput: (data: string, stream: "stdout" | "stderr") => void,
  timeoutMs: number = 30000
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    validateCommand(command);

    const cwd = isWorkspaceSet() ? getWorkspaceRoot() : process.cwd();

    const child = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000);
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

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
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}
