import { useState } from 'react';
import { useSetWorkspace } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetWorkspaceQueryKey, getListFilesQueryKey } from '@workspace/api-client-react';
import { FolderGit2, Loader2, AlertTriangle, Terminal } from 'lucide-react';

interface WorkspaceSetupDialogProps {
  open: boolean;
}

const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

export function WorkspaceSetupDialog({ open }: WorkspaceSetupDialogProps) {
  const [root, setRoot] = useState('');
  const queryClient = useQueryClient();

  const { mutate: setWorkspace, isPending, error } = useSetWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
      },
    },
  });

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!root.trim()) return;
    setWorkspace({ data: { root: root.trim() } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-panel border border-panel-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-2 text-primary">
            <FolderGit2 className="w-8 h-8 shrink-0" />
            <h2 className="text-2xl font-bold text-foreground">Welcome to VenomGPT</h2>
          </div>
          <p className="text-muted-foreground mb-5 text-sm leading-relaxed">
            Set the local project folder the AI agent will read and edit. Choose a specific project directory, not a system root.
          </p>

          {isWindows && (
            <div className="mb-5 p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-amber-400">Windows detected — Git Bash or WSL required</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  The AI agent executes shell commands (npm, git, etc.) using bash. On Windows, this requires{' '}
                  <strong className="text-foreground">Git Bash</strong> or{' '}
                  <strong className="text-foreground">WSL (Windows Subsystem for Linux)</strong>{' '}
                  to be installed. cmd.exe alone will not work reliably.
                </p>
                <div className="flex gap-4 text-xs mt-1">
                  <a
                    href="https://git-scm.com/download/win"
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 hover:text-amber-300 underline flex items-center gap-1"
                  >
                    <Terminal className="w-3 h-3" />
                    Download Git Bash
                  </a>
                  <a
                    href="https://learn.microsoft.com/en-us/windows/wsl/install"
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 hover:text-amber-300 underline"
                  >
                    Install WSL
                  </a>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Workspace Root Path
              </label>
              <input
                type="text"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder={isWindows ? 'C:\\Users\\YourName\\projects\\my-app' : '/home/user/projects/my-app'}
                className="w-full px-4 py-2.5 bg-background border border-panel-border rounded-lg text-foreground font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                autoFocus
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {isWindows
                  ? 'Use the full Windows path. Git Bash paths like /c/Users/... also work.'
                  : 'Absolute path to your project directory.'}
              </p>
              {error && (
                <p className="mt-2 text-sm text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {error.message}
                </p>
              )}
            </div>

            <div className="flex justify-end pt-1">
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
