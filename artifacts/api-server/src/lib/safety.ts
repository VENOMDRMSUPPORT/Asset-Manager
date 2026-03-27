import path from "path";
import fs from "fs";

let workspaceRoot: string = process.env["WORKSPACE_ROOT"] || "";

export function getWorkspaceRoot(): string {
  return workspaceRoot;
}

export function isWorkspaceSet(): boolean {
  return workspaceRoot.length > 0;
}

export function setWorkspaceRoot(newRoot: string): void {
  const resolved = path.resolve(newRoot);
  workspaceRoot = resolved;
}

export function validateWorkspacePath(rawPath: string): string {
  if (!workspaceRoot) {
    throw new SafetyError("Workspace root is not configured");
  }

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, rawPath.replace(/^\/+/, ""));

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new SafetyError(
      `Path "${rawPath}" escapes the workspace root. All operations must stay within the configured workspace directory.`
    );
  }

  return resolved;
}

export function workspaceRelativePath(absolutePath: string): string {
  const root = path.resolve(workspaceRoot);
  return absolutePath.startsWith(root)
    ? absolutePath.slice(root.length).replace(/^[/\\]/, "")
    : absolutePath;
}

export function validateWorkspaceRootExists(root: string): boolean {
  try {
    const stat = fs.statSync(root);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyError";
  }
}

const BLOCKED_COMMANDS = [
  /rm\s+-rf\s+\/(?!\w)/,
  /rmdir\s+\/(?!\w)/,
  /mkfs/,
  /dd\s+.*of=\/dev/,
  />\s*\/dev\/sda/,
  /format\s+[a-z]:/i,
];

export function validateCommand(cmd: string): void {
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(cmd)) {
      throw new SafetyError(
        `Command blocked by safety rules: "${cmd}". Commands that destroy system paths are not allowed.`
      );
    }
  }
}
