import React from "react";
import {
  TerminalSquare,
  FolderOpen,
  Wifi,
  Sparkles,
  Paperclip,
  ArrowUp,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Trash2,
  Folder,
  Search,
  GitBranch,
  FileCode2,
  X,
  Zap,
  Terminal as TerminalIcon,
} from "lucide-react";

export function AgentFirst() {
  return (
    <div
      className="w-[1200px] h-[800px] bg-[#09090b] text-[#fafafa] font-sans overflow-hidden border border-[#27272a] shadow-2xl rounded-lg"
      style={{
        display: "grid",
        gridTemplateColumns: "400px 56px 1fr",
        gridTemplateRows: "48px 1fr 180px",
        gridTemplateAreas: `
          "header header header"
          "taskbar nav editor"
          "taskbar terminal terminal"
        `,
      }}
    >
      {/* TopBar */}
      <div
        style={{ gridArea: "header" }}
        className="flex items-center justify-between px-4 bg-[#09090b] border-b border-[#27272a]"
      >
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-zinc-300">
            <TerminalSquare className="w-5 h-5 text-violet-500" />
            <span className="font-medium tracking-tight">VenomGPT</span>
          </div>
          <div className="w-px h-5 bg-[#27272a]"></div>
          <div className="flex items-center space-x-2 text-zinc-400 text-sm">
            <FolderOpen className="w-4 h-4" />
            <span>/home/runner/workspace</span>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-sm">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20 text-xs font-medium">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
            <span>Agent Active</span>
          </div>
          <div className="flex items-center space-x-1.5 text-zinc-400">
            <Wifi className="w-4 h-4 text-green-500" />
            <span>Connected</span>
          </div>
        </div>
      </div>

      {/* TaskPanel (taskbar) */}
      <div
        style={{ gridArea: "taskbar" }}
        className="flex flex-col bg-[#18181b] border-r-[4px] border-[#09090b] overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a] shrink-0">
          <div className="flex items-center space-x-3">
            <span className="font-semibold text-zinc-100">VenomGPT</span>
            <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 text-xs font-medium border border-zinc-700">
              workspace
            </span>
          </div>
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
        </div>

        {/* Composer at Top */}
        <div className="p-4 border-b border-[#27272a] bg-[#18181b] shrink-0 flex flex-col space-y-3">
          <div className="flex items-center space-x-2 text-violet-400 text-xs font-bold tracking-wider uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>New Task</span>
          </div>
          <div className="relative bg-[#09090b] border border-[#27272a] rounded-xl focus-within:border-violet-500/50 focus-within:ring-1 focus-within:ring-violet-500/50 transition-all">
            <textarea
              className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 p-3 pb-12 resize-none outline-none min-h-[100px]"
              placeholder="Describe what you want to build or fix. Paste or attach screenshots • ⌘/Ctrl+Enter to submit."
            ></textarea>
            <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
              <button className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors">
                <Paperclip className="w-4 h-4" />
              </button>
              <button className="p-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-md shadow-sm transition-colors flex items-center justify-center">
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Task History */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Task History
            </span>
            <span className="bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded text-[10px] font-bold">
              12
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {/* Task 1 */}
            <div className="group flex flex-col p-2.5 rounded-lg hover:bg-zinc-800/50 cursor-pointer border border-transparent hover:border-zinc-800 transition-colors">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 leading-snug line-clamp-2">
                    Fix the CSS spacing in this screenshot.
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0 opacity-0 group-hover:opacity-100" />
              </div>
              <div className="flex items-center justify-between mt-2 pl-6">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">8.8s</span>
                  <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                    Error
                  </span>
                </div>
                <button className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Task 2 */}
            <div className="group flex flex-col p-2.5 rounded-lg hover:bg-zinc-800/50 cursor-pointer border border-transparent hover:border-zinc-800 transition-colors">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 leading-snug line-clamp-2">
                    list the files in the artifacts/api-server/src/routes directory
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0 opacity-0 group-hover:opacity-100" />
              </div>
              <div className="flex items-center justify-between mt-2 pl-6">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">9.0s</span>
                  <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                    Done
                  </span>
                </div>
                <button className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Task 3 */}
            <div className="group flex flex-col p-2.5 rounded-lg hover:bg-zinc-800/50 cursor-pointer border border-transparent hover:border-zinc-800 transition-colors">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 leading-snug line-clamp-2">
                    list what files exist in the artifacts/api-server/src/lib directory
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0 opacity-0 group-hover:opacity-100" />
              </div>
              <div className="flex items-center justify-between mt-2 pl-6">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">6.7s</span>
                  <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                    Done
                  </span>
                </div>
                <button className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Icon-only sidebar (nav) */}
      <div
        style={{ gridArea: "nav" }}
        className="bg-[#18181b] border-r border-[#27272a] flex flex-col items-center py-4 space-y-6"
      >
        <button className="p-2 text-violet-500 border-l-2 border-violet-500 -ml-[2px] w-[56px] flex justify-center">
          <Folder className="w-6 h-6" />
        </button>
        <button className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors">
          <Search className="w-6 h-6" />
        </button>
        <button className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors">
          <GitBranch className="w-6 h-6" />
        </button>
      </div>

      {/* CodeEditor (editor) */}
      <div
        style={{ gridArea: "editor" }}
        className="bg-[#09090b] flex flex-col overflow-hidden"
      >
        {/* Editor Tabs */}
        <div className="flex items-center bg-[#18181b] overflow-x-auto border-b border-[#27272a] shrink-0">
          <div className="flex items-center px-4 py-2 space-x-2 bg-[#09090b] border-r border-[#27272a] border-t-2 border-t-violet-500 group cursor-pointer min-w-fit">
            <FileCode2 className="w-4 h-4 text-violet-400" />
            <span className="text-sm text-zinc-200">AgentFirst.tsx</span>
            <X className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300 ml-2" />
          </div>
        </div>

        {/* Editor Content */}
        <div className="flex-1 p-4 font-mono text-sm text-zinc-300 overflow-y-auto">
          <div className="flex">
            <div className="w-8 text-right pr-4 text-zinc-600 select-none">
              1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />9<br />10
            </div>
            <div>
              <span className="text-violet-400">import</span> React{" "}
              <span className="text-violet-400">from</span>{" "}
              <span className="text-green-400">"react"</span>;
              <br />
              <br />
              <span className="text-violet-400">export function</span>{" "}
              <span className="text-blue-400">AgentFirst</span>() {"{"}
              <br />
              &nbsp;&nbsp;<span className="text-violet-400">return</span> (
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;&lt;<span className="text-blue-400">div</span>{" "}
              <span className="text-sky-300">className</span>=
              <span className="text-green-400">"w-[1200px] h-[800px]"</span>&gt;
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{"{/* Code goes here */}"}
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;&lt;/<span className="text-blue-400">div</span>&gt;
              <br />
              &nbsp;&nbsp;);
              <br />
              {"}"}
            </div>
          </div>
        </div>
      </div>

      {/* OutputPanel (terminal) */}
      <div
        style={{ gridArea: "terminal" }}
        className="bg-[#18181b] border-t border-[#27272a] border-l border-[#27272a] flex flex-col overflow-hidden"
      >
        <div className="flex items-center px-2 bg-[#18181b] border-b border-[#27272a] shrink-0">
          <button className="flex items-center space-x-2 px-4 py-2 border-b-2 border-violet-500 text-zinc-200">
            <Zap className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium">Execution Feed</span>
          </button>
          <button className="flex items-center space-x-2 px-4 py-2 text-zinc-500 hover:text-zinc-300 transition-colors">
            <TerminalIcon className="w-4 h-4" />
            <span className="text-sm font-medium">Terminal</span>
          </button>
        </div>
        <div className="flex-1 p-3 font-mono text-sm overflow-y-auto bg-[#09090b]">
          <div className="text-blue-400 mb-1">
            <span className="text-zinc-500">[10:42:01]</span> [PLANNING] Analyzing task
            requirements...
          </div>
          <div className="text-zinc-300 mb-1">
            <span className="text-zinc-500">[10:42:02]</span> [READ] Reading artifacts/api-server/src/routes...
          </div>
          <div className="text-green-400 mb-1">
            <span className="text-zinc-500">[10:42:04]</span> [SUCCESS] Identified 5 route files.
          </div>
          <div className="text-amber-400 mb-1">
            <span className="text-zinc-500">[10:42:05]</span> [EDITING] Modifying artifacts/api-server/src/routes/agent.ts...
          </div>
          <div className="text-zinc-300 flex items-center gap-2">
            <span className="text-zinc-500">[10:42:06]</span> <div className="w-2 h-4 bg-zinc-400 animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
