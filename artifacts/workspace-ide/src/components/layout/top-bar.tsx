import { useState, useRef } from 'react';
import { useLocation } from 'wouter';
import { useGetWorkspace, useSetWorkspace } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetWorkspaceQueryKey, getListFilesQueryKey } from '@workspace/api-client-react';
import { TerminalSquare, FolderOpen, Edit2, Check, X, Wifi, WifiOff, Settings2 } from 'lucide-react';
import { useIdeStore } from '@/store/use-ide-store';

export function TopBar() {
  const [, navigate] = useLocation();
  const { data: workspace } = useGetWorkspace();
  const [isEditing, setIsEditing] = useState(false);
  const [editPath, setEditPath] = useState('');
  const [editError, setEditError] = useState('');
  const queryClient = useQueryClient();
  const activeTaskId = useIdeStore(s => s.activeTaskId);
  const isConnected = useIdeStore(s => s.isConnected);
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutate: setWorkspace, isPending } = useSetWorkspace({
    mutation: {
      onSuccess: () => {
        setIsEditing(false);
        setEditError('');
        queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
      },
      onError: (err) => {
        setEditError(err.message || 'Invalid path');
      },
    },
  });

  const startEditing = () => {
    setEditPath(workspace?.root || '');
    setEditError('');
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditError('');
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = editPath.trim();
    if (!trimmed) { cancelEditing(); return; }
    if (trimmed === workspace?.root) { cancelEditing(); return; }
    setWorkspace({ data: { root: trimmed } });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') cancelEditing();
  };

  return (
    <header className="h-12 bg-panel border-b border-panel-border flex items-center justify-between px-4" style={{ gridArea: 'header' }}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 text-primary font-bold tracking-tight shrink-0">
          <TerminalSquare className="w-5 h-5" />
          <span>VenomGPT</span>
        </div>

        <div className="w-px h-5 bg-panel-border mx-1 shrink-0" />

        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={editPath}
              onChange={(e) => { setEditPath(e.target.value); setEditError(''); }}
              onKeyDown={handleKeyDown}
              className={`px-2 py-1 text-sm bg-background border rounded text-foreground w-[280px] focus:outline-none focus:ring-1 transition-all
                ${editError ? 'border-destructive focus:ring-destructive' : 'border-primary focus:ring-primary'}`}
              placeholder="/path/to/project or C:\Users\Name\project"
              disabled={isPending}
              autoFocus
            />
            {editError && (
              <span className="text-xs text-destructive max-w-[180px] truncate" title={editError}>{editError}</span>
            )}
            <button type="submit" disabled={isPending} className="p-1.5 text-green-500 hover:bg-green-500/10 rounded transition-colors disabled:opacity-50" title="Save">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={cancelEditing} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded transition-colors" title="Cancel (Esc)">
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <button
            onClick={startEditing}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group min-w-0"
          >
            <FolderOpen className="w-4 h-4 shrink-0" />
            <span className="font-mono truncate max-w-[300px]">{workspace?.root || 'No workspace set — click to configure'}</span>
            <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {activeTaskId && (
          <div className="flex items-center gap-2 text-xs font-medium text-amber-500 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
            Agent Active
          </div>
        )}

        <div className={`flex items-center gap-1.5 text-xs ${isConnected ? 'text-muted-foreground' : 'text-red-400'}`} title={isConnected ? 'Backend connected' : 'Backend disconnected — check that the API server is running'}>
          {isConnected
            ? <Wifi className="w-3.5 h-3.5" />
            : <WifiOff className="w-3.5 h-3.5" />
          }
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>

        <button
          onClick={() => navigate('/settings')}
          title="Settings"
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded transition-colors"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
