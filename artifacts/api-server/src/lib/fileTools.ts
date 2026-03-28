import fs from "fs/promises";
import path from "path";
import { validateWorkspacePath, workspaceRelativePath, getWorkspaceRoot } from "./safety.js";

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileEntry[];
}

// Re-export the authoritative ignore list from projectIndex so fileTools
// and the project intelligence layer stay in sync. Then extend it with a
// broader set for the interactive file-tree browser.
export const IGNORED_DIRS = new Set([
  // Package managers
  "node_modules",
  "vendor",
  "bower_components",
  // Build outputs
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "target",
  "__pycache__",
  // Caches
  ".cache",
  ".parcel-cache",
  ".turbo",
  ".sass-cache",
  ".gradle",
  // Test / coverage
  "coverage",
  ".nyc_output",
  ".pytest_cache",
  "htmlcov",
  // VCS
  ".git",
  ".hg",
  ".svn",
  // IDEs
  ".idea",
  ".vscode",
  // Virtual envs
  ".venv",
  "venv",
  // Temp
  "tmp",
  "temp",
  ".temp",
  ".tmp",
]);

const MAX_DEPTH = 6;
const MAX_CHILDREN = 200;

export async function listDirectory(relativePath: string = ""): Promise<FileEntry[]> {
  const absPath = relativePath
    ? validateWorkspacePath(relativePath)
    : getWorkspaceRoot();

  return buildTree(absPath, 0);
}

async function buildTree(absPath: string, depth: number): Promise<FileEntry[]> {
  if (depth >= MAX_DEPTH) return [];

  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const filtered = entries
    .filter((e) => !e.name.startsWith(".") || depth === 0)
    .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
    .slice(0, MAX_CHILDREN);

  const sorted = filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const result: FileEntry[] = [];
  for (const entry of sorted) {
    const fullPath = path.join(absPath, entry.name);
    const relPath = workspaceRelativePath(fullPath);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, depth + 1);
      result.push({ name: entry.name, path: relPath, type: "directory", children });
    } else if (entry.isFile()) {
      result.push({ name: entry.name, path: relPath, type: "file" });
    }
  }

  return result;
}

export async function readFile(relativePath: string): Promise<{ content: string; language: string }> {
  const absPath = validateWorkspacePath(relativePath);
  const content = await fs.readFile(absPath, "utf-8");
  const language = detectLanguage(relativePath);
  return { content, language };
}

export async function writeFile(relativePath: string, content: string): Promise<void> {
  const absPath = validateWorkspacePath(relativePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, "utf-8");
}

export async function deleteFile(relativePath: string): Promise<void> {
  const absPath = validateWorkspacePath(relativePath);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) {
    await fs.rm(absPath, { recursive: true, force: true });
  } else {
    await fs.unlink(absPath);
  }
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".md": "markdown",
    ".sh": "shell",
    ".bash": "shell",
    ".sql": "sql",
    ".xml": "xml",
    ".vue": "vue",
    ".svelte": "svelte",
  };
  return map[ext] || "plaintext";
}
