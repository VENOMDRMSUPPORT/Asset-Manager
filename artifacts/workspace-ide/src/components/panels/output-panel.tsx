import { useState, useRef, useEffect } from 'react';
import { useIdeStore } from '@/store/use-ide-store';
import { Terminal, Activity, CheckCircle2, AlertCircle, PlayCircle, Eye, FileEdit, Settings, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

type TabType = 'agent' | 'terminal';

export function OutputPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('agent');
  const { agentLogs, terminalOutput, clearTerminal } = useIdeStore();
  
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const agentEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'terminal') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      agentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalOutput.length, agentLogs.length, activeTab]);

  return (
    <div className="bg-panel border-r border-panel-border flex flex-col" style={{ gridArea: 'terminal' }}>
      {/* Tabs Header */}
      <div className="h-10 border-b border-panel-border flex items-center justify-between px-2 shrink-0 bg-background/50">
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setActiveTab('agent')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-2 transition-colors
              ${activeTab === 'agent' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-panel'}`}
          >
            <Activity className="w-3.5 h-3.5" />
            Agent Activity
            {agentLogs.length > 0 && activeTab !== 'agent' && (
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            )}
          </button>
          <button 
            onClick={() => setActiveTab('terminal')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-2 transition-colors
              ${activeTab === 'terminal' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-panel'}`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Terminal
          </button>
        </div>
        
        {activeTab === 'terminal' && (
          <button onClick={clearTerminal} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-panel transition-colors" title="Clear Terminal">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto bg-[#0a0a0c] p-4 font-mono text-sm hide-scrollbar relative">
        {activeTab === 'agent' && (
          <div className="space-y-4">
            {agentLogs.length === 0 ? (
              <div className="text-muted-foreground text-center mt-10">No active task running</div>
            ) : (
              agentLogs.map((log, i) => (
                <AgentLogItem key={i} log={log} />
              ))
            )}
            <div ref={agentEndRef} />
          </div>
        )}

        {activeTab === 'terminal' && (
          <div className="text-gray-300 whitespace-pre-wrap">
            {terminalOutput.length === 0 ? (
              <span className="text-muted-foreground">Terminal is ready...</span>
            ) : (
              terminalOutput.map((line, i) => (
                <div key={i} className="leading-relaxed">{line}</div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function AgentLogItem({ log }: { log: any }) {
  const getIconAndColor = (type: string) => {
    switch (type) {
      case 'status': return { icon: PlayCircle, color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' };
      case 'thought': return { icon: Settings, color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' };
      case 'file_read': return { icon: Eye, color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20' };
      case 'file_write': return { icon: FileEdit, color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' };
      case 'command': return { icon: Terminal, color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' };
      case 'error': return { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' };
      case 'done': return { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' };
      default: return { icon: Activity, color: 'text-gray-400', bg: 'bg-gray-400/10', border: 'border-gray-400/20' };
    }
  };

  const { icon: Icon, color, bg, border } = getIconAndColor(log.type);

  return (
    <div className={`flex gap-3 p-3 rounded-lg border ${bg} ${border} animate-in slide-in-from-left-2 duration-300`}>
      <div className="mt-0.5">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className={`font-semibold uppercase tracking-wider text-xs ${color}`}>{log.type.replace('_', ' ')}</span>
          <span className="text-xs text-muted-foreground">
            {format(new Date(log.timestamp), 'HH:mm:ss')}
          </span>
        </div>
        <p className="text-gray-200 text-sm whitespace-pre-wrap">{log.message}</p>
        
        {log.data && (
          <div className="mt-2 p-2 bg-black/40 rounded border border-white/5 overflow-x-auto">
            <pre className="text-xs text-gray-400">
              {JSON.stringify(log.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
