import { useState, useRef, useEffect, useCallback } from 'react';
import { useIdeStore, AgentLogEvent } from '@/store/use-ide-store';
import {
  Terminal, Activity, CheckCircle2, AlertCircle, PlayCircle,
  Eye, FileEdit, Settings, Trash2, FileCheck, GitBranch,
  ShieldAlert, Zap, Copy, Check, ChevronRight, Search,
  Wrench, Loader2, ChevronDown, MapPin, ListChecks,
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

// ─── Log segmentation ─────────────────────────────────────────────────────────
// Groups ≥ 3 consecutive file_read events into a collapsible row so the feed
// doesn't balloon with dozens of individual read lines — matches Replit's
// "grouped action" presentation style.

type LogSegment =
  | { kind: 'single'; log: AgentLogEvent }
  | { kind: 'file_read_group'; logs: AgentLogEvent[] };

function segmentLogs(logs: AgentLogEvent[]): LogSegment[] {
  const out: LogSegment[] = [];
  let i = 0;
  while (i < logs.length) {
    if (logs[i].type === 'file_read') {
      const group: AgentLogEvent[] = [logs[i]];
      let j = i + 1;
      while (j < logs.length && logs[j].type === 'file_read') {
        group.push(logs[j]);
        j++;
      }
      if (group.length >= 3) {
        out.push({ kind: 'file_read_group', logs: group });
        i = j;
      } else {
        group.forEach(l => out.push({ kind: 'single', log: l }));
        i = j;
      }
    } else {
      out.push({ kind: 'single', log: logs[i] });
      i++;
    }
  }
  return out;
}

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
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-panel-border scrollbar-track-transparent bg-[#0a0a0c] p-3 font-mono text-sm"
      >
        {activeTab === 'agent' && (
          <div className="space-y-1">
            {agentLogs.length === 0 ? (
              <div className="text-muted-foreground text-center mt-10 text-sm">
                {viewingTaskId
                  ? 'No execution log available for this task.'
                  : 'No task selected. Submit a task or click one from history to see activity.'}
              </div>
            ) : (
              segmentLogs(agentLogs).map((seg, i) =>
                seg.kind === 'file_read_group'
                  ? <FileReadGroup key={`grp-${i}`} logs={seg.logs} />
                  : <AgentLogItem key={seg.log.id} log={seg.log} />
              )
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

  // Command: single-row with command inline
  if (log.type === 'command') {
    const cmd = log.message.replace(/^Running:\s*/, '');
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded border bg-cyan-400/5 border-cyan-400/15 text-xs">
        <Terminal className="w-3 h-3 shrink-0 text-cyan-400" />
        <pre className="text-cyan-200 font-mono text-xs flex-1 truncate">$ {cmd}</pre>
        <Timestamp ts={log.timestamp} />
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

  // Error — single row, message truncated
  if (log.type === 'error') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded border bg-red-400/8 border-red-400/20 text-xs">
        <AlertCircle className="w-3 h-3 shrink-0 text-red-400" />
        <span className="text-red-300 truncate flex-1">{log.message}</span>
        <Timestamp ts={log.timestamp} />
      </div>
    );
  }

  // Route event: compact informational tag showing what execution profile was selected
  if (log.type === 'route') {
    const category = log.data?.category as string | undefined;
    const maxSteps = log.data?.maxSteps as number | undefined;
    const maxReads = log.data?.maxFileReads as number | undefined;
    return (
      <div className="flex items-center gap-2 px-2.5 py-1 text-xs text-blue-300/60 bg-blue-400/5 border border-blue-400/10 rounded">
        <MapPin className="w-3 h-3 shrink-0 text-blue-400/50" />
        <span className="font-mono text-blue-300/70">{category ?? 'routed'}</span>
        {maxSteps != null && (
          <span className="text-blue-400/40 ml-auto">≤{maxSteps} steps{maxReads != null ? ` · ≤${maxReads} reads` : ''}</span>
        )}
        <Timestamp ts={log.timestamp} />
      </div>
    );
  }

  // Plan event: expandable block showing the structured execution plan
  if (log.type === 'plan') {
    const goal     = log.data?.goal     as string | undefined;
    const approach = log.data?.approach as string | undefined;
    const files    = log.data?.filesToRead  as string[] | undefined;
    const changes  = log.data?.expectedChanges as string[] | undefined;
    const verify   = log.data?.verification as string | undefined;
    return (
      <div className="rounded border border-indigo-400/20 bg-indigo-400/5 text-xs overflow-hidden">
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-indigo-400/10">
          <ListChecks className="w-3 h-3 shrink-0 text-indigo-400" />
          <span className="font-semibold text-indigo-300 text-[11px] uppercase tracking-wider">Execution Plan</span>
          <Timestamp ts={log.timestamp} />
        </div>
        <div className="px-3 py-2 space-y-1.5">
          {goal && (
            <div>
              <span className="text-indigo-400/60 text-[10px] uppercase tracking-wider">Goal </span>
              <span className="text-indigo-200/80">{goal}</span>
            </div>
          )}
          {approach && (
            <div className="text-indigo-100/50 leading-relaxed">{approach}</div>
          )}
          {files && files.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              <span className="text-indigo-400/60 text-[10px] uppercase tracking-wider mr-1">Read</span>
              {files.map((f, i) => (
                <span key={i} className="font-mono bg-indigo-400/10 border border-indigo-400/15 px-1.5 py-0.5 rounded text-indigo-200/60">{f}</span>
              ))}
            </div>
          )}
          {changes && changes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-indigo-400/60 text-[10px] uppercase tracking-wider mr-1">Change</span>
              {changes.map((f, i) => (
                <span key={i} className="font-mono bg-emerald-400/8 border border-emerald-400/12 px-1.5 py-0.5 rounded text-emerald-300/60">{f}</span>
              ))}
            </div>
          )}
          {verify && (
            <div>
              <span className="text-indigo-400/60 text-[10px] uppercase tracking-wider">Verify </span>
              <span className="font-mono text-cyan-300/60">{verify}</span>
            </div>
          )}
        </div>
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
      <div className={`px-2.5 py-1.5 rounded border text-xs ${style.bg} ${style.border}`}>
        <div className="flex items-center gap-1.5">
          <Icon className={`w-3 h-3 shrink-0 ${style.color}`} />
          <span className={`font-semibold uppercase tracking-wider text-[10px] ${style.color}`}>{stage}</span>
          {body && <span className="text-gray-300 text-xs truncate flex-1">{body}</span>}
          <Timestamp ts={log.timestamp} />
        </div>
      </div>
    );
  }

  // Unstaged thought — single-line compact row
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/70">
      <Settings className="w-3 h-3 shrink-0 text-gray-400/40" />
      {body && <span className="truncate flex-1">{body}</span>}
      <Timestamp ts={log.timestamp} />
    </div>
  );
}

// ─── File-read group (collapsed) ─────────────────────────────────────────────
// Renders ≥ 3 consecutive file_read events as a single collapsible badge row,
// reducing visual clutter in the feed.

function FileReadGroup({ logs }: { logs: AgentLogEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const last = logs[logs.length - 1];
  return (
    <div className="rounded border border-purple-400/10 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-2 py-1 text-xs text-purple-300/70 hover:bg-purple-400/5 transition-colors"
      >
        <Eye className="w-3 h-3 shrink-0 text-purple-400/70" />
        <span className="font-mono flex-1 text-left">
          {logs.length} files read
        </span>
        <Timestamp ts={last.timestamp} />
        {expanded
          ? <ChevronDown className="w-3 h-3 shrink-0 text-purple-400/40" />
          : <ChevronRight className="w-3 h-3 shrink-0 text-purple-400/40" />
        }
      </button>
      {expanded && (
        <div className="border-t border-purple-400/10 bg-[#0a0a0c] divide-y divide-purple-400/5">
          {logs.map(l => (
            <div key={l.id} className="flex items-center gap-2 px-3 py-0.5 text-xs">
              <Eye className="w-2.5 h-2.5 shrink-0 text-purple-400/40" />
              <span className="text-purple-300/60 font-mono truncate flex-1">{l.message}</span>
              <Timestamp ts={l.timestamp} />
            </div>
          ))}
        </div>
      )}
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
    <div className={`rounded-lg border p-3 space-y-2 mt-1.5 ${isCancelled ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
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
    <div className={`rounded-lg border p-3 space-y-2 mt-1.5 ${statusColor}`}>
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
