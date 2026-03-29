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
// Two-tier extraction to separate high-confidence component names from
// generic UI region terms.  The distinction is critical for precision scoring:
//
//   HIGH-CONFIDENCE (extractComponentNames):
//     • CamelCase words → very likely React component names
//       e.g. "TaskPanel" → "task-panel" + parts "task", "panel"
//     • Quoted filenames  (e.g. `task-panel.tsx`)
//     → Used with high weight (exact=8, partial=3) in file scoring.
//
//   LOW-CONFIDENCE (UI_REGION_TERMS scan):
//     • Generic layout words that appear in the analysis text
//       e.g. "sidebar", "panel", "header" — match many unrelated files
//     → Used with low weight (+1) — provides signal but doesn't dominate.
//
// The previous flat-weight approach (+4 for ALL terms) caused every file in a
// "panels/" directory to score near-identically regardless of whether the
// vision model actually named that component.

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
 * Extract HIGH-CONFIDENCE component name terms from a vision model's analysis.
 * Only includes CamelCase component names and quoted file references.
 * Does NOT include generic region terms (panel, header, etc.) which are too broad.
 *
 * Each returned entry is { kebab, parts } where:
 *   kebab = full kebab-case name (e.g. "task-panel")
 *   parts = individual sub-words (e.g. ["task", "panel"])
 */
export interface ComponentNameEntry {
  kebab:    string;
  parts:    string[];
  mentions: number; // how many times this CamelCase word appeared in the analysis
}

