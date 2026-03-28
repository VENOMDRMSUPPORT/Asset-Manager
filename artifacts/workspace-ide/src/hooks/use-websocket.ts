import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useIdeStore } from '@/store/use-ide-store';
import { getListAgentTasksQueryKey, getListFilesQueryKey } from '@workspace/api-client-react';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  const appendTerminalOutput = useIdeStore(s => s.appendTerminalOutput);
  const appendAgentLog      = useIdeStore(s => s.appendAgentLog);
  const clearActiveTask     = useIdeStore(s => s.clearActiveTask);
  const openFile            = useIdeStore(s => s.openFile);
  const setConnected        = useIdeStore(s => s.setConnected);

  // Track openFiles and activeTaskId via refs so the WS message handler
  // always has the current value without needing to be rebuilt on every change.
  const openFiles    = useIdeStore(s => s.openFiles);
  const activeTaskId = useIdeStore(s => s.activeTaskId);

  const openFilesRef    = useRef(openFiles);
  const activeTaskIdRef = useRef(activeTaskId);
  openFilesRef.current    = openFiles;
  activeTaskIdRef.current = activeTaskId;

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
              const ev = payload.event as {
                type: string;
                message: string;
                timestamp: string;
                data?: Record<string, unknown>;
              };

              // Append to the running task's log bucket.
              // Use ref so we always see the current taskId even inside a stale closure.
              const runningTaskId = activeTaskIdRef.current;
              if (runningTaskId) {
                appendAgentLog(runningTaskId, ev);
              }

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
                    // File refresh failed silently — user can re-open manually
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
                // Unlock the composer. viewingTaskId is intentionally kept so the
                // output panel continues showing the just-finished task's log.
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

      ws.onerror = () => { ws.close(); };
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
