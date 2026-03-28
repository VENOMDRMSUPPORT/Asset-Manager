import { useState, useMemo } from 'react';
import { useListFiles, FileEntry } from '@workspace/api-client-react';
import { useIdeStore, AgentLogEvent } from '@/store/use-ide-store';
import {
  ChevronRight, ChevronDown, FileCode, Folder, FolderOpen, RefreshCw,
  FileEdit, Cpu, CheckCircle2, Wrench, Search, Settings, Zap, Clock,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getListFilesQueryKey } from '@workspace/api-client-react';

// ─── Stage parsing (shared with output-panel) ─────────────────────────────────

const STAGE_TAGS = ['PLANNING', 'INSPECTING', 'EDITING', 'VERIFYING', 'REPAIRING', 'WRAPPING UP'] as const;
type StageTag = typeof STAGE_TAGS[number];

function parseStage(message: string): StageTag | null {
  const match = message.match(/^\[(PLANNING|INSPECTING|EDITING|VERIFYING|REPAIRING|WRAPPING UP)\]/i);
  return match ? (match[1].toUpperCase() as StageTag) : null;
}

const STAGE_STYLE: Record<StageTag, { color: string; bg: string; border: string; icon: React.FC<{ className?: string }> }> = {
  PLANNING:      { color: 'text-blue-400',    bg: 'bg-blue-400/10',    border: 'border-blue-400/20',    icon: Settings },
  INSPECTING:    { color: 'text-purple-400',  bg: 'bg-purple-400/10',  border: 'border-purple-400/20',  icon: Search },
  EDITING:       { color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', icon: FileEdit },
  VERIFYING:     { color: 'text-cyan-400',    bg: 'bg-cyan-400/10',    border: 'border-cyan-400/20',    icon: CheckCircle2 },
  REPAIRING:     { color: 'text-amber-400',   bg: 'bg-amber-400/10',   border: 'border-amber-400/20',   icon: Wrench },
  'WRAPPING UP': { color: 'text-green-400',   bg: 'bg-green-400/10',   border: 'border-green-400/20',   icon: CheckCircle2 },
};

// ─── Agent context derived from logs ─────────────────────────────────────────

function useAgentContext(logs: AgentLogEvent[]) {
  return useMemo(() => {
    const stage = logs.reduceRight<StageTag | null>((acc, l) => {
      if (acc !== null) return acc;
      if (l.type === 'thought') return parseStage(l.message);
      return null;
    }, null);

    const touchedFiles: string[] = [];
    const seen = new Set<string>();
    for (const l of logs) {
      if (l.type === 'file_write' && !seen.has(l.message)) {
        seen.add(l.message);
        touchedFiles.push(l.message);
      }
    }

    const isDone   = logs.some(l => l.type === 'done');
    const isError  = !isDone && logs.some(l => l.type === 'error' && l.data?.category);

    return { stage, touchedFiles, isDone, isError };
  }, [logs]);
}

// ─── Agent context sidebar section ───────────────────────────────────────────

function AgentContextSection({ logs, isLive }: { logs: AgentLogEvent[]; isLive: boolean }) {
  const { stage, touchedFiles, isDone, isError } = useAgentContext(logs);

  if (logs.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/40 text-center py-3 px-3">
        No active task
      </div>
    );
  }

  return (
    <div className="space-y-2 px-3 py-2">
      {/* Stage badge */}
      {isLive && stage && (() => {
        const s = STAGE_STYLE[stage];
        const Icon = s.icon;
        return (
          <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs ${s.bg} ${s.border}`}>
            <Icon className={`w-3 h-3 shrink-0 ${s.color}`} />
            <span className={`font-semibold uppercase tracking-widest text-[10px] ${s.color}`}>{stage}</span>
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-current animate-pulse opacity-70" />
          </div>
        );
      })()}

      {/* Terminal state when done */}
      {!isLive && isDone && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs bg-green-400/10 border-green-400/20">
          <CheckCircle2 className="w-3 h-3 shrink-0 text-green-400" />
          <span className="font-semibold uppercase tracking-widest text-[10px] text-green-400">Complete</span>
        </div>
      )}
      {!isLive && isError && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs bg-red-400/10 border-red-400/20">
          <Zap className="w-3 h-3 shrink-0 text-red-400" />
          <span className="font-semibold uppercase tracking-widest text-[10px] text-red-400">Failed</span>
        </div>
      )}
      {!isLive && !isDone && !isError && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs bg-muted/20 border-panel-border">
          <Clock className="w-3 h-3 shrink-0 text-muted-foreground" />
          <span className="font-semibold uppercase tracking-widest text-[10px] text-muted-foreground">Replaying</span>
        </div>
      )}

      {/* Touched files */}
      {touchedFiles.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5 px-1 flex items-center gap-1.5">
            <FileEdit className="w-3 h-3" />
            Files Written ({touchedFiles.length})
          </p>
          <ul className="space-y-0.5">
            {touchedFiles.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-emerald-400/5 group">
                <FileCode className="w-3 h-3 shrink-0 text-emerald-400/60 group-hover:text-emerald-400" />
                <span className="text-[11px] font-mono text-emerald-300/70 group-hover:text-emerald-300 truncate" title={f}>
                  {f.includes('/') ? f.split('/').pop() : f}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Main left panel ──────────────────────────────────────────────────────────

export function FileExplorer() {
  const { data, isLoading } = useListFiles();
  const queryClient = useQueryClient();

  const activeTaskId   = useIdeStore(s => s.activeTaskId);
  const viewingTaskId  = useIdeStore(s => s.viewingTaskId);
  const taskLogs       = useIdeStore(s => s.taskLogs);

  const contextTaskId  = viewingTaskId ?? activeTaskId;
  const contextLogs: AgentLogEvent[]    = (contextTaskId ? taskLogs[contextTaskId] : undefined) ?? [];
  const isLive         = activeTaskId !== null && activeTaskId === contextTaskId;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
  };

  return (
    <div className="bg-panel border-r border-panel-border flex flex-col overflow-hidden" style={{ gridArea: 'sidebar' }}>

      {/* ── Files section ─────────────────────────────────────────────── */}
      <div className="h-9 border-b border-panel-border flex items-center justify-between px-4 shrink-0">
        <h2 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Explorer</h2>
        <button onClick={handleRefresh} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-background" title="Refresh files">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-16 text-muted-foreground gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">Loading...</span>
          </div>
        ) : data?.entries ? (
          <div className="space-y-0.5">
            {data.entries.map((entry, idx) => (
              <TreeNode key={idx} entry={entry} depth={0} />
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground p-3 text-center">No files found</div>
        )}
      </div>

      {/* ── Agent Context section ─────────────────────────────────────── */}
      <div className="border-t border-panel-border shrink-0">
        <div className="h-8 flex items-center px-4 gap-2">
          <Cpu className={`w-3 h-3 ${isLive ? 'text-primary animate-pulse' : 'text-muted-foreground/50'}`} />
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Agent
          </h2>
          {isLive && (
            <span className="ml-auto text-[10px] text-primary/70 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Live
            </span>
          )}
        </div>
        <AgentContextSection logs={contextLogs} isLive={isLive} />
      </div>
    </div>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────────

function TreeNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const openFile = useIdeStore(s => s.openFile);
  const activeFilePath = useIdeStore(s => s.activeFilePath);
  const isDirectory = entry.type === 'directory';
  const isActive = activeFilePath === entry.path;

  const handleClick = async () => {
    if (isDirectory) {
      setIsOpen(!isOpen);
    } else {
      try {
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(entry.path)}`);
        if (res.ok) {
          const data = await res.json();
          openFile({ path: data.path, content: data.content, language: data.language, isDirty: false });
        }
      } catch (err) {
        console.error('Failed to read file', err);
      }
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-[3px] rounded cursor-pointer select-none text-sm transition-colors
          ${isActive ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-background'}`}
        style={{ paddingLeft: `${depth * 10 + 8}px` }}
        onClick={handleClick}
      >
        {isDirectory ? (
          <>
            {isOpen ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronRight className="w-3 h-3 opacity-60" />}
            {isOpen ? <FolderOpen className="w-3.5 h-3.5 text-primary" /> : <Folder className="w-3.5 h-3.5 text-primary" />}
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileCode className="w-3.5 h-3.5 opacity-50" />
          </>
        )}
        <span className="truncate text-[13px]">{entry.name}</span>
      </div>

      {isDirectory && isOpen && entry.children && (
        <div className="flex flex-col">
          {entry.children.map((child, idx) => (
            <TreeNode key={idx} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
