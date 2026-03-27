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
  openFiles: OpenFile[];
  activeFilePath: string | null;
  terminalOutput: string[];
  activeTaskId: string | null;
  agentLogs: AgentLogEvent[];
  isConnected: boolean;

  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, newContent: string) => void;
  markFileClean: (path: string) => void;

  appendTerminalOutput: (data: string) => void;
  clearTerminal: () => void;

  setActiveTask: (taskId: string) => void;
  clearActiveTask: () => void;
  appendAgentLog: (event: Omit<AgentLogEvent, 'id'>) => void;
  clearAgentLogs: () => void;

  setConnected: (connected: boolean) => void;
}

let logIdCounter = 0;

export const useIdeStore = create<IdeState>((set) => ({
  openFiles: [],
  activeFilePath: null,
  terminalOutput: [],
  activeTaskId: null,
  agentLogs: [],
  isConnected: false,

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
    return {
      openFiles: [...state.openFiles, file],
      activeFilePath: file.path,
    };
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

  appendTerminalOutput: (data) => set((state) => ({
    terminalOutput: [...state.terminalOutput, data].slice(-500),
  })),

  clearTerminal: () => set({ terminalOutput: [] }),

  setActiveTask: (taskId) => set({ activeTaskId: taskId, agentLogs: [] }),

  clearActiveTask: () => set({ activeTaskId: null }),

  appendAgentLog: (event) => set((state) => ({
    agentLogs: [...state.agentLogs, { ...event, id: ++logIdCounter }],
  })),

  clearAgentLogs: () => set({ agentLogs: [] }),

  setConnected: (connected) => set({ isConnected: connected }),
}));
