/**
 * projectIndex.ts — lightweight workspace intelligence layer
 *
 * Provides:
 *  - Fast file inventory with size + modification-time metadata
 *  - TTL-based cache (30 s) so repeated tasks don't rebuild the index
 *  - Keyword + recency + extension-based relevance scoring
 *  - Compact project summary string for prompt injection
 *
 * Design constraints:
 *  - Max 2 000 files indexed (prevents runaway scans on huge repos)
 *  - Max 8 directory levels
 *  - Files >1 MB are skipped (binary / generated artefacts)
 *  - Ignores the same directories as fileTools, plus a broader set
 */

import fs from "fs/promises";
import path from "path";

// ─── Ignore rules ─────────────────────────────────────────────────────────────
// Keep in sync with fileTools.ts IGNORED_DIRS. This set is intentionally
// larger because we're building a project-intelligence index, not a code tree
// for the user to browse.

export const IGNORE_DIRS = new Set([
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
  "target",           // Rust / Java / Maven
  "__pycache__",
  ".mypy_cache",
  ".ruff_cache",
  // Caches
  ".cache",
  ".parcel-cache",
  ".turbo",
  ".sass-cache",
  ".gradle",
  ".m2",
  // Test / coverage artefacts
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
  "env",
  ".env",             // Python env dirs (not .env files)
  // Temp
  "tmp",
  "temp",
  ".temp",
  ".tmp",
  // Generated / lock artefacts at directory level
  "storybook-static",
  ".docusaurus",
]);

const IGNORE_FILE_EXTENSIONS = new Set([
  ".lock",     // package-lock.json, yarn.lock, Cargo.lock
  ".log",
  ".map",      // source maps
  ".min.js",
  ".min.css",
  ".wasm",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".ico",
  ".svg",   // can be legitimate but usually not task-relevant
  ".ttf",
  ".woff",
  ".woff2",
  ".eot",
  ".mp4",
  ".mp3",
  ".wav",
  ".ogg",
  ".pdf",
  ".db",
  ".sqlite",
  ".sqlite3",
]);

const IGNORE_FILENAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  ".gitkeep",
  ".gitattributes",
  "package-lock.json",  // too large and rarely task-relevant
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
]);

const MAX_INDEX_FILES = 2_000;
const MAX_FILE_SIZE   = 1_000_000; // 1 MB — skip binary / generated files
const MAX_DEPTH       = 8;
const CACHE_TTL_MS    = 60_000;    // 60 s — doubled from 30 s (reduces rebuild overhead)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileMetadata {
  path:    string; // workspace-relative path
  size:    number; // bytes
  mtimeMs: number; // last modified (unix ms)
  ext:     string; // lowercase extension
  depth:   number; // directory nesting level
}

export interface ProjectIndex {
  wsRoot:     string;
  builtAt:    number;
  totalFiles: number;
  totalBytes: number;
  files:      FileMetadata[];
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cache: { index: ProjectIndex; wsRoot: string } | null = null;

export function invalidateProjectIndex(): void {
  _cache = null;
}

// ─── Index builder ────────────────────────────────────────────────────────────

async function walk(
  wsRoot: string,
  dir: string,
  depth: number,
  files: FileMetadata[]
): Promise<void> {
  if (files.length >= MAX_INDEX_FILES) return;
  if (depth > MAX_DEPTH) return;

  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_INDEX_FILES) return;

    // Skip hidden entries below root level (e.g. .eslintrc is allowed at root)
    if (entry.name.startsWith(".") && depth > 0) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath  = path.relative(wsRoot, fullPath);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(wsRoot, fullPath, depth + 1, files);
    } else if (entry.isFile()) {
      if (IGNORE_FILENAMES.has(entry.name)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORE_FILE_EXTENSIONS.has(ext)) continue;

      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;
        files.push({
          path:    relPath,
          size:    stat.size,
          mtimeMs: stat.mtimeMs,
          ext,
          depth,
        });
      } catch {
        continue;
      }
    }
  }
}

async function buildIndex(wsRoot: string): Promise<ProjectIndex> {
  const files: FileMetadata[] = [];
  await walk(wsRoot, wsRoot, 0, files);
  return {
    wsRoot,
    builtAt:    Date.now(),
    totalFiles: files.length,
    totalBytes: files.reduce((s, f) => s + f.size, 0),
    files,
  };
}

