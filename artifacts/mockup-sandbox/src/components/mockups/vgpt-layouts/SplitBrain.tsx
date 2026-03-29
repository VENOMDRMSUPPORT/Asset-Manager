import React from 'react';
import { 
  TerminalSquare, 
  FolderOpen, 
  Wifi, 
  RefreshCw, 
  ChevronRight, 
  ChevronDown, 
  FileIcon, 
  FolderIcon, 
  Zap, 
  Terminal as TerminalIcon, 
  CheckCircle2, 
  AlertTriangle, 
  Trash2, 
  Paperclip, 
  Send,
  X
} from 'lucide-react';

export function SplitBrain() {
  return (
    <div className="w-[1200px] h-[800px] bg-[#09090b] text-[#fafafa] font-sans overflow-hidden flex flex-col relative rounded-lg border border-zinc-800 shadow-2xl">
      {/* Grid container */}
      <div 
        className="w-full h-full grid"
        style={{
          gridTemplateColumns: '220px 1fr 380px',
          gridTemplateRows: '48px 1fr 1fr',
          gridTemplateAreas: `
            "header  header  header"
            "sidebar editor  editor"
            "feed    feed    composer"
          `
        }}
      >
        {/* TopBar */}
        <div style={{ gridArea: 'header' }} className="flex items-center justify-between px-4 border-b border-zinc-800 bg-[#09090b]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-zinc-100 font-semibold">
              <TerminalSquare className="w-5 h-5 text-violet-500" />
              VenomGPT
            </div>
            <div className="w-px h-5 bg-zinc-800" />
            <div className="flex items-center gap-2 text-zinc-400 text-sm">
              <FolderOpen className="w-4 h-4" />
              /home/runner/workspace
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-amber-500/10 text-amber-500 px-2.5 py-1 rounded-full text-xs font-medium border border-amber-500/20">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Agent Active
            </div>
            <div className="flex items-center gap-1.5 text-zinc-400 text-sm">
              <Wifi className="w-4 h-4" />
              Connected
            </div>
          </div>
        </div>

        {/* FileExplorer */}
        <div style={{ gridArea: 'sidebar' }} className="border-r border-violet-800/40 bg-[#18181b] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-800/50 text-xs font-semibold text-zinc-400 tracking-wider">
            <span>EXPLORER</span>
            <button className="hover:text-zinc-100 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2 text-sm text-zinc-300">
            <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-800/50 cursor-pointer">
              <ChevronRight className="w-4 h-4 text-zinc-500" />
              <FolderIcon className="w-4 h-4 text-zinc-400" />
              .agents
            </div>
            <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-800/50 cursor-pointer">
              <ChevronRight className="w-4 h-4 text-zinc-500" />
              <FolderIcon className="w-4 h-4 text-zinc-400" />
              .config
            </div>
            <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-800/50 cursor-pointer">
              <ChevronDown className="w-4 h-4 text-zinc-500" />
              <FolderIcon className="w-4 h-4 text-violet-400" />
              artifacts
            </div>
            <div className="pl-6">
              <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-800/50 cursor-pointer">
                <ChevronDown className="w-4 h-4 text-zinc-500" />
                <FolderIcon className="w-4 h-4 text-zinc-400" />
                api-server
              </div>
              <div className="pl-6">
                <div className="flex items-center gap-1 px-2 py-1 bg-violet-500/10 text-violet-200 border-l border-violet-500 cursor-pointer">
                  <FileIcon className="w-4 h-4 text-violet-400" />
                  agentLoop.ts
                </div>
                <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-800/50 cursor-pointer">
                  <FileIcon className="w-4 h-4 text-zinc-400" />
                  modelAdapter.ts
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-800/50 cursor-pointer">
              <ChevronRight className="w-4 h-4 text-zinc-500" />
              <FolderIcon className="w-4 h-4 text-zinc-400" />
              lib
            </div>
            <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-800/50 cursor-pointer mt-2">
              <div className="w-4" />
              <FileIcon className="w-4 h-4 text-zinc-500" />
              package.json
            </div>
            <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-800/50 cursor-pointer">
              <div className="w-4" />
              <FileIcon className="w-4 h-4 text-zinc-500" />
              .env.example
            </div>
          </div>
        </div>

        {/* CodeEditor */}
        <div style={{ gridArea: 'editor' }} className="bg-[#09090b] flex flex-col border-b-2 border-violet-800/40 relative">
          {/* Editor Tabs */}
          <div className="flex items-center h-10 border-b border-zinc-800/50 bg-[#09090b] overflow-x-auto">
            <div className="flex items-center gap-2 px-4 py-2 border-r border-zinc-800/50 bg-[#18181b] text-sm text-zinc-100 min-w-[140px] border-t-2 border-t-violet-500">
              <FileIcon className="w-4 h-4 text-violet-400" />
              agentLoop.ts
              <button className="ml-auto hover:bg-zinc-700 p-0.5 rounded-sm"><X className="w-3 h-3" /></button>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-r border-zinc-800/50 text-sm text-zinc-500 min-w-[140px] hover:bg-[#18181b]/50 cursor-pointer">
              <FileIcon className="w-4 h-4 text-zinc-500" />
              modelAdapter.ts
            </div>
          </div>
          
          {/* Editor Content */}
          <div className="flex-1 p-4 font-mono text-sm overflow-y-auto">
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">1</div>
              <div className="text-violet-400">import <span className="text-zinc-300">{'{'}</span> Logger <span className="text-zinc-300">{'}'}</span> from <span className="text-green-400">'./logger'</span><span className="text-zinc-300">;</span></div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">2</div>
              <div className="text-violet-400">import <span className="text-zinc-300">{'{'}</span> ModelAdapter <span className="text-zinc-300">{'}'}</span> from <span className="text-green-400">'./modelAdapter'</span><span className="text-zinc-300">;</span></div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">3</div>
              <div className="text-zinc-300"></div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">4</div>
              <div className="text-violet-400">export class <span className="text-yellow-200">AgentLoop</span> <span className="text-zinc-300">{'{'}</span></div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">5</div>
              <div className="text-zinc-300 pl-4"><span className="text-violet-400">private</span> logger: Logger;</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">6</div>
              <div className="text-zinc-300 pl-4"><span className="text-violet-400">private</span> model: ModelAdapter;</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">7</div>
              <div className="text-zinc-300"></div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">8</div>
              <div className="text-zinc-300 pl-4"><span className="text-violet-400">constructor</span>() {'{'}</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4 bg-zinc-800/30">9</div>
              <div className="text-zinc-300 pl-8 bg-zinc-800/30 w-full"><span className="text-violet-400">this</span>.logger = <span className="text-violet-400">new</span> <span className="text-yellow-200">Logger</span>(<span className="text-green-400">'AgentLoop'</span>);</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">10</div>
              <div className="text-zinc-300 pl-8"><span className="text-violet-400">this</span>.model = <span className="text-violet-400">new</span> <span className="text-yellow-200">ModelAdapter</span>();</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">11</div>
              <div className="text-zinc-300 pl-4">{'}'}</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">12</div>
              <div className="text-zinc-300"></div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">13</div>
              <div className="text-zinc-300 pl-4"><span className="text-violet-400">async</span> <span className="text-blue-400">runStep</span>(task: <span className="text-yellow-200">string</span>) {'{'}</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">14</div>
              <div className="text-zinc-300 pl-8"><span className="text-violet-400">this</span>.logger.<span className="text-blue-400">info</span>(<span className="text-green-400">{'`Starting task: ${task}`'}</span>);</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">15</div>
              <div className="text-zinc-500 pl-8 italic">// TODO: Implement execution loop</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">16</div>
              <div className="text-zinc-300 pl-4">{'}'}</div>
            </div>
            <div className="text-zinc-500 select-none flex">
              <div className="w-8 text-right pr-4 border-r border-zinc-800 mr-4">17</div>
              <div className="text-zinc-300">{'}'}</div>
            </div>
          </div>

          {/* AI Workspace Divider Label */}
          <div className="absolute -bottom-[11px] left-1/2 -translate-x-1/2 bg-[#09090b] px-4 text-[10px] font-bold tracking-widest text-zinc-500 border border-violet-800/40 rounded-full py-0.5 shadow-sm z-10">
            AI WORKSPACE
          </div>
        </div>

        {/* ExecutionFeed */}
        <div style={{ gridArea: 'feed' }} className="bg-[#09090b] border-r border-zinc-800 flex flex-col">
          <div className="h-10 border-b border-zinc-800 flex items-center justify-between px-4 bg-[#18181b]/50">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold tracking-wider text-zinc-300">EXECUTION FEED</span>
            </div>
            <div className="bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-400 cursor-pointer hover:bg-zinc-700 hover:text-zinc-200 transition-colors">
              TASK HISTORY (21)
            </div>
          </div>
          <div className="flex-1 p-4 overflow-y-auto font-mono text-[13px] leading-relaxed">
            <div className="mb-2">
              <span className="text-zinc-500">14:22:01</span>{' '}
              <span className="text-blue-400 font-semibold">[PLANNING]</span>{' '}
              <span className="text-zinc-300">Analyzing project structure...</span>
            </div>
            <div className="mb-2">
              <span className="text-zinc-500">14:22:03</span>{' '}
              <span className="text-violet-400 font-semibold">[INSPECTING]</span>{' '}
              <span className="text-zinc-300">Reading artifacts/api-server/src/lib/agentLoop.ts...</span>
            </div>
            <div className="mb-2 pl-4 text-zinc-400 border-l border-zinc-800 ml-[60px] py-1">
              Found AgentLoop class with incomplete runStep method.
            </div>
            <div className="mb-2">
              <span className="text-zinc-500">14:22:04</span>{' '}
              <span className="text-violet-400 font-semibold">[INSPECTING]</span>{' '}
              <span className="text-zinc-300">Reading artifacts/api-server/src/lib/modelAdapter.ts...</span>
            </div>
            <div className="mb-2">
              <span className="text-zinc-500">14:22:06</span>{' '}
              <span className="text-green-400 font-semibold">[EDITING]</span>{' '}
              <span className="text-zinc-300">Writing fix to modelAdapter.ts...</span>
            </div>
            <div className="mb-2 pl-4 text-green-500/80 border-l border-zinc-800 ml-[60px] py-1">
              + export class ModelAdapter {'{'} ... {'}'}
              <br/>
              + added generateResponse method
            </div>
            <div className="mb-2">
              <span className="text-zinc-500">14:22:08</span>{' '}
              <span className="text-amber-400 font-semibold">[THINKING]</span>{' '}
              <span className="text-zinc-300">Need to integrate ModelAdapter into AgentLoop...</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-zinc-500">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Agent is active and processing...
            </div>
          </div>
        </div>

        {/* Composer / Task Panel */}
        <div style={{ gridArea: 'composer' }} className="bg-[#18181b] flex flex-col">
          {/* Header */}
          <div className="h-14 border-b border-zinc-800 px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="font-semibold text-zinc-100 flex items-center gap-2">
                <TerminalSquare className="w-5 h-5 text-violet-500" />
                VenomGPT
              </div>
              <div className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                workspace
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Connected
            </div>
          </div>

          {/* Active Task */}
          <div className="p-4 border-b border-zinc-800/50 bg-amber-500/5">
            <div className="text-xs font-semibold text-amber-500 mb-2 flex justify-between">
              <span>ACTIVE TASK</span>
              <span>12.4s</span>
            </div>
            <div className="text-sm text-zinc-200 leading-snug">
              "Fix the AgentLoop implementation so it can correctly call the ModelAdapter and process the task queue."
            </div>
          </div>

          {/* Composer */}
          <div className="flex-1 p-4 flex flex-col">
            <div className="flex-1 bg-[#09090b] border border-zinc-800 rounded-lg shadow-inner flex flex-col overflow-hidden focus-within:border-violet-500/50 focus-within:ring-1 focus-within:ring-violet-500/50 transition-all">
              <textarea 
                className="flex-1 bg-transparent resize-none p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                placeholder="Describe what you want to build or fix. Paste or attach screenshots • ⌘/Ctrl+Enter to submit."
                defaultValue=""
              />
              <div className="p-2 border-t border-zinc-800/50 flex items-center justify-between bg-zinc-900/50">
                <button className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-800 transition-colors">
                  <Paperclip className="w-4 h-4" />
                </button>
                <button className="p-1.5 bg-violet-600 text-white rounded hover:bg-violet-500 transition-colors shadow-sm">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded border border-zinc-700/50 transition-colors">
                Cancel Task
              </button>
              <button className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded border border-zinc-700/50 transition-colors">
                View Changes
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
