/**
 * orchestrator/checkpoint.ts — Task-scoped pre-edit snapshot and discard model.
 *
 * WHAT THIS IS:
 *   A real safety layer for code-edit tasks. Before any file is written, its
 *   original content is snapshotted into an in-memory TaskCheckpoint. When the
 *   task finishes, the operator can:
 *
 *     • Discard — restore all files to their exact pre-task state (full rollback)
 *     • Apply   — accept changes permanently (prevents future discard)
 *
 * HOW IT WORKS:
 *   1. The agent loop calls snapshotFileForTask() before every write_file action.
 *   2. The snapshot is idempotent — only the FIRST write to a file is snapshotted,
 *      preserving the true "before" state even if the agent rewrites the same file.
 *   3. After a successful write, patchSnapshotWithDiff() computes per-file diffs.
 *   4. At task completion, a "checkpoint" event is emitted with the file list.
 *   5. The checkpoint API routes expose discard/apply endpoints.
 *   6. The frontend renders a CheckpointCard with real Discard/Accept buttons.
 *
 * SCOPE:
 *   Only tasks that perform at least one successful write_file get a checkpoint.
 *   Text-only, conversational, and command-only tasks are unaffected.
 *
 * STORAGE:
 *   Snapshots are in-memory only (not persisted to disk). If the server restarts,
 *   the snapshot data is lost and discard is no longer possible — but the files
 *   written during the task remain on disk as-is. This is an honest limitation:
 *   we document it rather than pretending otherwise.
 *
 * WHAT THIS IS NOT:
 *   This is not a Git branch, staging area, or patch-apply system.
 *   It is a bounded, honest snapshot-per-task rollback mechanism.
 */

import fs from "fs/promises";
import path from "path";
import { logger } from "../logger.js";
import { computeDiff } from "./diffEngine.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckpointStatus = "pending" | "applied" | "discarded";

export interface FileSnapshot {
  /** Relative workspace path — same key used in write_file. */
  path: string;
  /** Content of the file captured before the first write. Empty string for new files. */
  originalContent: string;
  /** True if the file existed before the task touched it. */
  existed: boolean;
  /** ISO timestamp of when the snapshot was taken. */
  snapshotAt: string;
  /** Unified diff string (populated after the first successful write to this file). */
  diff?: string;
  /** Lines added in this file vs. the original. */
  linesAdded?: number;
  /** Lines removed from this file vs. the original. */
  linesRemoved?: number;
}

export interface TaskCheckpoint {
  taskId: string;
  /** ISO timestamp of when the first snapshot was taken (= first write intent). */
  createdAt: string;
  /** Per-file snapshots. Keyed by relative path. Set is built lazily. */
  snapshots: Map<string, FileSnapshot>;
  status: CheckpointStatus;
  appliedAt?: string;
  discardedAt?: string;
  /** Absolute workspace root — needed for file restoration on discard. */
  wsRoot: string;
}

// Serialisable form used in API responses and event data (no content blobs).
export interface CheckpointFileSummary {
  path: string;
  existed: boolean;
  snapshotAt: string;
  /** Size of original content in bytes (0 for new files). */
  originalBytes: number;
  /** Unified diff string (populated after write). */
  diff?: string;
  /** Lines added vs. original. */
  linesAdded?: number;
  /** Lines removed vs. original. */
  linesRemoved?: number;
}