export async function getProjectIndex(wsRoot: string): Promise<ProjectIndex> {
  const now = Date.now();
  if (_cache && _cache.wsRoot === wsRoot && (now - _cache.index.builtAt) < CACHE_TTL_MS) {
    return _cache.index;
  }
  const index = await buildIndex(wsRoot);
  _cache = { index, wsRoot };
  return index;
}

// ─── Relevance scoring ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "with", "that", "this", "it", "its", "from", "by", "as", "not", "but",
  "if", "so", "then", "what", "when", "where", "how", "my", "your", "our",
  "please", "can", "you", "me", "file", "files", "add", "make", "create",
  "update", "change", "fix", "edit", "write", "read", "run", "show", "get",
]);

// Source-code extensions that are almost always task-relevant
const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".rb", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php",
  ".vue", ".svelte", ".astro",
  ".css", ".scss", ".sass", ".less",
  ".html", ".htm",
  ".sh", ".bash", ".zsh",
  ".sql",
  ".json", ".yaml", ".yml", ".toml", ".env",
  ".md", ".txt",
]);

function scoreFile(file: FileMetadata, terms: string[]): number {
  const filePath = file.path.toLowerCase().replace(/\\/g, "/");
  let score = 0;

  // Keyword matching against path + filename
  for (const term of terms) {
    if (filePath.includes(term)) {
      // Exact filename match is worth more than a directory-name match
      const filename = path.basename(filePath, path.extname(filePath));
      score += filename === term ? 4 : 2;
    }
  }

  // Recency boost
  const ageHours = (Date.now() - file.mtimeMs) / 3_600_000;
  if (ageHours < 1)  score += 4;
  else if (ageHours < 8)  score += 2;
  else if (ageHours < 48) score += 1;

  // Source-file type bonus
  if (SOURCE_EXTS.has(file.ext)) score += 1;

  // Prefer shallower files (root config, main entry points)
  if (file.depth === 0) score += 1;

  return score;
}

// Minimum score to include a file in the relevant set.
// Score of 2 means at least one keyword match (score 2) OR recency + source type (1+1).
// This prevents weakly-related files from cluttering the prompt context.
const MIN_RELEVANCE_SCORE = 2;

// Maximum files to surface in project intelligence (keeps prompts lean)
const MAX_RELEVANT_FILES = 15;

export function selectRelevantFiles(
  index:    ProjectIndex,
  prompt:   string,
  maxFiles: number = MAX_RELEVANT_FILES
): FileMetadata[] {
  const terms = prompt
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  if (terms.length === 0) {
    // No useful terms — fall back to most-recently-modified source files
    return [...index.files]
      .filter((f) => SOURCE_EXTS.has(f.ext))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, maxFiles);
  }

  return index.files
    .map((f) => ({ file: f, score: scoreFile(f, terms) }))
    .filter(({ score }) => score >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles)
    .map(({ file }) => file);
}

// ─── Visual debugging file selector ──────────────────────────────────────────
//
// Finds files most likely to be relevant for debugging a visual/UI issue.
// Prioritises CSS, style, and layout files over generic source files, and
// uses path-pattern signals specific to frontend/UI work.

const VISUAL_STYLE_EXTS = new Set([".css", ".scss", ".less", ".sass"]);
const VISUAL_COMPONENT_EXTS = new Set([".tsx", ".jsx", ".vue", ".svelte", ".astro", ".html", ".htm"]);

// Path substrings that strongly suggest UI/layout responsibility
const VISUAL_PATH_SIGNALS = [
  "layout", "grid", "panel", "style", "styles", "theme", "themes", "global",
  "component", "components", "ui", "page", "pages", "view", "views",
  "nav", "navbar", "header", "footer", "sidebar", "modal", "dialog",
  "card", "button", "form", "input", "table", "list", "menu", "index.css", "app",
];

