import React from 'react';
import { 
  TerminalSquare, 
  FolderOpen, 
  Wifi, 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FileText, 
  FileJson, 
  FileCode, 
  CircleDot, 
  Check, 
  AlertTriangle, 
  Trash2, 
  Paperclip, 
  Send,
  X,
  Zap,
  Terminal,
  File
} from 'lucide-react';

export function CommandCenter() {
  return (
    <div 
      className="w-[1200px] h-[800px] overflow-hidden bg-[#09090b] text-zinc-300 font-sans flex flex-col border border-zinc-800 rounded-md shadow-2xl relative"
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gridTemplateRows: '48px 1fr 300px',
        gridTemplateAreas: `
          "header header"
          "sidebar editor"
          "taskstrip taskstrip"
        `
      }}
    >
      {/* TopBar */}
      <header 
        style={{ gridArea: 'header' }} 
        className="flex items-center justify-between px-4 border-b border-zinc-800 bg-[#09090b]"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-zinc-100">
            <TerminalSquare className="w-5 h-5 text-violet-500" />
            <span className="font-semibold text-sm">VenomGPT</span>
          </div>
          <div className="w-[1px] h-4 bg-zinc-800"></div>
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <FolderOpen className="w-4 h-4" />
            <span>/home/runner/workspace</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Agent Active
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Wifi className="w-4 h-4 text-green-500" />
            Connected
          </div>
        </div>
      </header>

      {/* FileExplorer (Sidebar) */}
      <aside 
        style={{ gridArea: 'sidebar' }} 
        className="border-r border-zinc-800 bg-[#09090b] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-zinc-500 tracking-wider">
          EXPLORER
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {/* Tree */}
          <div className="px-2">
            <TreeFolder name=".agents" />
            <TreeFolder name=".config" />
            <TreeFolder name=".local" />
            <TreeFolder name="artifacts" defaultOpen>
              <TreeFolder name="api-server" />
              <TreeFolder name="mockup-sandbox" defaultOpen>
                <TreeFolder name="src" defaultOpen>
                  <TreeFolder name="components" defaultOpen>
                    <TreeFile name="Button.tsx" icon={FileCode} />
                    <TreeFile name="CommandCenter.tsx" icon={FileCode} active />
                  </TreeFolder>
                  <TreeFile name="App.tsx" icon={FileCode} />
                </TreeFolder>
                <TreeFile name="package.json" icon={FileJson} />
              </TreeFolder>
            </TreeFolder>
            <TreeFolder name="lib" />
            <TreeFolder name="utils" />
            <TreeFile name=".env.example" icon={FileText} />
            <TreeFile name=".gitignore" icon={File} />
            <TreeFile name="package.json" icon={FileJson} />
          </div>
        </div>
      </aside>

      {/* CodeEditor */}
      <main 
        style={{ gridArea: 'editor' }} 
        className="bg-[#09090b] flex flex-col min-w-0 overflow-hidden"
      >
        <div className="flex overflow-x-auto bg-[#09090b] border-b border-zinc-800">
          <div className="flex items-center gap-2 px-4 py-2 border-r border-zinc-800 bg-[#18181b] text-zinc-200 text-sm min-w-fit cursor-pointer border-t-2 border-t-violet-500 relative -mb-[1px]">
            <FileCode className="w-4 h-4 text-zinc-400" />
            CommandCenter.tsx
            <X className="w-3.5 h-3.5 ml-2 text-zinc-500 hover:text-zinc-300" />
          </div>
          <div className="flex items-center gap-2 px-4 py-2 border-r border-zinc-800 text-zinc-500 text-sm min-w-fit hover:bg-zinc-800/50 cursor-pointer">
            <FileCode className="w-4 h-4" />
            Button.tsx
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-[#09090b] p-4 font-mono text-sm leading-relaxed text-zinc-300">
          <div className="flex">
            <div className="text-zinc-700 pr-4 text-right select-none flex flex-col">
              <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
            </div>
            <div className="flex-1 whitespace-pre">
              <span className="text-violet-400">import</span> <span className="text-zinc-300">React</span> <span className="text-violet-400">from</span> <span className="text-green-300">'react'</span>;<br/>
              <span className="text-violet-400">import</span> <span className="text-zinc-300">{`{ TerminalSquare, FolderOpen }`}</span> <span className="text-violet-400">from</span> <span className="text-green-300">'lucide-react'</span>;<br/>
              <br/>
              <span className="text-violet-400">export</span> <span className="text-violet-400">function</span> <span className="text-blue-400">CommandCenter</span>() {`{`}<br/>
              <span className="text-zinc-300">  </span><span className="text-violet-400">return</span> (<br/>
              <span className="text-zinc-300">    &lt;</span><span className="text-blue-400">div</span> <span className="text-orange-300">className</span>=<span className="text-green-300">"w-[1200px] h-[800px] grid"</span>&gt;<br/>
              <span className="text-zinc-300">      {`{/* Bottom dock for AI interactions */}`}</span><br/>
              <span className="text-zinc-300">    &lt;/</span><span className="text-blue-400">div</span>&gt;<br/>
              <span className="text-zinc-300">  );</span><br/>
              {`}`}
            </div>
          </div>
        </div>
      </main>

      {/* TaskStrip (Bottom Dock) */}
      <footer 
        style={{ gridArea: 'taskstrip' }} 
        className="border-t border-zinc-800 bg-[#18181b] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center px-4 py-2 border-b border-zinc-800/50 gap-4 text-sm bg-zinc-900">
          <div className="flex items-center gap-2 text-zinc-200 font-medium">
            <TerminalSquare className="w-4 h-4 text-violet-500" />
            VenomGPT
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800 text-xs text-zinc-300 border border-zinc-700">
            workspace
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Connected
          </div>

          <div className="w-[1px] h-4 bg-zinc-700 ml-2"></div>

          {/* Tabs inside Header */}
          <div className="flex items-center gap-1 ml-2">
            <button className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm">
              <CircleDot className="w-3.5 h-3.5 text-violet-400" />
              Task History (21)
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors">
              <Zap className="w-3.5 h-3.5" />
              Execution Feed
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Left Half: Task History */}
          <div className="w-[55%] flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {/* Task Row 1 */}
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-zinc-800/50 group text-sm cursor-pointer border border-transparent hover:border-zinc-800">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <div className="flex-1 truncate text-zinc-200">
                  Fix the CSS spacing in this screenshot.
                </div>
                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button className="text-zinc-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="text-xs text-zinc-500 flex-shrink-0 w-12 text-right">8.8s</div>
                <div className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-wider">
                  Error
                </div>
              </div>
              
              {/* Task Row 2 */}
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-zinc-800/30 border border-zinc-800/50 group text-sm cursor-pointer">
                <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                <div className="flex-1 truncate text-zinc-300">
                  list the files in the artifacts/api-server/src/routes directory
                </div>
                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button className="text-zinc-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="text-xs text-zinc-500 flex-shrink-0 w-12 text-right">9.0s</div>
                <div className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 uppercase tracking-wider">
                  Done
                </div>
              </div>

              {/* Task Row 3 */}
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-zinc-800/50 group text-sm cursor-pointer border border-transparent hover:border-zinc-800">
                <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                <div className="flex-1 truncate text-zinc-400">
                  list what files exist in the artifacts/api-server/src/lib directory
                </div>
                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button className="text-zinc-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="text-xs text-zinc-500 flex-shrink-0 w-12 text-right">6.7s</div>
                <div className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 uppercase tracking-wider">
                  Done
                </div>
              </div>
            </div>
          </div>

          <div className="w-[1px] bg-zinc-800/80"></div>

          {/* Right Half: Composer */}
          <div className="flex-1 flex flex-col p-4 bg-zinc-900/50">
            <div className="text-xs font-semibold text-zinc-500 tracking-wider mb-2">TASK</div>
            <div className="flex-1 flex flex-col bg-[#09090b] border border-zinc-700 rounded-lg shadow-inner focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500 transition-all overflow-hidden">
              <textarea 
                className="flex-1 bg-transparent w-full resize-none p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                placeholder="Describe what you want to build or fix. Paste or attach screenshots • ⌘/Ctrl+Enter to submit."
              />
              <div className="flex items-center justify-between p-2 border-t border-zinc-800/50 bg-[#18181b]/50">
                <button className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors">
                  <Paperclip className="w-4 h-4" />
                </button>
                <button className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors shadow-sm">
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Sidebar Helpers
function TreeFolder({ name, defaultOpen = false, children }: { name: string, defaultOpen?: boolean, children?: React.ReactNode }) {
  const [isOpen] = React.useState(defaultOpen);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800/50 rounded cursor-pointer group">
        <ChevronRight className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        <Folder className="w-4 h-4 text-blue-400" />
        <span className="truncate group-hover:text-zinc-100">{name}</span>
      </div>
      {isOpen && children && (
        <div className="ml-3 pl-2 border-l border-zinc-800/50 flex flex-col">
          {children}
        </div>
      )}
    </div>
  );
}

function TreeFile({ name, icon: Icon, active = false }: { name: string, icon: any, active?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-2 py-1 text-sm rounded cursor-pointer ml-[18px] group ${active ? 'bg-violet-500/10 text-violet-400' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}>
      <Icon className={`w-4 h-4 ${active ? 'text-violet-400' : 'text-zinc-500 group-hover:text-zinc-400'}`} />
      <span className="truncate">{name}</span>
    </div>
  );
}
