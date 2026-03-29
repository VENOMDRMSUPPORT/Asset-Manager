import path from "path";
import fs from "fs";

let workspaceRoot: string = process.env["WORKSPACE_ROOT"] || "";

export function getWorkspaceRoot(): string {
  return workspaceRoot;
}

export function isWorkspaceSet(): boolean {
  return workspaceRoot.length > 0;
}

const BLOCKED_SYSTEM_DIRS = new Set([
  "/",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/boot",
  "/proc",
  "/sys",
  "/dev",
  "/run",
  "/tmp",
  "/var",
  "/root",
  "/home",
  "C:\\",
  "C:\\Windows",
  "C:\\Windows\\System32",
  "C:\\Windows\\SysWOW64",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\Users",
]);

export function setWorkspaceRoot(newRoot: string): void {
  const resolved = path.resolve(newRoot);

  const resolvedUpper = resolved.toLowerCase();
  for (const blocked of BLOCKED_SYSTEM_DIRS) {
    if (resolvedUpper === blocked.toLowerCase()) {
      throw new SafetyError(
        `"${resolved}" is a system directory and cannot be used as a workspace root. ` +
          `Choose a project subfolder (e.g. /home/user/projects/my-app).`
      );
    }
  }

  workspaceRoot = resolved;
}

export function validateWorkspacePath(rawPath: string): string {
  if (!workspaceRoot) {
    throw new SafetyError("Workspace root is not configured");
  }

  if (!rawPath || rawPath.trim() === "") {
    throw new SafetyError("Path cannot be empty");
  }

  // Decode URL-encoded characters to prevent bypassing traversal checks via %2F, %5C, etc.
  let decodedPath = rawPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new SafetyError(`Path "${rawPath}" contains invalid URL encoding.`);
  }

  // If decoding changed anything, re-validate with the decoded path
  if (decodedPath !== rawPath) {
    return validateWorkspacePath(decodedPath);
  }

  // Normalize backslashes so Windows-style traversal (..\..\ etc.) is caught
  const normalized = rawPath.replace(/\\/g, "/");

  // Reject paths that contain backslash-based traversal patterns before normalization
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rawPath.replace(/\\/g, "/"))) {
    // Don't reject yet — let path.resolve below catch any actual escapes
    // But if the raw path had backslashes acting as separators, be explicit
    if (/\\/.test(rawPath)) {
      const resolvedNorm = path.resolve(workspaceRoot, normalized);
      const root = path.resolve(workspaceRoot);
      if (!resolvedNorm.startsWith(root + path.sep) && resolvedNorm !== root) {
        throw new SafetyError(
          `Path "${rawPath}" escapes the workspace root. ` +
            `All file operations must stay within the configured workspace directory.`
        );
      }
    }
  }

  if (
    path.isAbsolute(rawPath) ||
    /^[A-Za-z]:/.test(rawPath) ||
    normalized.startsWith("//")
  ) {
    throw new SafetyError(
      `Path "${rawPath}" must be relative to the workspace root. ` +
        `Do not use absolute paths or drive letters.`
    );
  }

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, rawPath);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new SafetyError(
      `Path "${rawPath}" escapes the workspace root. ` +
        `All file operations must stay within the configured workspace directory.`
    );
  }

  return resolved;
}

export function workspaceRelativePath(absolutePath: string): string {
  const root = path.resolve(workspaceRoot);
  if (absolutePath.startsWith(root + path.sep) || absolutePath === root) {
    return absolutePath.slice(root.length).replace(/^[/\\]/, "");
  }
  return absolutePath;
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

/**
 * Safe sudo allowlist — these sudo prefixes are explicitly permitted.
 * Everything else is blocked.
 */
const SUDO_ALLOWLIST = ["sudo npm", "sudo npx", "sudo pip", "sudo python", "sudo node", "sudo yarn", "sudo pnpm"];

const BLOCKED_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf\s+\/(?!\w)/, reason: "recursive deletion from filesystem root" },
  { pattern: /rm\s+-rf\s+~/, reason: "recursive deletion of home directory" },
  { pattern: /rmdir\s+\/(?!\w)/, reason: "removal of root directory" },
  { pattern: /mkfs/, reason: "filesystem formatting" },
  { pattern: /dd\s+.*of=\/dev/, reason: "raw device write" },
  { pattern: />\s*\/dev\/sda/, reason: "raw device write" },
  { pattern: /format\s+[a-z]:/i, reason: "Windows drive formatting" },
  { pattern: /del\s+\/[sq]/i, reason: "Windows recursive delete" },
  { pattern: /rd\s+\/[sq]/i, reason: "Windows recursive directory removal" },
  { pattern: /Remove-Item\s+.*-Recurse\s+.*-Force/i, reason: "PowerShell recursive forced deletion" },
  { pattern: /shutdown(\s|$)/, reason: "system shutdown" },
  { pattern: /reboot(\s|$)/, reason: "system reboot" },
  { pattern: /\bhalt\b/, reason: "system halt" },
  { pattern: /\bpoweroff\b/, reason: "system power off" },
  { pattern: /kill\s+-9\s+1(\s|$)/, reason: "killing init process" },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}/, reason: "fork bomb" },
  { pattern: /curl\s+.*\|\s*(ba)?sh/, reason: "piped remote script execution" },
  { pattern: /wget\s+.*\|\s*(ba)?sh/, reason: "piped remote script execution" },
  { pattern: /curl\s+.*\|\s*sudo/, reason: "piped remote script with sudo" },
  // curl/wget writing to disk via output flags
  { pattern: /\b(?:curl|wget)\b.*\s(?:-o\s|-O\s|--output[= ])/, reason: "downloading file to disk via curl/wget" },
  // chmod 777 or chmod a+rwx / a+x on any path
  { pattern: /\bchmod\s+777\b/, reason: "world-writable permissions (chmod 777)" },
  { pattern: /\bchmod\s+a\+(?:rwx|wx|x)\b/, reason: "world-executable permissions (chmod a+...x)" },
];

export function validateCommand(cmd: string): void {
  // Check standard blocked patterns first
  for (const { pattern, reason } of BLOCKED_COMMANDS) {
    if (pattern.test(cmd)) {
      throw new SafetyError(
        `Command blocked: ${reason}. The command "${cmd.slice(0, 80)}" matches a safety rule and will not run.`
      );
    }
  }

  // Check for arbitrary sudo — block anything that starts with `sudo` but is NOT
  // in the explicit allowlist.
  if (/\bsudo\b/.test(cmd)) {
    const trimmed = cmd.trim();
    const isAllowed = SUDO_ALLOWLIST.some(allowed => trimmed.startsWith(allowed));
    if (!isAllowed) {
      throw new SafetyError(
        `Command blocked: arbitrary sudo execution. The command "${cmd.slice(0, 80)}" uses sudo with a non-allowlisted program. ` +
          `Permitted sudo prefixes: ${SUDO_ALLOWLIST.join(", ")}.`
      );
    }
  }
}

export function isWindowsPlatform(): boolean {
  return process.platform === "win32";
}