function scoreVisualFile(file: FileMetadata, promptTerms: string[]): number {
  const filePath = file.path.toLowerCase().replace(/\\/g, "/");
  let score = 0;

  // CSS/style files → strongest signal
  if (VISUAL_STYLE_EXTS.has(file.ext)) score += 5;
  // CSS module pattern (e.g. Button.module.css)
  if (filePath.includes(".module.")) score += 2;
  // React/component files → good signal
  else if (VISUAL_COMPONENT_EXTS.has(file.ext)) score += 2;

  // Path pattern signals (cap contribution at 2 to avoid double-counting)
  let pathBonus = 0;
  for (const signal of VISUAL_PATH_SIGNALS) {
    if (filePath.includes(signal)) { pathBonus = 2; break; }
  }
  score += pathBonus;

  // Prompt keyword match
  for (const term of promptTerms) {
    if (filePath.includes(term)) score += 3;
  }

  // Recency (visually-broken code is often recently touched)
  const ageHours = (Date.now() - file.mtimeMs) / 3_600_000;
  if      (ageHours < 1)  score += 3;
  else if (ageHours < 8)  score += 2;
  else if (ageHours < 48) score += 1;

  // Prefer shallow files (global stylesheets live at root; ignore deep internals)
  if (file.depth <= 2) score += 1;

  return score;
}

const MIN_VISUAL_SCORE = 3;
const MAX_VISUAL_FILES = 10;

/**
 * Select files most relevant to a visual/UI debugging task.
 * Returns up to `maxFiles` results ordered by visual-debug relevance score.
 * Prefer selectRelevantFiles() for general tasks; use this for visual ones.
 */
export function selectVisualDebugFiles(
  index:    ProjectIndex,
  prompt:   string,
  maxFiles: number = MAX_VISUAL_FILES
): FileMetadata[] {
  const terms = prompt
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  return index.files
    .map((f) => ({ file: f, score: scoreVisualFile(f, terms) }))
    .filter(({ score }) => score >= MIN_VISUAL_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles)
    .map(({ file }) => file);
}

// ─── Visual keyword extraction ────────────────────────────────────────────────
//
// Parses the vision model's analysis text to extract file-selection signals:
//   • CamelCase words → likely component names (e.g. TaskPanel → task-panel)
//   • Known UI region terms mentioned anywhere in the analysis
//   • Quoted file references (e.g. `task-panel.tsx`)
//
// These terms are used by selectVisualAwareFiles() to score files against both
// the user's original prompt AND the richer vocabulary in the vision output.

// UI element names that commonly appear in frontend code paths / component names
const UI_REGION_TERMS = [
  "sidebar", "header", "footer", "modal", "dialog", "panel", "navbar", "nav",
  "button", "card", "form", "input", "table", "list", "menu", "toolbar", "tab",
  "badge", "chip", "dropdown", "select", "textarea", "editor", "terminal",
  "explorer", "taskbar", "topbar", "statusbar", "breadcrumb", "pagination",
  "accordion", "drawer", "sheet", "tooltip", "popover", "toast", "notification",
  "grid", "flex", "container", "wrapper", "layout", "content", "body", "row",
  "column", "cell", "item", "entry", "feed", "log", "output", "preview", "detail",
  "overlay", "backdrop", "mask", "banner", "alert", "spinner", "loader",
  "avatar", "icon", "label", "tag", "caption", "heading", "title", "subtitle",
  "description", "placeholder", "empty", "skeleton", "progress", "bar",
];

function extractTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Extract file-selection keywords from a vision model's analysis output.
 * Returns a deduplicated list of lowercase terms suitable for path matching.
 */
