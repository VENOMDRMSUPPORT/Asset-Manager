import { create } from 'zustand';

export interface OpenFile {
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
}

export interface AgentLogEvent {
  type: string;
  message: string;
  timestamp: string;
  data?: any;
}

interface IdeState {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  terminalOutput: string[];
  activeTaskId: string | null;
  agentLogs: AgentLogEvent[];

  // Actions
  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, newContent: string) => void;
  markFileClean: (path: string) => void;
  
  appendTerminalOutput: (data: string) => void;
  clearTerminal: () => void;
  
  setActiveTask: (taskId: string) => void;
  appendAgentLog: (event: AgentLogEvent) => void;
  clearAgentLogs: () => void;
}

export const useIdeStore = create<IdeState>((set) => ({
  openFiles: [],
  activeFilePath: null,
  terminalOutput: [],
  activeTaskId: null,
  agentLogs: [],

  openFile: (file) => set((state) => {
    const exists = state.openFiles.find(f => f.path === file.path);
    if (exists) {
      return { activeFilePath: file.path };
    }
    return {
      openFiles: [...state.openFiles, file],
      activeFilePath: file.path
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
    )
  })),

  markFileClean: (path) => set((state) => ({
    openFiles: state.openFiles.map(f => 
      f.path === path ? { ...f, isDirty: false } : f
    )
  })),

  appendTerminalOutput: (data) => set((state) => ({
    // Keep last 1000 lines to prevent memory bloat
    terminalOutput: [...state.terminalOutput, data].slice(-1000)
  })),

  clearTerminal: () => set({ terminalOutput: [] }),

  setActiveTask: (taskId) => set({ activeTaskId: taskId, agentLogs: [] }),

  appendAgentLog: (event) => set((state) => ({
    agentLogs: [...state.agentLogs, event]
  })),

  clearAgentLogs: () => set({ agentLogs: [] })
}));
