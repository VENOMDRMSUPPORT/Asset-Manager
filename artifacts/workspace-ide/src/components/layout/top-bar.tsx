import { useState } from 'react';
import { useGetWorkspace, useSetWorkspace } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetWorkspaceQueryKey } from '@workspace/api-client-react';
import { TerminalSquare, FolderOpen, CheckCircle2, Edit2 } from 'lucide-react';
import { useIdeStore } from '@/store/use-ide-store';

export function TopBar() {
  const { data: workspace } = useGetWorkspace();
  const [isEditing, setIsEditing] = useState(false);
  const [editPath, setEditPath] = useState('');
  const queryClient = useQueryClient();
  const activeTaskId = useIdeStore(s => s.activeTaskId);

  const { mutate: setWorkspace } = useSetWorkspace({
    mutation: {
      onSuccess: () => {
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
      }
    }
  });

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editPath.trim() && editPath !== workspace?.root) {
      setWorkspace({ data: { root: editPath.trim() } });
    } else {
      setIsEditing(false);
    }
  };

  return (
    <header className="h-12 bg-panel border-b border-panel-border flex items-center justify-between px-4" style={{ gridArea: 'header' }}>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-primary font-bold tracking-tight">
          <TerminalSquare className="w-5 h-5" />
          <span>DevMind AI</span>
        </div>
        
        <div className="w-px h-5 bg-panel-border mx-2" />

        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={editPath}
              onChange={(e) => setEditPath(e.target.value)}
              className="px-2 py-1 text-sm bg-background border border-primary rounded text-foreground w-[300px] focus:outline-none"
              autoFocus
              onBlur={() => setIsEditing(false)}
            />
          </form>
        ) : (
          <button 
            onClick={() => {
              setEditPath(workspace?.root || '');
              setIsEditing(true);
            }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
          >
            <FolderOpen className="w-4 h-4" />
            <span className="font-mono">{workspace?.root || 'No workspace set'}</span>
            <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {activeTaskId && (
          <div className="flex items-center gap-2 text-xs font-medium text-amber-500 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            Agent Active
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="w-4 h-4 text-success" />
          System Ready
        </div>
      </div>
    </header>
  );
}
