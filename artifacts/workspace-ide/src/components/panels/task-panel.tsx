import { useState, useCallback } from 'react';
import { useStartAgentTask, useListAgentTasks } from '@workspace/api-client-react';
import { useIdeStore } from '@/store/use-ide-store';
import { useGetWorkspace, useSetWorkspace } from '@workspace/api-client-react';
import {
  Bot, Sparkles, Send, Clock, CheckCircle2, Loader2, AlertCircle,
  X, ChevronDown, ChevronUp, Trash2, FolderOpen,
} from 'lucide-react';
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { getListAgentTasksQueryKey, getGetWorkspaceQueryKey, getListFilesQueryKey } from '@workspace/api-client-react';

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

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const d = intervalToDuration({ start: 0, end: ms });
  return formatDuration(d, { format: ['minutes', 'seconds'] });
}

export function TaskPanel() {
  const [prompt, setPrompt] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const setActiveTask = useIdeStore(s => s.setActiveTask);
  const clearActiveTask = useIdeStore(s => s.clearActiveTask);
  const activeTaskId = useIdeStore(s => s.activeTaskId);
  const isConnected = useIdeStore(s => s.isConnected);
  const queryClient = useQueryClient();

  const { data: historyData, isLoading: isLoadingHistory } = useListAgentTasks();
  const { data: workspace } = useGetWorkspace();

  const { mutate: startTask, isPending } = useStartAgentTask({
    mutation: {
      onSuccess: (data) => {
        setPrompt('');
        setActiveTask(data.taskId);
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

  const handleTaskClick = (task: TaskShape) => {
    setActiveTask(task.id);
    setExpandedTaskId(prev => prev === task.id ? null : task.id);
  };

  const isRunning = isPending || activeTaskId !== null;
  const tasks = (historyData?.tasks ?? []) as TaskShape[];

  return (
    <div className="bg-panel flex flex-col h-full overflow-hidden" style={{ gridArea: 'taskbar' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="h-12 border-b border-panel-border flex items-center px-4 shrink-0 bg-background/50">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <Bot className="w-4 h-4 text-primary" />
          AI Assistant
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-muted-foreground">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      {/* ── Scrollable middle: active task banner + task history ─────── */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">

        {/* Active task running banner */}
        {activeTaskId && (
          <div className="px-4 pt-3 pb-0 shrink-0">
            <div className="p-3 rounded-lg border border-primary/20 bg-primary/10 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-primary">
                <Sparkles className="w-4 h-4 animate-pulse" />
                <span>Agent is working…</span>
              </div>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive border border-panel-border hover:border-destructive/40 px-2 py-1 rounded-md transition-colors"
                title="Cancel running task"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Workspace quick-switch */}
        {workspace?.root && (
          <div className="px-4 pt-3 shrink-0">
            <button
              onClick={() => {
                const newPath = window.prompt('Enter workspace path:', workspace.root ?? '');
                if (newPath && newPath.trim() && newPath.trim() !== workspace.root) {
                  setWorkspace({ data: { root: newPath.trim() } });
                }
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground bg-background/40 hover:bg-background/80 border border-panel-border rounded-lg transition-colors"
              title="Click to switch workspace"
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0 text-primary/70" />
              <span className="font-mono truncate flex-1 text-left">{workspace.root}</span>
              <span className="text-primary/60 shrink-0">switch</span>
            </button>
          </div>
        )}

        {/* Task history */}
        <div className="flex-1 p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            Task History
            {tasks.length > 0 && (
              <span className="ml-auto text-muted-foreground/60 normal-case font-normal tracking-normal">
                {tasks.length} task{tasks.length !== 1 ? 's' : ''}
              </span>
            )}
          </h3>

          <div className="space-y-2">
            {isLoadingHistory ? (
              <div className="flex justify-center p-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center p-4 bg-background/50 rounded-lg border border-dashed border-panel-border">
                No tasks yet. Describe a task below to get started.
              </div>
            ) : (
              tasks.map((task) => {
                const isExpanded = expandedTaskId === task.id;
                const hasDetail = task.status === 'error'
                  ? !!(task.failureDetail?.title || task.summary)
                  : !!(task.completion?.summary || task.summary);

                return (
                  <div
                    key={task.id}
                    className={`rounded-lg border text-left transition-colors
                      ${activeTaskId === task.id ? 'bg-primary/10 border-primary/30' : 'bg-background hover:bg-panel-border/50 border-panel-border'}`}
                  >
                    <div
                      className="p-3 cursor-pointer"
                      onClick={() => handleTaskClick(task)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug flex-1">
                          {task.prompt}
                        </p>
                        <div className="flex items-center gap-1 shrink-0">
                          <StatusIcon status={task.status} />
                          {hasDetail && (
                            isExpanded
                              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          {task.status !== 'running' && (
                            <button
                              onClick={(e) => handleDelete(task.id, e)}
                              disabled={deletingId === task.id}
                              className="p-0.5 text-muted-foreground/50 hover:text-destructive rounded transition-colors disabled:opacity-40"
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
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}</span>
                        <div className="flex items-center gap-2">
                          {task.durationMs != null && task.status !== 'running' && (
                            <span className="text-muted-foreground/60">{formatMs(task.durationMs)}</span>
                          )}
                          <span className="capitalize">{task.status}</span>
                        </div>
                      </div>
                    </div>

                    {isExpanded && hasDetail && (
                      <div className="px-3 pb-3 border-t border-panel-border/50 pt-2.5 space-y-2">
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

      {/* ── Fixed bottom composer ────────────────────────────────────────── */}
      <div className="border-t border-panel-border p-4 shrink-0 bg-background/30">
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Agent is working…' : 'Describe what you want to build or fix.\n⌘/Ctrl+Enter to submit.'}
            className="w-full h-28 bg-background border border-panel-border rounded-xl p-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none transition-all"
            disabled={isRunning}
          />
          <div className="absolute bottom-3 right-3">
            <button
              type="submit"
              disabled={!prompt.trim() || isRunning}
              className="p-2 bg-primary text-primary-foreground rounded-lg shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all group"
              title="Submit (⌘/Ctrl+Enter)"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ErrorDetail({ failure }: { failure: TaskFailureDetail }) {
  const categoryLabel: Record<string, string> = {
    model: 'AI Provider',
    missing_api_key: 'Missing Key',
    invalid_api_key: 'Invalid Key',
    model_not_found: 'Model Not Found',
    insufficient_balance: 'Insufficient Balance',
    rate_limit: 'Rate Limited',
    network_error: 'Network Error',
    base_url_error: 'Bad URL',
    context_length: 'Context Too Long',
    tool: 'Tool',
    command: 'Command',
    workspace: 'Workspace',
    orchestration: 'Internal',
    cancelled: 'Cancelled',
  };

  return (
    <div className="space-y-1.5">
      {failure.category && (
        <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full inline-block">
          {categoryLabel[failure.category] ?? failure.category} error
        </span>
      )}
      {failure.title && (
        <p className="text-xs text-red-300 font-medium leading-snug">{failure.title}</p>
      )}
      {failure.detail && (
        <pre className="text-xs text-red-400/80 bg-red-400/5 border border-red-400/10 rounded p-2 whitespace-pre-wrap break-words font-mono leading-relaxed">
          {failure.detail}
        </pre>
      )}
    </div>
  );
}

function SuccessDetail({ completion }: { completion: TaskCompletion }) {
  return (
    <div className="space-y-1.5">
      {completion.summary && (
        <p className="text-xs text-muted-foreground leading-relaxed">{completion.summary}</p>
      )}
      {completion.changed_files && completion.changed_files.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {completion.changed_files.map((f, i) => (
            <span key={i} className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
              {f}
            </span>
          ))}
        </div>
      )}
      {completion.remaining && (
        <p className="text-xs text-amber-400">{completion.remaining}</p>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
    case 'done':
      return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
    case 'error':
      return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}
