import { useGetWorkspace } from '@workspace/api-client-react';
import { TopBar } from '@/components/layout/top-bar';
import { FileExplorer } from '@/components/panels/file-explorer';
import { CodeEditor } from '@/components/panels/code-editor';
import { OutputPanel } from '@/components/panels/output-panel';
import { TaskPanel } from '@/components/panels/task-panel';
import { WorkspaceSetupDialog } from '@/components/workspace-setup-dialog';
import { useWebSocket } from '@/hooks/use-websocket';
import { Loader2 } from 'lucide-react';

export default function IDEPage() {
  const { data: workspace, isLoading } = useGetWorkspace();
  
  // Initialize WebSocket connection for the whole IDE
  useWebSocket();

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-background flex flex-col items-center justify-center text-primary">
        <Loader2 className="w-10 h-10 animate-spin mb-4" />
        <p className="text-muted-foreground font-mono">Initializing VenomGPT...</p>
      </div>
    );
  }

  const needsSetup = !workspace?.isSet;

  return (
    <>
      <WorkspaceSetupDialog open={needsSetup} />
      
      {!needsSetup && (
        <div className="ide-grid bg-background text-foreground overflow-hidden">
          <TopBar />
          <FileExplorer />
          <CodeEditor />
          <OutputPanel />
          <TaskPanel />
        </div>
      )}
    </>
  );
}
