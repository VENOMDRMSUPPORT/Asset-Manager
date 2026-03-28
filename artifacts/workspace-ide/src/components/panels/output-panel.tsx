import { useState, useRef, useEffect, useCallback } from 'react';
import { useIdeStore, AgentLogEvent } from '@/store/use-ide-store';
import {
  Terminal, Activity, CheckCircle2, AlertCircle, PlayCircle,
  Eye, FileEdit, Settings, Trash2, FileCheck, GitBranch,
  ShieldAlert, Zap, Copy, Check, ChevronRight, Search,
  Wrench, Loader2,
} from 'lucide-react';
import { format } from 'date-fns';

// Stable empty array — prevents Zustand infinite re-render via reference equality
const EMPTY_LOGS: AgentLogEvent[] = [];

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

// ─── Stage parsing ────────────────────────────────────────────────────────────

const STAGE_TAGS = ['PLANNING', 'INSPECTING', 'EDITING', 'VERIFYING', 'REPAIRING', 'WRAPPING UP'] as const;
type StageTag = typeof STAGE_TAGS[number];

interface ParsedThought {
  stage: StageTag | null;
  body: string;
}

function parseThought(message: string): ParsedThought {
  const match = message.match(/^\[(PLANNING|INSPECTING|EDITING|VERIFYING|REPAIRING|WRAPPING UP)\]\s*/i);
  if (match) {
    return {
      stage: match[1].toUpperCase() as StageTag,
      body: message.slice(match[0].length).trim(),
    };
  }
  return { stage: null, body: message };
}

