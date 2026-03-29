/**
 * orchestrator/diffEngine.ts — Pure-TypeScript line-level diff engine.
 *
 * Implements a minimal LCS (Myers-derived) line differ that produces standard
 * unified diff output. No external libraries. Operates purely in-memory.
 *
 * Handles:
 *   - Empty original (new file) → all lines shown as additions
 *   - Empty modified (deleted content) → all lines shown as removals
 *   - Binary-like content (NUL bytes) → marked as binary, diff skipped
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DiffHunk {
  origStart:  number;
  origCount:  number;
  modStart:   number;
  modCount:   number;
  lines:      string[];  // raw lines with leading +/-/ 
}

export interface DiffResult {
  linesAdded:   number;
  linesRemoved: number;
  hunks:        DiffHunk[];
  unified:      string;
  isBinary:     boolean;
}

// ─── Binary detection ─────────────────────────────────────────────────────────

function isBinaryContent(s: string): boolean {
  // NUL byte is a strong binary signal
  return s.includes("\0");
}

// ─── LCS via dynamic programming ─────────────────────────────────────────────

type EditOp = "eq" | "add" | "del";

interface Edit {
  op:   EditOp;
  line: string;
}

/**
 * Compute the edit sequence between two line arrays using LCS.
 * Returns a flat list of Edit operations (eq / add / del).
 *
 * Uses the classic O(n*m) DP table. Acceptable for files of reasonable size
 * (< 2000 lines); for larger files we accept slightly imperfect output.
 */
function computeEdits(origLines: string[], modLines: string[]): Edit[] {
  const n = origLines.length;
  const m = modLines.length;

  // Safety: cap at 1500×1500 to avoid OOM on huge files
  if (n > 1500 || m > 1500) {
    // Fallback: treat as full replacement
    return [
      ...origLines.map(line => ({ op: "del" as EditOp, line })),
      ...modLines.map(line => ({ op: "add" as EditOp, line })),
    ];
  }

  // Build LCS DP table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origLines[i - 1] === modLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce edit list
  const edits: Edit[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      edits.push({ op: "eq", line: origLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.push({ op: "add", line: modLines[j - 1] });
      j--;
    } else {
      edits.push({ op: "del", line: origLines[i - 1] });
      i--;
    }
  }
  edits.reverse();
  return edits;
}

// ─── Hunk builder ─────────────────────────────────────────────────────────────

const CONTEXT_LINES = 3;

function buildHunks(edits: Edit[]): DiffHunk[] {
  // Convert edits to hunk array
  const hunks: DiffHunk[] = [];

  // Assign line numbers to edits
  interface NumberedEdit extends Edit {
    origLine: number;  // 1-based, 0 = not present in orig
    modLine:  number;  // 1-based, 0 = not present in mod
  }

  const numbered: NumberedEdit[] = [];
  let origLine = 1;
  let modLine  = 1;
  for (const edit of edits) {
    if (edit.op === "eq") {
      numbered.push({ ...edit, origLine, modLine });
      origLine++;
      modLine++;
    } else if (edit.op === "del") {
      numbered.push({ ...edit, origLine, modLine: 0 });
      origLine++;
    } else {
      numbered.push({ ...edit, origLine: 0, modLine });
      modLine++;
    }
  }

  // Find changed edit indices
  const changedIndices = numbered.reduce<number[]>((acc, e, idx) => {
    if (e.op !== "eq") acc.push(idx);
    return acc;
  }, []);

  if (changedIndices.length === 0) return [];

  // Group changed indices into windows (separated by > 2*CONTEXT_LINES eq lines)
  const windows: Array<[number, number]> = [];
  let winStart = Math.max(0, changedIndices[0] - CONTEXT_LINES);
  let winEnd   = Math.min(numbered.length - 1, changedIndices[0] + CONTEXT_LINES);

  for (let k = 1; k < changedIndices.length; k++) {
    const nextStart = Math.max(0, changedIndices[k] - CONTEXT_LINES);
    if (nextStart <= winEnd + 1) {
      winEnd = Math.min(numbered.length - 1, changedIndices[k] + CONTEXT_LINES);
    } else {
      windows.push([winStart, winEnd]);
      winStart = nextStart;
      winEnd   = Math.min(numbered.length - 1, changedIndices[k] + CONTEXT_LINES);
    }
  }
  windows.push([winStart, winEnd]);

  // Build hunks from windows
  for (const [start, end] of windows) {
    const slice = numbered.slice(start, end + 1);
    const origStart = slice.find(e => e.origLine > 0)?.origLine ?? 1;
    const modStart  = slice.find(e => e.modLine  > 0)?.modLine  ?? 1;
    const origCount = slice.filter(e => e.op !== "add").length;
    const modCount  = slice.filter(e => e.op !== "del").length;
    const lines     = slice.map(e => (e.op === "eq" ? " " : e.op === "add" ? "+" : "-") + e.line);
    hunks.push({ origStart, origCount, modStart, modCount, lines });
  }

  return hunks;
}

// ─── Unified diff formatter ───────────────────────────────────────────────────

function formatUnified(filePath: string, hunks: DiffHunk[]): string {
  if (hunks.length === 0) return "";
  const header = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const body: string[] = [];
  for (const hunk of hunks) {
    body.push(`@@ -${hunk.origStart},${hunk.origCount} +${hunk.modStart},${hunk.modCount} @@`);
    body.push(...hunk.lines);
  }
  return [...header, ...body].join("\n") + "\n";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute a unified diff between original and modified content for a given file path.
 *
 * @param original  - Original file content (empty string for new files).
 * @param modified  - Modified file content (empty string if file was deleted).
 * @param filePath  - Relative path used in the unified diff header.
 * @returns DiffResult with linesAdded, linesRemoved, hunks, unified diff string.
 */
export function computeDiff(original: string, modified: string, filePath: string): DiffResult {
  // Binary detection
  if (isBinaryContent(original) || isBinaryContent(modified)) {
    return {
      linesAdded:   0,
      linesRemoved: 0,
      hunks:        [],
      unified:      `Binary file: ${filePath}`,
      isBinary:     true,
    };
  }

  // Split into lines (preserve trailing newline behaviour)
  const origLines = original  === "" ? [] : original.split("\n");
  const modLines  = modified  === "" ? [] : modified.split("\n");

  // Remove spurious trailing empty string from split("\n") when content ends with \n
  const normalizeLines = (lines: string[]) =>
    lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;

  const ol = normalizeLines(origLines);
  const ml = normalizeLines(modLines);

  const edits = computeEdits(ol, ml);

  const linesAdded   = edits.filter(e => e.op === "add").length;
  const linesRemoved = edits.filter(e => e.op === "del").length;

  const hunks  = buildHunks(edits);
  const unified = formatUnified(filePath, hunks);

  return { linesAdded, linesRemoved, hunks, unified, isBinary: false };
}
