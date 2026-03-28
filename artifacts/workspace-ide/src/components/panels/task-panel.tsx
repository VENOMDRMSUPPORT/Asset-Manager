import { useState, useCallback, useMemo } from 'react';
import { useStartAgentTask, useListAgentTasks } from '@workspace/api-client-react';
import { useIdeStore, AgentLogEvent } from '@/store/use-ide-store';
import { useGetWorkspace, useSetWorkspace } from '@workspace/api-client-react';
import {
  Bot, Sparkles, Send, Clock, CheckCircle2, Loader2, AlertCircle,
  X, ChevronDown, ChevronUp, Trash2, FolderOpen, Eye, Terminal,
  FileCheck, Zap, Settings, Search, FileEdit, Wrench, Activity,
} from 'lucide-react';
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { getListAgentTasksQueryKey, getGetWorkspaceQueryKey, getListFilesQueryKey } from '@workspace/api-client-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskFailureDetail {
  title?: string;
  detail?: string;
  step?: string;
  category?: string;
}

interface TaskCompletion {
  summary?: string;
  final_status?: string;
  changed_files?: string[];
  commands_run?: string[];
  remaining?: string;
}

interface TaskShape {
  id: string;
  prompt: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
  failureDetail?: TaskFailureDetail;
  completion?: TaskCompletion;
}

interface BackendEvent {
  type: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const d = intervalToDuration({ start: 0, end: ms });
  return formatDuration(d, { format: ['minutes', 'seconds'] });
}

// ─── Stage parsing ────────────────────────────────────────────────────────────

const STAGE_TAGS = ['PLANNING', 'INSPECTING', 'EDITING', 'VERIFYING', 'REPAIRING', 'WRAPPING UP'] as const;
type StageTag = typeof STAGE_TAGS[number];

function parseStage(message: string): StageTag | null {
  const match = message.match(/^\[(PLANNING|INSPECTING|EDITING|VERIFYING|REPAIRING|WRAPPING UP)\]/i);
  return match ? (match[1].toUpperCase() as StageTag) : null;
}

const STAGE_META: Record<StageTag, { color: string; icon: React.FC<{ className?: string }> }> = {
  PLANNING:      { color: 'text-blue-400',    icon: Settings },
  INSPECTING:    { color: 'text-purple-400',  icon: Search },
  EDITING:       { color: 'text-emerald-400', icon: FileEdit },
  VERIFYING:     { color: 'text-cyan-400',    icon: CheckCircle2 },
  REPAIRING:     { color: 'text-amber-400',   icon: Wrench },
  'WRAPPING UP': { color: 'text-green-400',   icon: CheckCircle2 },
};

function useCurrentStage(logs: AgentLogEvent[]): StageTag | null {
  return useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i];
      if (l.type === 'thought') {
        const stage = parseStage(l.message);
        if (stage) return stage;
      }
    }
    return null;
  }, [logs]);
}

// ─── Running task banner ──────────────────────────────────────────────────────

