import { useRef, useEffect } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useIdeStore } from '@/store/use-ide-store';
import { X, Save, FileCode2 } from 'lucide-react';
import { useWriteFile } from '@workspace/api-client-react';

export function CodeEditor() {
  const { openFiles, activeFilePath, setActiveFile, closeFile, updateFileContent, markFileClean } = useIdeStore();
  const activeFile = openFiles.find(f => f.path === activeFilePath);
  const monaco = useMonaco();
  const { mutate: saveFile } = useWriteFile();
  const editorRef = useRef<any>(null);

  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme('devmind-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#09090b',
          'editor.lineHighlightBackground': '#18181b',
        }
      });
      monaco.editor.setTheme('devmind-dark');
    }
  }, [monaco]);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    
    // Add Save shortcut (Ctrl+S / Cmd+S)
    editor.addCommand(monaco!.KeyMod.CtrlCmd | monaco!.KeyCode.KeyS, () => {
      handleSave();
    });
  };

  const handleSave = () => {
    if (activeFile && activeFile.isDirty) {
      saveFile({ 
        data: { path: activeFile.path, content: activeFile.content } 
      }, {
        onSuccess: () => {
          markFileClean(activeFile.path);
        }
      });
    }
  };

  if (openFiles.length === 0) {
    return (
      <div className="bg-background flex flex-col items-center justify-center text-muted-foreground" style={{ gridArea: 'editor' }}>
        <FileCode2 className="w-16 h-16 mb-4 opacity-20" />
        <p>Select a file to start editing</p>
      </div>
    );
  }

  return (
    <div className="bg-background flex flex-col border-b border-panel-border overflow-hidden" style={{ gridArea: 'editor' }}>
      {/* Editor Tabs */}
      <div className="flex bg-panel border-b border-panel-border overflow-x-auto hide-scrollbar">
        {openFiles.map(file => (
          <div 
            key={file.path}
            onClick={() => setActiveFile(file.path)}
            className={`flex items-center gap-2 px-4 py-2 border-r border-panel-border cursor-pointer min-w-max group select-none
              ${activeFilePath === file.path ? 'bg-background text-foreground border-t-2 border-t-primary' : 'bg-panel text-muted-foreground hover:bg-background/50 border-t-2 border-t-transparent'}`}
          >
            <span className="text-sm font-mono truncate max-w-[200px]">
              {file.path.split('/').pop()}
            </span>
            {file.isDirty && <div className="w-2 h-2 rounded-full bg-amber-500" />}
            <button 
              onClick={(e) => { e.stopPropagation(); closeFile(file.path); }}
              className={`p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-panel-border transition-all
                ${activeFilePath === file.path ? 'opacity-100' : ''}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 relative">
        {activeFile && (
          <Editor
            height="100%"
            path={activeFile.path}
            language={activeFile.language || 'plaintext'}
            value={activeFile.content}
            theme="devmind-dark"
            onChange={(value) => updateFileContent(activeFile.path, value || '')}
            onMount={handleEditorDidMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', monospace",
              padding: { top: 16 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
            }}
          />
        )}
      </div>
    </div>
  );
}
