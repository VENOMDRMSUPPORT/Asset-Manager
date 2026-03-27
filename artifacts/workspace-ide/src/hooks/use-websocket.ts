import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useIdeStore } from '@/store/use-ide-store';
import { getListAgentTasksQueryKey, getListFilesQueryKey } from '@workspace/api-client-react';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const appendTerminalOutput = useIdeStore(s => s.appendTerminalOutput);
  const appendAgentLog = useIdeStore(s => s.appendAgentLog);
  const activeTaskId = useIdeStore(s => s.activeTaskId);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to workspace server');
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          switch (payload.type) {
            case 'terminal_output':
              if (payload.data) {
                appendTerminalOutput(payload.data);
              }
              break;
              
            case 'agent_event':
              if (payload.event) {
                appendAgentLog(payload.event);
                
                // If it's a file write or done event, invalidate file list
                if (['file_write', 'done'].includes(payload.event.type)) {
                  queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
                }
              }
              break;

            case 'task_updated':
              // Invalidate task list when a task status changes
              queryClient.invalidateQueries({ queryKey: getListAgentTasksQueryKey() });
              break;
          }
        } catch (err) {
          console.error('[WS] Failed to parse message', err);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 2s...');
        reconnectTimeout = setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error('[WS] Error', err);
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [queryClient, appendTerminalOutput, appendAgentLog]);

  return {
    ws: wsRef.current,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN
  };
}
