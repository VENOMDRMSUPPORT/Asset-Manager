import { useState } from 'react';
import { useListFiles, useReadFile, FileEntry } from '@workspace/api-client-react';
import { useIdeStore } from '@/store/use-ide-store';
import { ChevronRight, ChevronDown, FileCode, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getListFilesQueryKey } from '@workspace/api-client-react';

export function FileExplorer() {
  const { data, isLoading } = useListFiles();
  const queryClient = useQueryClient();
  
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
  };

  return (
    <div className="bg-panel border-r border-panel-border flex flex-col overflow-hidden" style={{ gridArea: 'sidebar' }}>
      <div className="h-10 border-b border-panel-border flex items-center justify-between px-4 shrink-0">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Explorer</h2>
        <button onClick={handleRefresh} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-background">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-20 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            <span className="text-sm">Loading workspace...</span>
          </div>
        ) : data?.entries ? (
          <div className="space-y-0.5">
            {data.entries.map((entry, idx) => (
              <TreeNode key={idx} entry={entry} depth={0} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground p-2 text-center">
            No files found
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({ entry, depth }: { entry: FileEntry, depth: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const openFile = useIdeStore(s => s.openFile);
  const activeFilePath = useIdeStore(s => s.activeFilePath);
  const isDirectory = entry.type === 'directory';
  const isActive = activeFilePath === entry.path;

  // We fetch file content lazily when clicked if it's a file
  // To avoid useQuery unconditionally violating rules of hooks, we fetch imperatively or use enabled flag.
  const queryClient = useQueryClient();

  const handleClick = async () => {
    if (isDirectory) {
      setIsOpen(!isOpen);
    } else {
      try {
        // Fetch file content via fetch or queryClient directly to avoid hook conditional rendering issues inside mapping
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(entry.path)}`);
        if (res.ok) {
          const data = await res.json();
          openFile({
            path: data.path,
            content: data.content,
            language: data.language,
            isDirty: false
          });
        }
      } catch (err) {
        console.error("Failed to read file", err);
      }
    }
  };

  return (
    <div>
      <div 
        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm transition-colors
          ${isActive ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-background'}`}
        style={{ paddingLeft: `${(depth * 12) + 8}px` }}
        onClick={handleClick}
      >
        {isDirectory ? (
          <>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 opacity-70" /> : <ChevronRight className="w-3.5 h-3.5 opacity-70" />}
            {isOpen ? <FolderOpen className="w-4 h-4 text-primary" /> : <Folder className="w-4 h-4 text-primary" />}
          </>
        ) : (
          <>
            <span className="w-3.5" /> {/* spacer for alignment */}
            <FileCode className="w-4 h-4 opacity-70" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
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
