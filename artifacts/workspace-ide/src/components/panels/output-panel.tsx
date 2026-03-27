import { useState, useRef, useEffect } from 'react';
import { useIdeStore } from '@/store/use-ide-store';
import {
  Terminal, Activity, CheckCircle2, AlertCircle, PlayCircle,
  Eye, FileEdit, Settings, Trash2, FileCheck, GitBranch, ShieldAlert, Zap,
} from 'lucide-react';
import { format } from 'date-fns';

type TabType = 'agent' | 'terminal';

interface CompletionData {
  summary?: string;
  changed_files?: string[];
  commands_run?: string[];
  final_status?: string;
  remaining?: string;
}

interface FailureData {
  title?: string;
  detail?: string;
  step?: string;
  category?: string;
}

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

  const doneLog = agentLogs.findLast(l => l.type === 'done');
  const completionData: CompletionData | null = doneLog?.data ?? null;

  // Find the last error event that has structured failure detail (category field)
  const lastErrorLog = agentLogs.findLast(l => l.type === 'error' && l.data?.category);
  const failureData: FailureData | null = (!doneLog && lastErrorLog?.data) ? lastErrorLog.data as FailureData : null;

  const commandCount = agentLogs.filter(l => l.type === 'command').length;

  return (
    <div className="bg-panel border-r border-panel-border flex flex-col" style={{ gridArea: 'terminal' }}>
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
            {commandCount > 0 && (
              <span className="text-xs text-muted-foreground bg-panel-border rounded px-1">{commandCount}</span>
            )}
          </button>
        </div>

        {activeTab === 'terminal' && (
          <button
            onClick={clearTerminal}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-panel transition-colors"
            title="Clear Terminal"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto bg-[#0a0a0c] p-4 font-mono text-sm relative">
        {activeTab === 'agent' && (
          <div className="space-y-3">
            {agentLogs.length === 0 ? (
              <div className="text-muted-foreground text-center mt-10 text-sm">
                No active task. Submit a task in the AI panel to see live activity here.
              </div>
            ) : (
              agentLogs.map((log) => (
                <AgentLogItem key={log.id} log={log} />
              ))
            )}

            {failureData && (
              <FailureCard data={failureData} />
            )}

            {completionData && !failureData && (
              <CompletionCard data={completionData} />
            )}

            <div ref={agentEndRef} />
          </div>
        )}

        {activeTab === 'terminal' && (
          <div className="text-gray-300 whitespace-pre-wrap break-words">
            {commandCount === 0 && agentLogs.length > 0 ? (
              <span className="text-muted-foreground">No commands were executed during this task.</span>
            ) : terminalOutput.length === 0 ? (
              <span className="text-muted-foreground">Terminal output will appear here when the agent runs commands.</span>
            ) : (
              terminalOutput.map((chunk, i) => (
                <span key={i}>{chunk}</span>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function AgentLogItem({ log }: { log: { type: string; message: string; timestamp: string; data?: Record<string, unknown> } }) {
  const getStyle = (type: string) => {
    switch (type) {
      case 'status':      return { icon: PlayCircle,   color: 'text-blue-400',    bg: 'bg-blue-400/10',    border: 'border-blue-400/20' };
      case 'thought':     return { icon: Settings,     color: 'text-amber-400',   bg: 'bg-amber-400/10',   border: 'border-amber-400/20' };
      case 'file_read':   return { icon: Eye,          color: 'text-purple-400',  bg: 'bg-purple-400/10',  border: 'border-purple-400/20' };
      case 'file_write':  return { icon: FileEdit,     color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' };
      case 'command':     return { icon: Terminal,     color: 'text-cyan-400',    bg: 'bg-cyan-400/10',    border: 'border-cyan-400/20' };
      case 'command_output': return { icon: Terminal,  color: 'text-gray-400',    bg: 'bg-gray-400/5',     border: 'border-gray-400/10' };
      case 'error':       return { icon: AlertCircle,  color: 'text-red-400',     bg: 'bg-red-400/10',     border: 'border-red-400/20' };
      case 'done':        return { icon: CheckCircle2, color: 'text-green-500',   bg: 'bg-green-500/10',   border: 'border-green-500/20' };
      default:            return { icon: Activity,     color: 'text-gray-400',    bg: 'bg-gray-400/10',    border: 'border-gray-400/20' };
    }
  };

  const { icon: Icon, color, bg, border } = getStyle(log.type);

  // The done event is rendered as CompletionCard below the list
  if (log.type === 'done') {
    return null;
  }

  return (
    <div className={`flex gap-3 p-3 rounded-lg border ${bg} ${border}`}>
      <div className="mt-0.5 shrink-0">
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5 gap-2">
          <span className={`font-semibold uppercase tracking-wider text-xs ${color}`}>
            {log.type.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {format(new Date(log.timestamp), 'HH:mm:ss')}
          </span>
        </div>
        <p className="text-gray-200 text-sm whitespace-pre-wrap break-words">{log.message}</p>
      </div>
    </div>
  );
}

function FailureCard({ data }: { data: FailureData }) {
  const categoryLabel: Record<string, string> = {
    model: 'AI Provider',
    missing_api_key: 'Missing API Key',
    invalid_api_key: 'Invalid API Key',
    model_not_found: 'Model Not Found',
    insufficient_balance: 'Insufficient Balance',
    rate_limit: 'Rate Limited',
    network_error: 'Network Error',
    base_url_error: 'Bad Base URL',
    context_length: 'Context Too Long',
    tool: 'Tool Execution',
    command: 'Command Execution',
    workspace: 'Workspace',
    orchestration: 'Internal Orchestration',
    cancelled: 'Cancelled',
  };

  const categoryIcon: Record<string, React.ReactNode> = {
    model: <Zap className="w-4 h-4 text-red-400" />,
    workspace: <ShieldAlert className="w-4 h-4 text-red-400" />,
    cancelled: <AlertCircle className="w-4 h-4 text-amber-400" />,
  };

  const icon = categoryIcon[data.category ?? ''] ?? <AlertCircle className="w-4 h-4 text-red-400" />;
  const isCancelled = data.category === 'cancelled';

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${isCancelled ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className={`font-semibold text-sm ${isCancelled ? 'text-amber-400' : 'text-red-400'}`}>
          {isCancelled ? 'Cancelled' : 'Task Failed'}
        </span>
        {data.category && (
          <span className="ml-auto text-xs text-muted-foreground bg-panel-border px-2 py-0.5 rounded-full">
            {categoryLabel[data.category] ?? data.category}
          </span>
        )}
      </div>

      {data.title && (
        <p className="text-sm text-gray-100 font-medium leading-snug">{data.title}</p>
      )}

      {data.detail && (
        <pre className={`text-xs whitespace-pre-wrap break-words rounded-lg px-3 py-2 font-mono leading-relaxed ${isCancelled ? 'text-amber-300 bg-amber-400/10 border border-amber-400/20' : 'text-red-300 bg-red-400/10 border border-red-400/20'}`}>
          {data.detail}
        </pre>
      )}

      {data.step && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">Failed at step:</span> <code className="font-mono">{data.step}</code>
        </p>
      )}
    </div>
  );
}

function CompletionCard({ data }: { data: CompletionData }) {
  const statusColor = {
    complete: 'border-green-500/30 bg-green-500/5',
    partial:  'border-amber-500/30 bg-amber-500/5',
    blocked:  'border-red-500/30 bg-red-500/5',
  }[data.final_status ?? 'complete'] ?? 'border-green-500/30 bg-green-500/5';

  const statusLabel = {
    complete: 'Completed',
    partial:  'Partially Completed',
    blocked:  'Blocked',
  }[data.final_status ?? 'complete'] ?? 'Done';

  const statusIcon = {
    complete: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    partial:  <AlertCircle className="w-4 h-4 text-amber-500" />,
    blocked:  <AlertCircle className="w-4 h-4 text-red-500" />,
  }[data.final_status ?? 'complete'];

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${statusColor}`}>
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className="font-semibold text-sm text-foreground">{statusLabel}</span>
      </div>

      {data.summary && (
        <p className="text-sm text-gray-200 leading-relaxed">{data.summary}</p>
      )}

      {data.changed_files && data.changed_files.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <FileCheck className="w-3.5 h-3.5" />
            Files Changed ({data.changed_files.length})
          </p>
          <ul className="space-y-0.5">
            {data.changed_files.map((f, i) => (
              <li key={i} className="text-xs font-mono text-emerald-400 bg-emerald-400/5 px-2 py-0.5 rounded">{f}</li>
            ))}
          </ul>
        </div>
      )}

      {data.commands_run && data.commands_run.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            Commands Run ({data.commands_run.length})
          </p>
          <ul className="space-y-0.5">
            {data.commands_run.map((c, i) => (
              <li key={i} className="text-xs font-mono text-cyan-400 bg-cyan-400/5 px-2 py-0.5 rounded">{c}</li>
            ))}
          </ul>
        </div>
      )}

      {data.remaining && (
        <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          <span className="font-semibold">Remaining: </span>{data.remaining}
        </div>
      )}
    </div>
  );
}
