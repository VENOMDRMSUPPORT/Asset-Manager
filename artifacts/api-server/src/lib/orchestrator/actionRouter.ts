/**
 * orchestrator/actionRouter.ts — Action gating and execution discipline.
 *
 * The action router sits between "model produces an action" and "action executes".
 * It enforces per-profile caps and execution discipline without the model knowing
 * the specific limits — violations produce a forced correction message injected
 * into the conversation rather than a hard error.
 *
 * Gates checked (in order):
 *   1. Shell read bypass — blocks shell commands that effectively read file content
 *      when the file-read cap is already reached or the file is already read.
 *      Closes the loophole where `cat`, `sed -n`, `head`, `tail` bypass read_file caps.
 *   2. Read cap      — blocks read_file once profile.maxFileReads is reached
 *   3. Redundant read — blocks re-reading a file already in the read set
 *   4. Write cap     — blocks write_file once profile.maxFileWrites is reached
 *   5. Verification  — blocks done when unverified writes exist (if profile.requiresVerify)
 */

import type { RunState } from "./types.js";

// ─── Gate result ──────────────────────────────────────────────────────────────

export type GateResult =
  | { allowed: true }
  | { allowed: false; reason: GateRejectionReason; forcedMessage: string };

export type GateRejectionReason =
  | "shell_read_redundant"
  | "shell_read_cap_exceeded"
  | "redundant_read"
  | "read_cap_exceeded"
  | "write_cap_exceeded"
  | "verification_required";

// ─── Shell file-read detection ────────────────────────────────────────────────

/**
 * Detect whether a shell command is effectively reading file content.
 * Returns the primary file path being read, or null if not a content-read command.
 *
 * Commands counted as file reads:
 *   - `cat FILE` (without pipe to another command)
 *   - `sed -n 'X,Yp' FILE` or `sed -n 'Xp' FILE`
 *   - `head [-n N] FILE` (without additional pipe)
 *   - `tail [-n N] FILE` (without additional pipe)
 *   - `less FILE` / `bat FILE` / `more FILE`
 *
 * Commands NOT counted (info-only, not full content reads):
 *   - `wc -l FILE` (line count only)
 *   - `cat FILE | wc -c` (piped to counter)
 *   - `grep PATTERN FILE` (search / structural scan)
 *   - `ls FILE` / `stat FILE` (metadata only)
 */
