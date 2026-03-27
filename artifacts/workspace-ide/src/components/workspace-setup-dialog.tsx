import { useState } from 'react';
import { useSetWorkspace } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetWorkspaceQueryKey } from '@workspace/api-client-react';
import { FolderGit2, Loader2 } from 'lucide-react';

interface WorkspaceSetupDialogProps {
  open: boolean;
}

export function WorkspaceSetupDialog({ open }: WorkspaceSetupDialogProps) {
  const [root, setRoot] = useState('');
  const queryClient = useQueryClient();
  
  const { mutate: setWorkspace, isPending, error } = useSetWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
      }
    }
  });

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!root.trim()) return;
    setWorkspace({ data: { root: root.trim() } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-panel border border-panel-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4 text-primary">
            <FolderGit2 className="w-8 h-8" />
            <h2 className="text-2xl font-bold text-foreground">Welcome to DevMind</h2>
          </div>
          <p className="text-muted-foreground mb-6">
            To get started, please configure the local directory you want the AI to work in.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Workspace Root Path
              </label>
              <input
                type="text"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="/home/user/projects/my-app"
                className="w-full px-4 py-2.5 bg-background border border-panel-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                autoFocus
              />
              {error && (
                <p className="mt-2 text-sm text-destructive">{error.message}</p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isPending || !root.trim()}
                className="px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Set Workspace
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