export function extractVisualKeywords(analysisText: string): string[] {
  const keywords = new Set<string>();
  const lower = analysisText.toLowerCase();

  // 1. CamelCase words — likely React component names — convert to kebab-case
  //    e.g. "TaskPanel" → ["task-panel", "task", "panel"]
  //    e.g. "FileExplorer" → ["file-explorer", "file", "explorer"]
  const camelWords = analysisText.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) ?? [];
  for (const word of camelWords) {
    const kebab = word
      .replace(/([A-Z])/g, (m, c, i) => (i > 0 ? "-" : "") + c.toLowerCase())
      .replace(/^-/, "");
    keywords.add(kebab);
    kebab.split("-").forEach((part) => { if (part.length > 3 && !STOP_WORDS.has(part)) keywords.add(part); });
  }

  // 2. Known UI region terms mentioned anywhere in the analysis text
  for (const term of UI_REGION_TERMS) {
    if (lower.includes(term)) keywords.add(term);
  }

  // 3. Quoted file paths or component filenames  (e.g. `task-panel.tsx`, "styles.css")
  const quotedPaths = analysisText.match(/[`'"]([\w][\w\-./]+\.[a-z]{2,5})[`'"]/g) ?? [];
  for (const quoted of quotedPaths) {
    const inner  = quoted.slice(1, -1);
    const base   = inner.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    const kebab  = base.replace(/_/g, "-").toLowerCase();
    if (kebab.length > 2 && !STOP_WORDS.has(kebab)) keywords.add(kebab);
  }

  return [...keywords].filter((k) => k.length > 2 && !STOP_WORDS.has(k));
}

// ─── Visual-aware file selector ───────────────────────────────────────────────
//
// Augments the existing visual-debug file scorer with keywords extracted from
// the vision model's analysis output.  Each returned file includes a `reasons`
// array so the caller can surface a transparent "why this file" explanation to
// the agent — turning file selection from a silent heuristic into something the
// agent (and the user) can actually reason about.

export interface ScoredFile {
  file:    FileMetadata;
  reasons: string[];   // e.g. ["visual: task-panel", "prompt: panel", "style file"]
  score:   number;
}

/**
 * Select files relevant to a visual task, scored by BOTH the user prompt AND
 * the vision model's analysis output.  Returns up to `maxFiles` results with
 * per-file reasoning.
 *
 * Use this instead of selectVisualDebugFiles() for fix/improve/analyze intents.
 */
export function selectVisualAwareFiles(
  index:          ProjectIndex,
  userPrompt:     string,
  visualAnalysis: string,
  maxFiles:       number = 10
): ScoredFile[] {
  const promptTerms = extractTerms(userPrompt);
  const visualTerms = extractVisualKeywords(visualAnalysis);

  const results: ScoredFile[] = [];

  for (const file of index.files) {
    const filePath = file.path.toLowerCase().replace(/\\/g, "/");
    let score = 0;
    const reasons: string[] = [];

    // File-type signals (same weights as selectVisualDebugFiles)
    if (VISUAL_STYLE_EXTS.has(file.ext)) {
      score += 5; reasons.push("style file");
    } else if (filePath.includes(".module.")) {
      score += 4; reasons.push("CSS module");
    } else if (VISUAL_COMPONENT_EXTS.has(file.ext)) {
      score += 2; reasons.push("component file");
    }

    // Path-pattern signals
    for (const signal of VISUAL_PATH_SIGNALS) {
      if (filePath.includes(signal)) { score += 2; break; }
    }

    // Prompt keyword match (weight 3 — original user intent)
    for (const term of promptTerms) {
      if (filePath.includes(term)) {
        score += 3;
        reasons.push(`prompt: "${term}"`);
      }
    }

    // Visual analysis keyword match (weight 4 — higher than prompt, because
    // these terms come from what the screenshot actually showed)
    for (const term of visualTerms) {
      if (filePath.includes(term)) {
        score += 4;
        if (!reasons.some((r) => r.includes(`"${term}"`))) {
          reasons.push(`visual: "${term}"`);
        }
      }
    }

    // Recency (visually-broken code is often recently touched)
    const ageHours = (Date.now() - file.mtimeMs) / 3_600_000;
    if      (ageHours < 1)  score += 3;
    else if (ageHours < 8)  score += 2;
    else if (ageHours < 48) score += 1;

    // Shallow files (global styles, main layout files) preferred
    if (file.depth <= 2) score += 1;

    if (score >= MIN_VISUAL_SCORE) {
      results.push({ file, reasons, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles);
}

// ─── Summary builder ──────────────────────────────────────────────────────────

export function buildProjectSummary(
  index:         ProjectIndex,
  relevantFiles: FileMetadata[]
): string {
  const lines: string[] = [];

  const totalKB   = Math.round(index.totalBytes / 1024);
  const fileCount = index.totalFiles;
  const capped    = fileCount >= MAX_INDEX_FILES ? "+" : "";
  lines.push(`${fileCount}${capped} files indexed, ~${totalKB} KB`);

  // Recently modified (top 6, excluding lock/generated files)
  const recent = [...index.files]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 6)
    .map((f) => f.path);
  if (recent.length > 0) {
    lines.push(`Recent: ${recent.join(", ")}`);
  }

  // Task-relevant files
  if (relevantFiles.length > 0) {
    lines.push(`Likely relevant: ${relevantFiles.map((f) => f.path).join(", ")}`);
  }

  return lines.join("\n");
}