export function detectShellFileRead(command: string): string | null {
  const cmd = command.trim();

  // Reject any command with a pipe — these are typically info transforms, not content reads.
  // The one exception: we still check if the base command is a naked read before the pipe.
  // Simple rule: if there's a pipe, it's not a raw content read.
  if (cmd.includes("|")) return null;

  // `cat FILE` — exact cat of a single file, no redirection
  const catMatch = cmd.match(/^cat\s+(['"]?)([^\s'"<>|;]+)\1\s*$/);
  if (catMatch) return catMatch[2];

  // `sed -n 'X[,Y]p' FILE` — partial or full content read via sed
  // Matches: sed -n '350,770p' file.tsx  OR  sed -n '1p' file
  const sedMatch = cmd.match(/^sed\b[^|<>]*\s-n\s+['"][\d,~$]+p['"]\s+(['"]?)([^\s'"<>|;]+)\1\s*$/);
  if (sedMatch) return sedMatch[2];

  // `head [-n N] FILE` or `head FILE` — reads top N lines
  const headMatch = cmd.match(/^head\s+(?:-[nql]\s+\d+\s+)?(['"]?)([^\s'"<>|;-][^\s'"<>|;]*)\1\s*$/);
  if (headMatch) return headMatch[2];

  // `tail [-n N] FILE` or `tail FILE` — reads bottom N lines
  const tailMatch = cmd.match(/^tail\s+(?:-[nf]\s+\d+\s+)?(['"]?)([^\s'"<>|;-][^\s'"<>|;]*)\1\s*$/);
  if (tailMatch) return tailMatch[2];

  // `less FILE` / `bat FILE` / `more FILE` — pager commands (full file content)
  const pagerMatch = cmd.match(/^(?:less|bat|more)\s+(['"]?)([^\s'"<>|;]+)\1\s*$/);
  if (pagerMatch) return pagerMatch[2];

  return null;
}

// ─── Main gate function ───────────────────────────────────────────────────────

/**
 * Check whether the action should be allowed given the current run state.
 * Returns `{ allowed: true }` to proceed, or `{ allowed: false, ... }` with a
 * corrective message to inject into the conversation.
 */
export function gateAction(
  action: Record<string, unknown>,
  state:  RunState,
): GateResult {
  const actionType = String(action["action"] ?? "");

  switch (actionType) {

    // ── Shell command: check for file-read bypass before allowing execution ──
    case "run_command": {
      const command = String(action["command"] ?? "");
      const readPath = detectShellFileRead(command);

      if (readPath !== null) {
        // Normalize the path for comparison (trim slashes, quotes)
        const normalizedPath = readPath.replace(/^["']|["']$/g, "");

        // Gate A: File already read this session (redundant shell read)
        if (normalizedPath && state.filesRead.has(normalizedPath)) {
          return {
            allowed: false,
            reason:  "shell_read_redundant",
            forcedMessage:
              `ORCHESTRATOR: Shell read blocked — "${normalizedPath}" was already read this session. ` +
              `Shell commands (cat, sed, head, tail) are subject to the same file-read policy as read_file. ` +
              `You already have the content of this file in context. ` +
              `Do not re-read it via shell commands. Proceed with the next action.`,
          };
        }

        // Gate B: Read cap exceeded (shell command would exceed budget)
        if (state.filesRead.size >= state.profile.maxFileReads) {
          const readList = [...state.filesRead].join(", ");
          return {
            allowed: false,
            reason:  "shell_read_cap_exceeded",
            forcedMessage:
              `ORCHESTRATOR: Shell read blocked — file-read cap reached ` +
              `(${state.profile.maxFileReads} reads for ${state.profile.category} tasks). ` +
              `Shell commands that read file content (cat, sed -n, head, tail) count against the same cap as read_file. ` +
              `Already read: ${readList || "(none)"}. ` +
              `Do not attempt to read additional file content via shell commands. ` +
              `Work with the information you have, or call done if the task is blocked.`,
          };
        }
      }

      return { allowed: true };
    }

    case "read_file": {
      const path = String(action["path"] ?? "");

      // Gate 1: Redundant read — same file already inspected this session.
      if (path && state.filesRead.has(path)) {
        return {
          allowed: false,
          reason:  "redundant_read",
          forcedMessage:
            `ORCHESTRATOR: You already read "${path}" this session. ` +
            `Do not read the same file twice — you already know its contents. ` +
            `Proceed with the next action (write_file, run_command, or done).`,
        };
      }

      // Gate 2: Read cap reached.
      if (state.filesRead.size >= state.profile.maxFileReads) {
        const readList = [...state.filesRead].join(", ");
        return {
          allowed: false,
          reason:  "read_cap_exceeded",
          forcedMessage:
            `ORCHESTRATOR: File read cap reached (${state.profile.maxFileReads} reads allowed for ${state.profile.category} tasks). ` +
            `Already read: ${readList || "(none)"}. ` +
            `No additional file reads are authorized. ` +
            `Write the fix based on what you have already inspected, or call done if the task is complete.`,
        };
      }

      return { allowed: true };
    }

    case "write_file": {
      // Gate 3: Write cap reached.
      if (state.filesWritten.size >= state.profile.maxFileWrites) {
        const writeList = [...state.filesWritten].join(", ");
        return {
          allowed: false,
          reason:  "write_cap_exceeded",
          forcedMessage:
            `ORCHESTRATOR: File write cap reached (${state.profile.maxFileWrites} writes allowed for ${state.profile.category} tasks). ` +
            `Already written: ${writeList || "(none)"}. ` +
            `Consolidate remaining changes into the files you have already modified, or call done.`,
        };
      }

      return { allowed: true };
    }

    case "done": {
      // Gate 4: Verification required before done.
      if (state.profile.requiresVerify && state.unverifiedWrites.size > 0) {
        const unverified = [...state.unverifiedWrites].join(", ");
        return {
          allowed: false,
          reason:  "verification_required",
          forcedMessage:
            `ORCHESTRATOR: Verification required before done. ` +
            `You wrote ${state.unverifiedWrites.size} file(s) with no verification step since: ${unverified}. ` +
            `Run a build/lint/type-check command (e.g. npx tsc --noEmit) OR read the file back to confirm the content is correct. ` +
            `Then call done.`,
        };
      }

      return { allowed: true };
    }

    default:
      return { allowed: true };
  }
}

// ─── State updater ────────────────────────────────────────────────────────────

/**
 * Update the run state after an action completes.
 * Must be called after every action (successful or not) to keep tracking correct.
 */
export function updateStateAfterAction(
  state:   RunState,
  action:  Record<string, unknown>,
  success: boolean,
): void {
  const actionType = String(action["action"] ?? "");

  // Update failure tracking
  state.lastActionType   = actionType;
  state.lastActionFailed = !success;

  if (!success) {
    state.consecutiveFailures++;
  } else {
    state.consecutiveFailures = 0;
  }

  // Update phase hints based on action type
  switch (actionType) {
    case "think": {
      // Extract phase from thought text to update RunPhase
      const thought = String(action["thought"] ?? "").toUpperCase();
      if (thought.includes("[REPAIRING]"))      state.phase = "repairing";
      else if (thought.includes("[VERIFYING]")) state.phase = "verifying";
      else if (thought.includes("[WRAPPING"))   state.phase = "wrapping_up";
      else if (thought.includes("[EDITING]"))   state.phase = "executing";
      else if (thought.includes("[PLANNING]"))  state.phase = "planning";
      break;
    }

    case "read_file": {
      if (success) {
        const path = String(action["path"] ?? "");
        if (path) state.filesRead.add(path);
      }
      break;
    }

    case "write_file": {
      if (success) {
        const path = String(action["path"] ?? "");
        if (path) {
          state.filesWritten.add(path);
          state.unverifiedWrites.add(path);
        }
      }
      break;
    }

    case "run_command": {
      const command = String(action["command"] ?? "");
      state.commandsRun.push(command);

      if (success) {
        // If this command is a shell-based file read that was ALLOWED (passed the gate),
        // track the path in filesRead so subsequent reads of the same file are blocked.
        const readPath = detectShellFileRead(command);
        if (readPath !== null) {
          const normalizedPath = readPath.replace(/^["']|["']$/g, "");
          if (normalizedPath) state.filesRead.add(normalizedPath);
        }

        // A successful command clears unverified writes (it IS the verification step)
        state.unverifiedWrites.clear();
        state.verificationsDone++;
        state.phase = "verifying";
      }
      break;
    }

    case "done": {
      state.phase = "complete";
      break;
    }
  }
}

// ─── Gate block counter ───────────────────────────────────────────────────────

/**
 * Increment the shell-reads-blocked counter. Called by agentLoop when a
 * shell read bypass is blocked, for operator-visible telemetry.
 */
export function recordShellReadBlocked(state: RunState): void {
  state.shellReadsBlocked++;
}
