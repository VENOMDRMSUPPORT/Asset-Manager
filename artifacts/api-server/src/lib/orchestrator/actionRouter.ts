/**
 * orchestrator/actionRouter.ts — Action gating and execution discipline.
 *
 * The action router sits between "model produces an action" and "action executes".
 * It enforces per-profile caps and execution discipline without the model knowing
 * the specific limits — violations produce a forced correction message injected
 * into the conversation rather than a hard error.
 *
 * Gates checked (in order):
 *   1. Read cap      — blocks read_file once profile.maxFileReads is reached
 *   2. Redundant read — blocks re-reading a file already in the read set
 *   3. Write cap     — blocks write_file once profile.maxFileWrites is reached
 *   4. Verification  — blocks done when unverified writes exist (if profile.requiresVerify)
 */

import type { RunState } from "./types.js";

// ─── Gate result ──────────────────────────────────────────────────────────────

export type GateResult =
  | { allowed: true }
  | { allowed: false; reason: GateRejectionReason; forcedMessage: string };

export type GateRejectionReason =
  | "redundant_read"
  | "read_cap_exceeded"
  | "write_cap_exceeded"
  | "verification_required";

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
            `ORCHESTRATOR: File read cap reached (${state.profile.maxFileReads} for ${state.profile.category} tasks). ` +
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
            `ORCHESTRATOR: File write cap reached (${state.profile.maxFileWrites} for ${state.profile.category} tasks). ` +
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