const STAGE_STYLE: Record<StageTag, { color: string; bg: string; border: string; icon: React.FC<{ className?: string }> }> = {
  PLANNING:     { color: 'text-blue-400',    bg: 'bg-blue-400/10',    border: 'border-blue-400/25',    icon: Settings },
  INSPECTING:   { color: 'text-purple-400',  bg: 'bg-purple-400/10',  border: 'border-purple-400/25',  icon: Search },
  EDITING:      { color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/25', icon: FileEdit },
  VERIFYING:    { color: 'text-cyan-400',    bg: 'bg-cyan-400/10',    border: 'border-cyan-400/25',    icon: CheckCircle2 },
  REPAIRING:    { color: 'text-amber-400',   bg: 'bg-amber-400/10',   border: 'border-amber-400/25',   icon: Wrench },
  'WRAPPING UP':{ color: 'text-green-400',   bg: 'bg-green-400/10',   border: 'border-green-400/25',   icon: CheckCircle2 },
};

// ─── Clipboard helper ─────────────────────────────────────────────────────────

async function safeWriteToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, el.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch { return false; }
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function OutputPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('agent');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const viewingTaskId = useIdeStore(s => s.viewingTaskId);
  const activeTaskId  = useIdeStore(s => s.activeTaskId);
  const taskLogs      = useIdeStore(s => s.taskLogs);
  const { terminalOutput, clearTerminal } = useIdeStore();

  const agentLogs = (viewingTaskId && taskLogs[viewingTaskId]) || EMPTY_LOGS;

  const terminalEndRef   = useRef<HTMLDivElement>(null);
  const agentEndRef      = useRef<HTMLDivElement>(null);
  const agentScrollRef   = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  useEffect(() => {
    if (activeTab === 'terminal') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (!userScrolled) {
      agentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalOutput.length, agentLogs.length, activeTab, userScrolled]);

  const handleAgentScroll = useCallback(() => {
    const el = agentScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setUserScrolled(!atBottom);
  }, []);

  useEffect(() => { setUserScrolled(false); }, [activeTab, agentLogs.length === 0]);

  const handleCopyLogs = useCallback(async () => {
    const text = activeTab === 'agent'
      ? agentLogs.map(l =>
          `[${format(new Date(l.timestamp), 'HH:mm:ss')}] [${l.type.toUpperCase()}] ${l.message}`
        ).join('\n')
      : terminalOutput.join('');
    const ok = await safeWriteToClipboard(text);
    if (ok) { setCopied(true); setCopyFailed(false); setTimeout(() => setCopied(false), 1800); }
    else    { setCopyFailed(true); setTimeout(() => setCopyFailed(false), 2500); }
  }, [activeTab, agentLogs, terminalOutput]);

  const doneLog        = agentLogs.findLast(l => l.type === 'done');
  const completionData: CompletionData | null = doneLog?.data ?? null;
  const lastErrorLog   = agentLogs.findLast(l => l.type === 'error' && l.data?.category);
  const failureData: FailureData | null = (!doneLog && lastErrorLog?.data) ? lastErrorLog.data as FailureData : null;

  const commandCount = agentLogs.filter(l => l.type === 'command').length;
  const repairCount  = agentLogs.filter(l => l.type === 'thought' && parseThought(l.message).stage === 'REPAIRING').length;
  const isLive       = activeTaskId !== null && activeTaskId === viewingTaskId;
  const hasContent   = activeTab === 'agent' ? agentLogs.length > 0 : terminalOutput.length > 0;

  return (
    <div className="bg-panel border-r border-panel-border flex flex-col" style={{ gridArea: 'terminal' }}>
      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="h-10 border-b border-panel-border flex items-center justify-between px-2 shrink-0 bg-background/50">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('agent')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-2 transition-colors
              ${activeTab === 'agent' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-panel'}`}
          >
            <Activity className="w-3.5 h-3.5" />
            Execution Feed
            {isLive && (
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

        <div className="flex items-center gap-1">
          {isLive && activeTab === 'agent' && (
            <span className="text-xs text-primary/60 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> live
            </span>
          )}
          {hasContent && (
            <button
              onClick={handleCopyLogs}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors
                ${copyFailed ? 'text-amber-400 hover:text-amber-300 hover:bg-panel' : 'text-muted-foreground hover:text-foreground hover:bg-panel'}`}
              title={copyFailed ? 'Clipboard not available' : `Copy ${activeTab === 'agent' ? 'feed' : 'terminal'}`}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className={`w-3.5 h-3.5 ${copyFailed ? 'text-amber-400' : ''}`} />}
              <span>{copied ? 'Copied' : copyFailed ? 'Unavailable' : 'Copy'}</span>
            </button>
          )}
          {activeTab === 'terminal' && (
            <button onClick={clearTerminal} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-panel transition-colors" title="Clear Terminal">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div
        ref={agentScrollRef}
        onScroll={activeTab === 'agent' ? handleAgentScroll : undefined}
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-panel-border scrollbar-track-transparent bg-[#0a0a0c] p-4 font-mono text-sm"
      >
        {activeTab === 'agent' && (
          <div className="space-y-1.5">
            {agentLogs.length === 0 ? (
              <div className="text-muted-foreground text-center mt-10 text-sm">
                {viewingTaskId
                  ? 'No execution log available for this task.'
                  : 'No task selected. Submit a task or click one from history to see activity.'}
              </div>
            ) : (
              agentLogs.map((log) => (
                <AgentLogItem key={log.id} log={log} />
              ))
            )}

            {failureData && <FailureCard data={failureData} />}

            {completionData && !failureData && (
              <CompletionCard data={completionData} repairCount={repairCount} />
            )}

            {userScrolled && agentLogs.length > 0 && (
              <button
                onClick={() => { setUserScrolled(false); agentEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
                className="fixed bottom-6 left-1/3 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-full shadow-lg hover:bg-primary/90 transition-colors z-10"
              >
                ↓ Jump to latest
              </button>
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
              terminalOutput.map((chunk, i) => <span key={i}>{chunk}</span>)
            )}
            <div ref={terminalEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Individual log item ──────────────────────────────────────────────────────

function AgentLogItem({ log }: { log: AgentLogEvent }) {
  if (log.type === 'done') return null;

  // Thought events get special stage-aware rendering
  if (log.type === 'thought') {
    return <ThoughtItem log={log} />;
  }

  // Status events: compact single-line
  if (log.type === 'status') {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
        <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/50" />
        <span>{log.message}</span>
      </div>
    );
  }

  // File read: compact single line
  if (log.type === 'file_read') {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-xs">
        <Eye className="w-3 h-3 shrink-0 text-purple-400/70" />
        <span className="text-purple-300/70 font-mono">{log.message}</span>
        <Timestamp ts={log.timestamp} />
      </div>
    );
  }

  // File write: compact, slightly more prominent
  if (log.type === 'file_write') {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-emerald-400/5 border border-emerald-400/10 text-xs">
        <FileEdit className="w-3 h-3 shrink-0 text-emerald-400" />
        <span className="text-emerald-300 font-mono flex-1 truncate">{log.message}</span>
        {log.data?.reason != null && (
          <span className="text-emerald-400/50 truncate max-w-[200px] hidden lg:inline">{String(log.data.reason).slice(0, 60)}</span>
        )}
        <Timestamp ts={log.timestamp} />
      </div>
    );
  }

  // Command: prominent card
  if (log.type === 'command') {
    return (
      <div className="px-3 py-2 rounded-lg bg-cyan-400/5 border border-cyan-400/15 text-xs space-y-0.5">
        <div className="flex items-center gap-2">
          <Terminal className="w-3 h-3 shrink-0 text-cyan-400" />
          <span className="text-cyan-400 font-semibold uppercase tracking-wider text-[10px]">Run</span>
          <Timestamp ts={log.timestamp} />
        </div>
        <pre className="text-cyan-200 font-mono text-xs whitespace-pre-wrap break-all mt-1 leading-relaxed">$ {log.message.replace(/^Running:\s*/, '')}</pre>
      </div>
    );
  }

  // Command output: very subtle
  if (log.type === 'command_output') {
    const isSuccess = log.message.startsWith('✓');
    return (
      <div className={`flex items-center gap-2 px-2 py-1 text-xs ${isSuccess ? 'text-green-400/70' : 'text-red-400/70'}`}>
        {isSuccess
          ? <CheckCircle2 className="w-3 h-3 shrink-0" />
          : <AlertCircle className="w-3 h-3 shrink-0" />
        }
        <span className="font-mono">{log.message}</span>
      </div>
    );
  }

  // Error
  if (log.type === 'error') {
    return (
      <div className="px-3 py-2 rounded-lg bg-red-400/8 border border-red-400/20 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
          <span className="text-red-400 font-semibold uppercase tracking-wider text-[10px]">Error</span>
          <Timestamp ts={log.timestamp} />
        </div>
        <p className="text-red-300 whitespace-pre-wrap break-words leading-relaxed">{log.message}</p>
      </div>
    );
  }

  // Fallback
  return (
    <div className="flex gap-2 px-2 py-1 text-xs text-muted-foreground">
      <Activity className="w-3 h-3 shrink-0 mt-0.5" />
      <span>{log.message}</span>
    </div>
  );
}

// ─── Thought item (stage-aware) ───────────────────────────────────────────────

function ThoughtItem({ log }: { log: AgentLogEvent }) {
  const { stage, body } = parseThought(log.message);

  if (stage) {
    const style = STAGE_STYLE[stage];
    const Icon = style.icon;
    return (
      <div className={`px-3 py-2 rounded-lg border text-xs ${style.bg} ${style.border} space-y-1`}>
        <div className="flex items-center gap-2">
          <Icon className={`w-3 h-3 shrink-0 ${style.color}`} />
          <span className={`font-semibold uppercase tracking-wider text-[10px] ${style.color}`}>{stage}</span>
          <Timestamp ts={log.timestamp} />
        </div>
        {body && (
          <p className="text-gray-300 text-xs whitespace-pre-wrap break-words leading-relaxed">{body}</p>
        )}
      </div>
    );
  }

  // Unstaged thought (model thinking without a tag)
  return (
    <div className="px-3 py-2 rounded-lg bg-gray-400/5 border border-gray-400/10 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <Settings className="w-3 h-3 shrink-0 text-gray-400/60" />
        <span className="font-semibold uppercase tracking-wider text-[10px] text-gray-400/60">Thinking</span>
        <Timestamp ts={log.timestamp} />
      </div>
      {body && <p className="text-gray-300 text-xs whitespace-pre-wrap break-words leading-relaxed">{body}</p>}
    </div>
  );
}

// ─── Timestamp ────────────────────────────────────────────────────────────────

function Timestamp({ ts }: { ts: string }) {
  return (
    <span className="ml-auto text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
      {format(new Date(ts), 'HH:mm:ss')}
    </span>
  );
}

// ─── Failure card ─────────────────────────────────────────────────────────────

function FailureCard({ data }: { data: FailureData }) {
  const categoryLabel: Record<string, string> = {
    model: 'AI Provider', missing_api_key: 'Missing API Key', invalid_api_key: 'Invalid API Key',
    model_not_found: 'Model Not Found', insufficient_balance: 'Insufficient Balance',
    rate_limit: 'Rate Limited', network_error: 'Network Error', base_url_error: 'Bad Base URL',
    context_length: 'Context Too Long', tool: 'Tool Execution', command: 'Command Execution',
    workspace: 'Workspace', orchestration: 'Internal Orchestration', cancelled: 'Cancelled',
  };

  const isCancelled = data.category === 'cancelled';
  const icon = isCancelled
    ? <AlertCircle className="w-4 h-4 text-amber-400" />
    : data.category === 'workspace'
      ? <ShieldAlert className="w-4 h-4 text-red-400" />
      : data.category === 'model'
        ? <Zap className="w-4 h-4 text-red-400" />
        : <AlertCircle className="w-4 h-4 text-red-400" />;

  return (
    <div className={`rounded-xl border p-4 space-y-3 mt-2 ${isCancelled ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
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
      {data.title && <p className="text-sm text-gray-100 font-medium leading-snug">{data.title}</p>}
      {data.detail && (
        <pre className={`text-xs whitespace-pre-wrap break-words rounded-lg px-3 py-2 font-mono leading-relaxed ${isCancelled ? 'text-amber-300 bg-amber-400/10 border border-amber-400/20' : 'text-red-300 bg-red-400/10 border border-red-400/20'}`}>
          {data.detail}
        </pre>
      )}
      {data.step && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">Failed at:</span>{' '}
          <code className="font-mono">{data.step}</code>
        </p>
      )}
    </div>
  );
}

// ─── Completion card ──────────────────────────────────────────────────────────

function CompletionCard({ data, repairCount }: { data: CompletionData; repairCount: number }) {
  const statusKey = (data.final_status ?? 'complete') as 'complete' | 'partial' | 'blocked';

  const statusColor = {
    complete: 'border-green-500/30 bg-green-500/5',
    partial:  'border-amber-500/30 bg-amber-500/5',
    blocked:  'border-red-500/30 bg-red-500/5',
  }[statusKey];

  const statusLabel = { complete: 'Completed', partial: 'Partially Completed', blocked: 'Blocked' }[statusKey];

  const statusIcon = {
    complete: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    partial:  <AlertCircle  className="w-4 h-4 text-amber-500" />,
    blocked:  <AlertCircle  className="w-4 h-4 text-red-500"   />,
  }[statusKey];

  const verificationEvidence = data.summary
    ? data.summary.match(/exit 0|compiled clean|test passed|verified|✓|output matches|GONE|confirmed/i)
    : null;

  return (
    <div className={`rounded-xl border p-4 space-y-3 mt-2 ${statusColor}`}>
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        {statusIcon}
        <span className="font-semibold text-sm text-foreground">{statusLabel}</span>
        {repairCount > 0 && (
          <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full ml-auto">
            {repairCount} repair{repairCount > 1 ? 's' : ''}
          </span>
        )}
        {verificationEvidence && (
          <span className="text-xs text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-0.5 rounded-full">
            verified
          </span>
        )}
      </div>

      {/* Summary */}
      {data.summary && (
        <p className="text-sm text-gray-200 leading-relaxed">{data.summary}</p>
      )}

      {/* Files changed */}
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

      {/* Commands run */}
      {data.commands_run && data.commands_run.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            Commands Run ({data.commands_run.length})
          </p>
          <ul className="space-y-0.5">
            {data.commands_run.map((c, i) => (
              <li key={i} className="text-xs font-mono text-cyan-400 bg-cyan-400/5 px-2 py-0.5 rounded truncate" title={c}>$ {c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Remaining */}
      {data.remaining && (
        <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          <span className="font-semibold">Remaining: </span>{data.remaining}
        </div>
      )}
    </div>
  );
}
