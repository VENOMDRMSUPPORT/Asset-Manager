import { useRef, useEffect } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useIdeStore } from '@/store/use-ide-store';
import type { OpenFile } from '@/store/use-ide-store';
import { X, FileCode2 } from 'lucide-react';
import { useWriteFile } from '@workspace/api-client-react';

export function CodeEditor() {
  const { openFiles, activeFilePath, setActiveFile, closeFile, updateFileContent, markFileClean } = useIdeStore();
  const activeFile = openFiles.find(f => f.path === activeFilePath);
  const monaco = useMonaco();
  const { mutate: saveFile } = useWriteFile();
  const editorRef = useRef<unknown>(null);

  const activeFileRef = useRef<OpenFile | undefined>(activeFile);
  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme('venomgpt-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#09090b',
          'editor.lineHighlightBackground': '#18181b',
          'editorLineNumber.foreground': '#3f3f46',
          'editorLineNumber.activeForeground': '#71717a',
        },
      });
      monaco.editor.setTheme('venomgpt-dark');
    }
  }, [monaco]);

  const handleSave = () => {
    const current = activeFileRef.current;
    if (current && current.isDirty) {
      saveFile(
        { data: { path: current.path, content: current.content } },
        { onSuccess: () => markFileClean(current.path) }
      );
    }
  };

  const handleEditorDidMount = (editor: unknown) => {
    editorRef.current = editor;
    if (!monaco) return;

    (editor as { addCommand: (keybinding: number, handler: () => void) => void }).addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => handleSave()
    );
  };

  if (openFiles.length === 0) {
    return (
      <div className="bg-background flex flex-col items-center justify-center text-muted-foreground" style={{ gridArea: 'editor' }}>
        <FileCode2 className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-sm">Select a file from the explorer to start editing</p>
      </div>
    );
  }

  return (
    <div className="bg-background flex flex-col border-b border-panel-border overflow-hidden" style={{ gridArea: 'editor' }}>
      <div className="flex bg-panel border-b border-panel-border overflow-x-auto hide-scrollbar">
        {openFiles.map(file => (
          <div
            key={file.path}
            onClick={() => setActiveFile(file.path)}
            className={`flex items-center gap-2 px-4 py-2 border-r border-panel-border cursor-pointer min-w-max group select-none
              ${activeFilePath === file.path
                ? 'bg-background text-foreground border-t-2 border-t-primary'
                : 'bg-panel text-muted-foreground hover:bg-background/50 border-t-2 border-t-transparent'}`}
          >
            <span className="text-sm font-mono truncate max-w-[200px]" title={file.path}>
              {file.path.split('/').pop()}
            </span>
            {file.isDirty && <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />}
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

      <div className="flex-1 relative">
        {activeFile && (
          <Editor
            height="100%"
            path={activeFile.path}
            language={activeFile.language || 'plaintext'}
            value={activeFile.content}
            theme="venomgpt-dark"
            onChange={(value) => updateFileContent(activeFile.path, value ?? '')}
            onMount={handleEditorDidMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              padding: { top: 16 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              bracketPairColorization: { enabled: true },
              wordWrap: 'off',
            }}
          />
        )}
      </div>
    </div>
  );
}