export interface CheckpointSummary {
  taskId: string;
  createdAt: string;
  status: CheckpointStatus;
  appliedAt?: string;
  discardedAt?: string;
  files: CheckpointFileSummary[];
  fileCount: number;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const checkpoints = new Map<string, TaskCheckpoint>();

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Snapshot a file's current content before it gets written by the agent.
 *
 * Idempotent: calling this twice for the same (taskId, filePath) pair keeps
 * only the FIRST snapshot — preserving the true "before" state even when the
 * agent rewrites the same file multiple times in one task.
 *
 * Creates the TaskCheckpoint lazily on the first call for a given task.
 */
export async function snapshotFileForTask(
  taskId: string,
  filePath: string,
  wsRoot: string,
): Promise<void> {
  // Create the checkpoint record on the first write for this task
  if (!checkpoints.has(taskId)) {
    checkpoints.set(taskId, {
      taskId,
      createdAt: new Date().toISOString(),
      snapshots: new Map(),
      status: "pending",
      wsRoot,
    });
    logger.info({ taskId }, "[Checkpoint] Checkpoint created");
  }

  const cp = checkpoints.get(taskId)!;

  // Idempotent guard — never overwrite the first snapshot of a file
  if (cp.snapshots.has(filePath)) return;

  const absPath = path.join(wsRoot, filePath);
  let originalContent = "";
  let existed = false;

  try {
    originalContent = await fs.readFile(absPath, "utf8");
    existed = true;
  } catch {
    // File does not exist yet — will be newly created. Snapshot is an empty sentinel.
    existed = false;
  }

  cp.snapshots.set(filePath, {
    path: filePath,
    originalContent,
    existed,
    snapshotAt: new Date().toISOString(),
  });

  logger.debug(
    { taskId, filePath, existed, bytes: originalContent.length },
    "[Checkpoint] File snapshotted",
  );
}

/**
 * Compute and store a diff on the existing snapshot for a file, after the
 * agent has successfully written the file. Safe to call multiple times —
 * each call overwrites the previous diff (so the latest write state is shown).
 *
 * @param taskId        - Task identifier.
 * @param filePath      - Relative file path (must match snapshot key).
 * @param modifiedContent - The content that was just written to the file.
 */
export function patchSnapshotWithDiff(
  taskId: string,
  filePath: string,
  modifiedContent: string,
): void {
  const cp = checkpoints.get(taskId);
  if (!cp) return;

  const snap = cp.snapshots.get(filePath);
  if (!snap) return;

  try {
    const result = computeDiff(snap.originalContent, modifiedContent, filePath);
    snap.diff         = result.unified;
    snap.linesAdded   = result.linesAdded;
    snap.linesRemoved = result.linesRemoved;
    logger.debug(
      { taskId, filePath, linesAdded: result.linesAdded, linesRemoved: result.linesRemoved },
      "[Checkpoint] Diff patched onto snapshot",
    );
  } catch (err) {
    logger.warn({ taskId, filePath, err }, "[Checkpoint] Diff computation failed — snapshot kept without diff");
  }
}

/**
 * Return the TaskCheckpoint for a task, or undefined if no files were written.
 */
export function getCheckpoint(taskId: string): TaskCheckpoint | undefined {
  return checkpoints.get(taskId);
}

/**
 * Serialise a checkpoint to a safe API/event payload (no full content blobs).
 */
export function serializeCheckpoint(cp: TaskCheckpoint): CheckpointSummary {
  const files: CheckpointFileSummary[] = [];
  for (const snap of cp.snapshots.values()) {
    files.push({
      path:          snap.path,
      existed:       snap.existed,
      snapshotAt:    snap.snapshotAt,
      originalBytes: snap.originalContent.length,
      diff:          snap.diff,
      linesAdded:    snap.linesAdded,
      linesRemoved:  snap.linesRemoved,
    });
  }
  return {
    taskId:       cp.taskId,
    createdAt:    cp.createdAt,
    status:       cp.status,
    appliedAt:    cp.appliedAt,
    discardedAt:  cp.discardedAt,
    files,
    fileCount:    files.length,
  };
}

/**
 * Discard all changes made by a task — restore every snapshotted file to
 * its exact pre-task content.
 *
 * - Files that existed before the task: content is overwritten with the original.
 * - Files that the task created from scratch: the file is deleted.
 *
 * Returns the list of file paths that were successfully restored.
 * Individual restore failures are logged and skipped rather than aborting the
 * whole discard — partial restoration is better than none.
 */
export async function discardCheckpoint(taskId: string): Promise<string[]> {
  const cp = checkpoints.get(taskId);
  if (!cp) throw new Error(`No checkpoint found for task ${taskId}`);
  if (cp.status === "applied")
    throw new Error(`Task ${taskId} checkpoint was already applied — cannot discard`);
  if (cp.status === "discarded")
    throw new Error(`Task ${taskId} checkpoint was already discarded`);

  const restored: string[] = [];

  for (const snap of cp.snapshots.values()) {
    const absPath = path.join(cp.wsRoot, snap.path);
    try {
      if (snap.existed) {
        // Restore original content — file existed before the task
        await fs.writeFile(absPath, snap.originalContent, "utf8");
        logger.info({ taskId, path: snap.path }, "[Checkpoint] File restored to original");
      } else {
        // File was newly created by this task — delete it
        await fs.unlink(absPath);
        logger.info({ taskId, path: snap.path }, "[Checkpoint] New file deleted (discard)");
      }
      restored.push(snap.path);
    } catch (err) {
      logger.warn(
        { taskId, path: snap.path, err },
        "[Checkpoint] Failed to restore file — continuing with remaining files",
      );
    }
  }

  cp.status = "discarded";
  cp.discardedAt = new Date().toISOString();
  logger.info({ taskId, restoredCount: restored.length }, "[Checkpoint] Checkpoint discarded");

  return restored;
}

/**
 * Apply a checkpoint — mark changes as permanently accepted.
 * After this call, discard is no longer possible for this task.
 */
export function applyCheckpoint(taskId: string): void {
  const cp = checkpoints.get(taskId);
  if (!cp) throw new Error(`No checkpoint found for task ${taskId}`);
  if (cp.status === "discarded")
    throw new Error(`Task ${taskId} checkpoint was already discarded — cannot apply`);

  cp.status = "applied";
  cp.appliedAt = new Date().toISOString();
  logger.info({ taskId }, "[Checkpoint] Checkpoint applied permanently");
}

/**
 * Remove the checkpoint for a deleted task (keeps memory clean).
 */
export function deleteCheckpoint(taskId: string): void {
  checkpoints.delete(taskId);
}