export function extractComponentNames(analysisText: string): ComponentNameEntry[] {
  const mentionCounts = new Map<string, number>(); // kebab → count

  // Count all CamelCase occurrences (including duplicates)
  const camelWords = analysisText.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) ?? [];
  for (const word of camelWords) {
    const kebab = word
      .replace(/([A-Z])/g, (m, c, i) => (i > 0 ? "-" : "") + c.toLowerCase())
      .replace(/^-/, "");
    mentionCounts.set(kebab, (mentionCounts.get(kebab) ?? 0) + 1);
  }

  const names: ComponentNameEntry[] = [];

  for (const [kebab, mentions] of mentionCounts) {
    const parts = kebab.split("-").filter((p) => p.length > 3 && !STOP_WORDS.has(p));
    names.push({ kebab, parts, mentions });
  }

  // Quoted file paths/names (e.g. `task-panel.tsx`, "styles.css") — high confidence
  const quotedPaths = analysisText.match(/[`'"]([\w][\w\-./]+\.[a-z]{2,5})[`'"]/g) ?? [];
  for (const quoted of quotedPaths) {
    const inner = quoted.slice(1, -1);
    const base  = inner.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    const kebab = base.replace(/_/g, "-").toLowerCase();
    if (kebab.length > 2 && !STOP_WORDS.has(kebab)) {
      // If already captured from CamelCase, boost its mentions count
      const existing = names.find((n) => n.kebab === kebab);
      if (existing) { existing.mentions += 2; }
      else { names.push({ kebab, parts: [], mentions: 2 }); }
    }
  }

  // Bare file references without quotes (e.g. "task-panel.tsx" in prose) — medium confidence
  // Pattern: word-with-hyphens.known-ext — avoids matching generic words like "fix.css"
  const bareFiles = analysisText.match(
    /\b([a-z][\w\-]+\.(tsx?|jsx?|css|scss|less|html|vue|svelte))\b/g
  ) ?? [];
  for (const bare of bareFiles) {
    const base  = bare.replace(/\.[^.]+$/, "");
    const kebab = base.replace(/_/g, "-").toLowerCase();
    if (kebab.length > 3 && !STOP_WORDS.has(kebab)) {
      const existing = names.find((n) => n.kebab === kebab);
      if (existing) { existing.mentions += 1; }
      else { names.push({ kebab, parts: [], mentions: 1 }); }
    }
  }

  // Sort by mention count descending so most-mentioned components rank first
  return names.sort((a, b) => b.mentions - a.mentions);
}

/**
 * Extract file-selection keywords from a vision model's analysis output.
 * Returns a flat deduplicated list (CamelCase + region terms).
 * Use extractComponentNames() for high-precision scoring.
 */
export function extractVisualKeywords(analysisText: string): string[] {
  const keywords = new Set<string>();
  const lower    = analysisText.toLowerCase();

  // High-confidence component names
  for (const { kebab, parts } of extractComponentNames(analysisText)) {
    keywords.add(kebab);
    parts.forEach((p) => keywords.add(p));
  }

  // Low-confidence: generic UI region terms present in analysis
  for (const term of UI_REGION_TERMS) {
    if (lower.includes(term)) keywords.add(term);
  }

  return [...keywords].filter((k) => k.length > 2 && !STOP_WORDS.has(k));
}

// ─── Visual-aware file selector ───────────────────────────────────────────────
//
// Two-tier visual scoring that separates high-signal component-name matches
// from low-signal generic region-term matches.
//
// SCORING TIERS:
//   Exact filename = component kebab name  →  +8  (strongest: vision named this exact component)
//   Partial path   = component kebab/part  →  +3  (good: part of a named component matches path)
//   Generic region term in path            →  +1  (weak: "panel" in panels/ dir — lots of files)
//   Prompt keyword in path                 →  +3  (user's own words — solid signal)
//   Style file (.css/.scss/…)             →  +5  (always relevant for visual fixes)
//   CSS module                             →  +4
//   Component file (.tsx/.jsx/…)          →  +2
//   Path-pattern signal (layout/, ui/…)   →  +2  (cap 1 match)
//   Recency <1h/8h/48h                    →  +3/2/1
//   Shallow (depth≤2)                     →  +1
//
// Minimum score to surface in bridge: 5 (raised from 3 to filter noise).
// Default max candidates: 5 (reduced from 10 to enforce precision).

export interface ScoredFile {
  file:    FileMetadata;
  reasons: string[];   // e.g. ["visual[exact]: task-panel", "prompt: panel", "style file"]
  score:   number;
}

const MIN_BRIDGE_SCORE  = 5;   // was MIN_VISUAL_SCORE=3 — higher threshold reduces noise
const MAX_BRIDGE_FILES  = 5;   // default candidate count for bridge selection

/**
 * Select files relevant to a visual task using two-tier visual scoring.
 * High-confidence component names score much higher than generic region terms.
 * Returns up to `maxFiles` results with per-file reasoning.
 */
export function selectVisualAwareFiles(
  index:          ProjectIndex,
  userPrompt:     string,
  visualAnalysis: string,
  maxFiles:       number = MAX_BRIDGE_FILES
): ScoredFile[] {
  const promptTerms    = extractTerms(userPrompt);
  const componentNames = extractComponentNames(visualAnalysis);

  // Build a set of ALL terms already covered by component names (full kebabs + parts).
  // Excludes those terms from the low-signal region scan to prevent double-counting.
  // e.g. if "file-explorer" is a component name, "explorer" (its part) should not
  // also independently add score from the generic region-term scan.
  const componentTermsCovered = new Set<string>();
  for (const { kebab, parts } of componentNames) {
    componentTermsCovered.add(kebab);
    parts.forEach((p) => componentTermsCovered.add(p));
  }

  // Low-signal region terms: only those NOT already covered by component name/parts
  const regionTerms = UI_REGION_TERMS.filter(
    (t) => visualAnalysis.toLowerCase().includes(t) && !componentTermsCovered.has(t)
  );

  const results: ScoredFile[] = [];

  for (const file of index.files) {
    const filePath = file.path.toLowerCase().replace(/\\/g, "/");
    const filename  = path.basename(filePath, path.extname(filePath));
    let score = 0;
    const reasons: string[] = [];

    // ── File-type signals ──────────────────────────────────────────────────
    if (VISUAL_STYLE_EXTS.has(file.ext)) {
      score += 5; reasons.push("style file");
    } else if (filePath.includes(".module.")) {
      score += 4; reasons.push("CSS module");
    } else if (VISUAL_COMPONENT_EXTS.has(file.ext)) {
      score += 2; reasons.push("component file");
    }

    // ── Path-pattern signals (cap at 1 match) ──────────────────────────────
    for (const signal of VISUAL_PATH_SIGNALS) {
      if (filePath.includes(signal)) { score += 2; break; }
    }

    // ── Prompt keyword match (+3) ─────────────────────────────────────────
    for (const term of promptTerms) {
      if (filePath.includes(term)) {
        score += 3;
        reasons.push(`prompt: "${term}"`);
      }
    }

    // ── High-confidence: component name matches ───────────────────────────
    // Exact filename match = vision named this specific component.
    // Bonus is weighted by mention count: more mentions = stronger signal.
    //   1 mention  → exact +7  (was mentioned once — may be incidental)
    //   2 mentions → exact +9  (mentioned twice — likely the focus)
    //   3+ mentions→ exact +11 (mentioned 3+ times — clearly the defect target)
    //
    // This ensures a component mentioned 3× in defect sections scores much
    // higher than one mentioned once in passing as "working fine".
    for (const { kebab, parts, mentions } of componentNames) {
      const mentionBonus = Math.min(4, (mentions - 1) * 2); // 0, 2, 4 for 1, 2, 3+ mentions
      if (filename === kebab) {
        const exactBonus = 7 + mentionBonus;
        score += exactBonus;
        reasons.push(`visual[exact×${mentions}]: "${kebab}"`);
      } else if (filePath.includes(kebab)) {
        // Full kebab in path (but not exact filename) — e.g. "task-panel" in dir name
        score += 3;
        reasons.push(`visual[path]: "${kebab}"`);
      } else {
        // Check individual parts (low-signal, capped contribution)
        for (const part of parts) {
          if (filename === part) {
            score += 3; reasons.push(`visual[part-exact]: "${part}"`); break;
          } else if (filePath.includes(part)) {
            score += 1; // minimal — part appears somewhere in path
            break;
          }
        }
      }
    }

    // ── Low-confidence: generic region terms (+1 each, cap 3 total) ───────
    let regionBonus = 0;
    for (const term of regionTerms) {
      if (regionBonus >= 3) break;
      if (filePath.includes(term)) { regionBonus += 1; }
    }
    score += regionBonus;

    // ── Recency ───────────────────────────────────────────────────────────
    const ageHours = (Date.now() - file.mtimeMs) / 3_600_000;
    if      (ageHours < 1)  score += 3;
    else if (ageHours < 8)  score += 2;
    else if (ageHours < 48) score += 1;

    // ── Shallow files (global styles, main layout) ─────────────────────────
    if (file.depth <= 2) score += 1;

    if (score >= MIN_BRIDGE_SCORE) {
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