function RunningTaskBanner({
  activeTaskId,
  onCancel,
}: { activeTaskId: string; onCancel: () => void }) {
  const taskLogs = useIdeStore(s => s.taskLogs);
  const logs     = taskLogs[activeTaskId] ?? [];
  const stage    = useCurrentStage(logs);

  const fileWriteCount  = logs.filter(l => l.type === 'file_write').length;
  const commandCount    = logs.filter(l => l.type === 'command').length;
  const repairCount     = logs.filter(l => l.type === 'thought' && parseStage(l.message) === 'REPAIRING').length;

  const stageMeta = stage ? STAGE_META[stage] : null;
  const StageIcon = stageMeta?.icon ?? Sparkles;
  const stageColor = stageMeta?.color ?? 'text-primary';

  return (
    <div className="mx-4 mt-3 mb-0 rounded-xl border border-primary/25 bg-primary/8 overflow-hidden shrink-0">
      {/* Main status row */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <StageIcon className={`w-3.5 h-3.5 ${stageColor} ${!stage ? 'animate-pulse' : ''}`} />
          <span className={`text-xs font-semibold ${stageColor}`}>
            {stage ?? 'Starting…'}
          </span>
        </div>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive border border-panel-border hover:border-destructive/40 px-2 py-0.5 rounded-md transition-colors"
          title="Cancel running task"
        >
          <X className="w-3 h-3" />
          Cancel
        </button>
      </div>

      {/* Progress indicators */}
      {(fileWriteCount > 0 || commandCount > 0 || repairCount > 0) && (
        <div className="flex items-center gap-3 px-3 pb-2.5 text-[10px] text-muted-foreground">
          {fileWriteCount > 0 && (
            <span className="flex items-center gap-1">
              <FileEdit className="w-3 h-3 text-emerald-400/70" />
              {fileWriteCount} write{fileWriteCount !== 1 ? 's' : ''}
            </span>
          )}
          {commandCount > 0 && (
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3 text-cyan-400/70" />
              {commandCount} cmd{commandCount !== 1 ? 's' : ''}
            </span>
          )}
          {repairCount > 0 && (
            <span className="flex items-center gap-1 text-amber-400/80">
              <Wrench className="w-3 h-3" />
              {repairCount} repair{repairCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function TaskPanel() {
  const [prompt, setPrompt] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startActiveTask   = useIdeStore(s => s.startActiveTask);
  const clearActiveTask   = useIdeStore(s => s.clearActiveTask);
  const setViewingTask    = useIdeStore(s => s.setViewingTask);
  const hydrateTaskEvents = useIdeStore(s => s.hydrateTaskEvents);
  const activeTaskId      = useIdeStore(s => s.activeTaskId);
  const viewingTaskId     = useIdeStore(s => s.viewingTaskId);
  const taskLogsLoaded    = useIdeStore(s => s.taskLogsLoaded);
  const isConnected       = useIdeStore(s => s.isConnected);

  const queryClient = useQueryClient();

  const { data: historyData, isLoading: isLoadingHistory } = useListAgentTasks();
  const { data: workspace } = useGetWorkspace();

  const { mutate: startTask, isPending } = useStartAgentTask({
    mutation: {
      onSuccess: (data) => {
        setPrompt('');
        startActiveTask(data.taskId);
        setExpandedTaskId(null);
        queryClient.invalidateQueries({ queryKey: getListAgentTasksQueryKey() });
      },
    },
  });

  const { mutate: setWorkspace } = useSetWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isPending || activeTaskId) return;
    startTask({ data: { prompt: prompt.trim() } });
  };

  const handleCancel = async () => {
    if (!activeTaskId) return;
    try {
      await fetch(`/api/agent/tasks/${activeTaskId}/cancel`, { method: 'POST' });
      clearActiveTask();
      queryClient.invalidateQueries({ queryKey: getListAgentTasksQueryKey() });
    } catch (err) {
      console.error('Cancel failed', err);
    }
  };

  const handleDelete = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(taskId);
    try {
      const res = await fetch(`/api/agent/tasks/${taskId}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeTaskId === taskId) clearActiveTask();
        if (expandedTaskId === taskId) setExpandedTaskId(null);
        queryClient.invalidateQueries({ queryKey: getListAgentTasksQueryKey() });
      }
    } catch (err) {
      console.error('Delete failed', err);
    } finally {
      setDeletingId(null);
    }
  }, [activeTaskId, expandedTaskId, clearActiveTask, queryClient]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handleTaskClick = useCallback(async (task: TaskShape) => {
    setViewingTask(task.id);
    setExpandedTaskId(prev => prev === task.id ? null : task.id);
    if (task.status !== 'running' && !taskLogsLoaded.has(task.id)) {
      try {
        const res = await fetch(`/api/agent/tasks/${task.id}/events`);
        if (res.ok) {
          const data = await res.json() as { events: BackendEvent[] };
          hydrateTaskEvents(task.id, data.events ?? []);
        }
      } catch { /* silent */ }
    }
  }, [setViewingTask, taskLogsLoaded, hydrateTaskEvents]);

  const isRunning = isPending || activeTaskId !== null;
  const tasks = (historyData?.tasks ?? []) as TaskShape[];

  return (
    <div className="bg-panel flex flex-col h-full overflow-hidden" style={{ gridArea: 'taskbar' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="h-12 border-b border-panel-border flex items-center px-4 shrink-0 bg-background/50">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <Bot className="w-4 h-4 text-primary" />
          VenomGPT
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {workspace?.root && (
            <button
              onClick={() => {
                const newPath = window.prompt('Enter workspace path:', workspace.root ?? '');
                if (newPath && newPath.trim() && newPath.trim() !== workspace.root) {
                  setWorkspace({ data: { root: newPath.trim() } });
                }
              }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Switch workspace"
            >
              <FolderOpen className="w-3 h-3 text-primary/60" />
              <span className="font-mono truncate max-w-[120px]">{workspace.root.split('/').pop() || workspace.root}</span>
            </button>
          )}
          <div className="w-px h-3.5 bg-panel-border" />
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-muted-foreground">{isConnected ? 'Connected' : 'Offline'}</span>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">

        {/* Running task live banner */}
        {activeTaskId && (
          <RunningTaskBanner activeTaskId={activeTaskId} onCancel={handleCancel} />
        )}

        {/* Task history */}
        <div className="flex-1 p-3 pt-4">
          <h3 className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 flex items-center gap-2 px-1">
            <Activity className="w-3 h-3" />
            Task History
            {tasks.length > 0 && (
              <span className="ml-auto normal-case font-normal tracking-normal text-muted-foreground/40">
                {tasks.length}
              </span>
            )}
          </h3>

          <div className="space-y-1.5">
            {isLoadingHistory ? (
              <div className="flex justify-center p-6">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center p-6 bg-background/40 rounded-xl border border-dashed border-panel-border">
                <Bot className="w-6 h-6 mx-auto mb-2 opacity-30" />
                No tasks yet. Describe a task below to get started.
              </div>
            ) : (
              tasks.map((task) => {
                const isExpanded = expandedTaskId === task.id;
                const isActive   = activeTaskId === task.id;
                const isViewing  = viewingTaskId === task.id;
                const hasDetail  = task.status === 'error'
                  ? !!(task.failureDetail?.title || task.summary)
                  : !!(task.completion?.summary || task.summary);

                const fileCount    = task.completion?.changed_files?.length ?? 0;
                const commandCount = task.completion?.commands_run?.length ?? 0;

                return (
                  <div
                    key={task.id}
                    className={`rounded-lg border text-left transition-all
                      ${isActive
                        ? 'bg-primary/10 border-primary/30'
                        : isViewing && !isActive
                          ? 'bg-background border-primary/20 ring-1 ring-primary/10'
                          : 'bg-background/60 hover:bg-background border-panel-border'
                      }`}
                  >
                    <div className="p-2.5 cursor-pointer" onClick={() => handleTaskClick(task)}>
                      {/* Prompt */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-[13px] font-medium text-foreground line-clamp-2 leading-snug flex-1">
                          {task.prompt}
                        </p>
                        <div className="flex items-center gap-1 shrink-0 mt-0.5">
                          {isViewing && !isActive && (
                            <span title="Viewing in execution feed">
                              <Eye className="w-3 h-3 text-primary/50" />
                            </span>
                          )}
                          <StatusIcon status={task.status} />
                          {hasDetail && (
                            isExpanded
                              ? <ChevronUp className="w-3 h-3 text-muted-foreground/60" />
                              : <ChevronDown className="w-3 h-3 text-muted-foreground/60" />
                          )}
                          {task.status !== 'running' && (
                            <button
                              onClick={(e) => handleDelete(task.id, e)}
                              disabled={deletingId === task.id}
                              className="p-0.5 text-muted-foreground/30 hover:text-destructive rounded transition-colors disabled:opacity-40"
                              title="Delete task"
                            >
                              {deletingId === task.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Trash2 className="w-3 h-3" />
                              }
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground/50">
                          {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {/* Inline outcome chips */}
                          {fileCount > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400/70 bg-emerald-400/8 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                              <FileCheck className="w-2.5 h-2.5" />
                              {fileCount}
                            </span>
                          )}
                          {commandCount > 0 && (
                            <span className="text-[10px] font-mono text-cyan-400/70 bg-cyan-400/8 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                              <Terminal className="w-2.5 h-2.5" />
                              {commandCount}
                            </span>
                          )}
                          {task.durationMs != null && task.status !== 'running' && (
                            <span className="text-[11px] text-muted-foreground/40">
                              {formatMs(task.durationMs)}
                            </span>
                          )}
                          <span className={`text-[10px] font-semibold capitalize ${
                            task.status === 'done'
                              ? 'text-green-400/80'
                              : task.status === 'error'
                                ? 'text-red-400/80'
                                : task.status === 'running'
                                  ? 'text-primary/80'
                                  : 'text-muted-foreground/60'
                          }`}>
                            {task.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && hasDetail && (
                      <div className="px-2.5 pb-2.5 border-t border-panel-border/40 pt-2 space-y-2">
                        {task.status === 'error' && task.failureDetail ? (
                          <ErrorDetail failure={task.failureDetail} />
                        ) : task.status === 'error' && task.summary ? (
                          <p className="text-xs text-red-400 leading-relaxed">{task.summary}</p>
                        ) : task.completion ? (
                          <SuccessDetail completion={task.completion} />
                        ) : task.summary ? (
                          <p className="text-xs text-muted-foreground leading-relaxed">{task.summary}</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Composer ────────────────────────────────────────────────────── */}
      <div className="border-t border-panel-border p-3 shrink-0 bg-background/20">
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRunning
                ? 'Agent is working…'
                : 'Describe what you want to build or fix.\n⌘/Ctrl+Enter to submit.'
            }
            className="w-full h-[104px] bg-background border border-panel-border rounded-xl p-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none transition-all"
            disabled={isRunning}
          />
          <div className="absolute bottom-3 right-3">
            <button
              type="submit"
              disabled={!prompt.trim() || isRunning}
              className="p-2 bg-primary text-primary-foreground rounded-lg shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all group"
              title="Submit (⌘/Ctrl+Enter)"
            >
              {isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ErrorDetail({ failure }: { failure: TaskFailureDetail }) {
  const categoryLabel: Record<string, string> = {
    model: 'AI Provider', missing_api_key: 'Missing Key', invalid_api_key: 'Invalid Key',
    model_not_found: 'Model Not Found', insufficient_balance: 'Insufficient Balance',
    entitlement_error: 'Access Denied', rate_limit: 'Rate Limited',
    network_error: 'Network Error', base_url_error: 'Bad URL', context_length: 'Context Too Long',
    tool: 'Tool', command: 'Command', workspace: 'Workspace', orchestration: 'Internal', cancelled: 'Cancelled',
  };
  return (
    <div className="space-y-1.5">
      {failure.category && (
        <span className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full inline-block">
          {categoryLabel[failure.category] ?? failure.category}
        </span>
      )}
      {failure.title && <p className="text-xs text-red-300 font-medium leading-snug">{failure.title}</p>}
      {failure.detail && (
        <pre className="text-xs text-red-400/80 bg-red-400/5 border border-red-400/10 rounded p-2 whitespace-pre-wrap break-words font-mono leading-relaxed">
          {failure.detail}
        </pre>
      )}
    </div>
  );
}

function SuccessDetail({ completion }: { completion: TaskCompletion }) {
  const statusKey = (completion.final_status ?? 'complete') as 'complete' | 'partial' | 'blocked';
  const statusBadge = {
    complete: 'text-green-400 bg-green-400/10 border-green-400/20',
    partial:  'text-amber-400 bg-amber-400/10 border-amber-400/20',
    blocked:  'text-red-400 bg-red-400/10 border-red-400/20',
  }[statusKey];

  return (
    <div className="space-y-2">
      {completion.final_status && completion.final_status !== 'complete' && (
        <span className={`text-[10px] border px-2 py-0.5 rounded-full inline-block capitalize ${statusBadge}`}>
          {completion.final_status}
        </span>
      )}
      {completion.summary && (
        <p className="text-xs text-muted-foreground leading-relaxed">{completion.summary}</p>
      )}
      {completion.changed_files && completion.changed_files.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1 flex items-center gap-1">
            <FileCheck className="w-2.5 h-2.5 text-emerald-400/60" /> Files changed
          </p>
          <div className="flex flex-wrap gap-1">
            {completion.changed_files.map((f, i) => (
              <span key={i} className="text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
                {f.includes('/') ? f.split('/').pop() : f}
              </span>
            ))}
          </div>
        </div>
      )}
      {completion.commands_run && completion.commands_run.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1 flex items-center gap-1">
            <Terminal className="w-2.5 h-2.5 text-cyan-400/60" /> Commands run
          </p>
          <div className="flex flex-col gap-0.5">
            {completion.commands_run.slice(0, 4).map((c, i) => (
              <span key={i} className="text-[10px] font-mono text-cyan-400/80 bg-cyan-400/5 px-1.5 py-0.5 rounded truncate" title={c}>
                $ {c}
              </span>
            ))}
            {completion.commands_run.length > 4 && (
              <span className="text-[10px] text-muted-foreground/40 px-1.5">
                +{completion.commands_run.length - 4} more
              </span>
            )}
          </div>
        </div>
      )}
      {completion.remaining && (
        <p className="text-[10px] text-amber-400 leading-relaxed">
          <span className="font-semibold">Remaining: </span>{completion.remaining}
        </p>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running': return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />;
    case 'done':    return <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />;
    case 'error':   return <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
    default:        return <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
  }
}
