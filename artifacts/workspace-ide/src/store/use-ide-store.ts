import { create } from 'zustand';

export interface OpenFile {
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
}

export interface AgentLogEvent {
  id: number;
  type: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

interface IdeState {
  // ── Editor ──────────────────────────────────────────────────────────────────
  openFiles: OpenFile[];
  activeFilePath: string | null;

  // ── Terminal ─────────────────────────────────────────────────────────────────
  terminalOutput: string[];

  // ── Task lifecycle ───────────────────────────────────────────────────────────
  //
  // activeTaskId  — the task that is CURRENTLY RUNNING.
  //                 Non-null only while the backend is executing a task.
  //                 Controls composer lock, "Agent is working…" banner, cancel button.
  //                 Cleared to null the moment the task finishes, errors, or is cancelled.
  //
  // viewingTaskId — the task whose logs are displayed in the output panel.
  //                 Follows activeTaskId while a task runs, but stays on the
  //                 last-run task after it completes so the user can read the
  //                 execution trace. Can also be set by clicking any history entry.
  //
  // taskLogs      — per-task event log. Indexed by taskId. Accumulated during the
  //                 task run and kept after completion so task history is viewable
  //                 without a re-fetch. Survives viewingTaskId changes.
  //
  activeTaskId: string | null;
  viewingTaskId: string | null;
  taskLogs: Record<string, AgentLogEvent[]>;

  // ── Connection ───────────────────────────────────────────────────────────────
  isConnected: boolean;

  // ── Editor actions ───────────────────────────────────────────────────────────
  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, newContent: string) => void;
  markFileClean: (path: string) => void;

  // ── Terminal actions ─────────────────────────────────────────────────────────
  appendTerminalOutput: (data: string) => void;
  clearTerminal: () => void;

  // ── Task actions ─────────────────────────────────────────────────────────────

  /**
   * Called when a new task submission is accepted by the backend.
   * Marks the task as actively running AND switches the output panel to it.
   * Initialises an empty log bucket for this task.
   */
  startActiveTask: (taskId: string) => void;

  /**
   * Called when the running task finishes (done / error / cancelled).
   * Clears the running lock so the composer unlocks.
   * Does NOT change viewingTaskId — user keeps seeing the finished task's logs.
   */
  clearActiveTask: () => void;

  /**
   * Called when the user clicks a task in history.
   * Switches the output panel to that task's log bucket.
   * Does NOT touch activeTaskId — composer lock is unaffected.
   */
  setViewingTask: (taskId: string) => void;

  /**
   * Append a log event to a specific task's log bucket.
   * taskId must be the currently-running task's ID (passed explicitly so the
   * WS handler doesn't need to close over stale state).
   */
  appendAgentLog: (taskId: string, event: Omit<AgentLogEvent, 'id'>) => void;

  /**
   * Clear the log bucket of the currently-viewed task.
   * Kept for the "Copy Logs" reset flow.
   */
  clearAgentLogs: () => void;

  setConnected: (connected: boolean) => void;
}

let logIdCounter = 0;

export const useIdeStore = create<IdeState>((set) => ({
  openFiles: [],
  activeFilePath: null,
  terminalOutput: [],
  activeTaskId: null,
  viewingTaskId: null,
  taskLogs: {},
  isConnected: false,

  // ── Editor ──────────────────────────────────────────────────────────────────

  openFile: (file) => set((state) => {
    const existing = state.openFiles.find(f => f.path === file.path);
    if (existing) {
      return {
        activeFilePath: file.path,
        openFiles: state.openFiles.map(f =>
          f.path === file.path ? { ...f, content: file.content, language: file.language } : f
        ),
      };
    }
    return { openFiles: [...state.openFiles, file], activeFilePath: file.path };
  }),

  closeFile: (path) => set((state) => {
    const newFiles = state.openFiles.filter(f => f.path !== path);
    let newActive = state.activeFilePath;
    if (newActive === path) {
      newActive = newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null;
    }
    return { openFiles: newFiles, activeFilePath: newActive };
  }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, newContent) => set((state) => ({
    openFiles: state.openFiles.map(f =>
      f.path === path ? { ...f, content: newContent, isDirty: true } : f
    ),
  })),

  markFileClean: (path) => set((state) => ({
    openFiles: state.openFiles.map(f =>
      f.path === path ? { ...f, isDirty: false } : f
    ),
  })),

  // ── Terminal ─────────────────────────────────────────────────────────────────

  appendTerminalOutput: (data) => set((state) => ({
    terminalOutput: [...state.terminalOutput, data].slice(-500),
  })),

  clearTerminal: () => set({ terminalOutput: [] }),

  // ── Task lifecycle ───────────────────────────────────────────────────────────

  startActiveTask: (taskId) => set((state) => ({
    activeTaskId: taskId,
    viewingTaskId: taskId,
    // Initialise a fresh log bucket; preserve all other task buckets
    taskLogs: { ...state.taskLogs, [taskId]: [] },
  })),

  clearActiveTask: () => set({ activeTaskId: null }),
  // viewingTaskId intentionally left unchanged so the output panel keeps
  // showing the just-completed task's execution trace.

  setViewingTask: (taskId) => set({ viewingTaskId: taskId }),

  appendAgentLog: (taskId, event) => set((state) => ({
    taskLogs: {
      ...state.taskLogs,
      [taskId]: [
        ...(state.taskLogs[taskId] ?? []),
        { ...event, id: ++logIdCounter },
      ],
    },
  })),

  clearAgentLogs: () => set((state) =>
    state.viewingTaskId
      ? { taskLogs: { ...state.taskLogs, [state.viewingTaskId]: [] } }
      : state
  ),

  setConnected: (connected) => set({ isConnected: connected }),
}));
