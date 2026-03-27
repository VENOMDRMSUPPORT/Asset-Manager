import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useIdeStore } from '@/store/use-ide-store';
import { getListAgentTasksQueryKey, getListFilesQueryKey } from '@workspace/api-client-react';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  const appendTerminalOutput = useIdeStore(s => s.appendTerminalOutput);
  const appendAgentLog = useIdeStore(s => s.appendAgentLog);
  const setActiveTask = useIdeStore(s => s.setActiveTask);
  const clearActiveTask = useIdeStore(s => s.clearActiveTask);
  const openFile = useIdeStore(s => s.openFile);
  const openFiles = useIdeStore(s => s.openFiles);
  const setConnected = useIdeStore(s => s.setConnected);

  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;

  useEffect(() => {
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!unmounted) {
          setConnected(true);
          console.log('[WS] Connected');
        }
      };

      ws.onmessage = async (event) => {
        if (unmounted) return;
        try {
          const payload = JSON.parse(event.data as string);

          switch (payload.type) {
            case 'terminal_output':
              if (payload.data) appendTerminalOutput(payload.data as string);
              break;

            case 'agent_event': {
              if (!payload.event) break;
              const ev = payload.event as { type: string; message: string; timestamp: string; data?: Record<string, unknown> };
              appendAgentLog(ev);

              if (ev.type === 'file_write' && ev.data?.path) {
                const writtenPath = String(ev.data.path);
                const isOpen = openFilesRef.current.some(f => f.path === writtenPath);
                if (isOpen) {
                  try {
                    const res = await fetch(`/api/files/read?path=${encodeURIComponent(writtenPath)}`);
                    if (res.ok) {
                      const fileData = await res.json() as { path: string; content: string; language: string };
                      openFile({ path: fileData.path, content: fileData.content, language: fileData.language, isDirty: false });
                    }
                  } catch {
                    // File refresh failed silently — user can re-open
                  }
                }
                queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
              }

              if (ev.type === 'done') {
                queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
              }
              break;
            }

            case 'task_updated': {
              queryClient.invalidateQueries({ queryKey: getListAgentTasksQueryKey() });
              const updatedTask = payload.task as { id: string; status: string } | undefined;
              if (updatedTask && (updatedTask.status === 'done' || updatedTask.status === 'error')) {
                clearActiveTask();
              }
              break;
            }
          }
        } catch (err) {
          console.error('[WS] Failed to parse message', err);
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnected(false);
        console.log('[WS] Disconnected, reconnecting in 2s…');
        reconnectTimeoutRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      setConnected(false);
    };
  }, [appendTerminalOutput, appendAgentLog, clearActiveTask, openFile, setConnected, queryClient]);

  return { ws: wsRef.current };
}
