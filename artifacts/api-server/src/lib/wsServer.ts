import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { logger } from "./logger.js";
import type { AgentEvent, AgentTask } from "./sessionManager.js";

interface ServerMessage {
  type: "agent_event" | "task_updated" | "terminal_output" | "ping";
  taskId?: string;
  event?: AgentEvent;
  task?: AgentTask;
  data?: string;
}

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initWebSocketServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    logger.info("WebSocket client connected");

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      logger.info("WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket client error");
      clients.delete(ws);
    });

    ws.send(JSON.stringify({ type: "ping" }));
  });

  logger.info("WebSocket server initialized at /api/ws");
  return wss;
}

export function broadcast(message: ServerMessage): void {
  const json = JSON.stringify(message, null, 0);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

export function broadcastAgentEvent(taskId: string, event: AgentEvent): void {
  broadcast({ type: "agent_event", taskId, event });
}

export function broadcastTaskUpdate(task: AgentTask): void {
  broadcast({ type: "task_updated", task });
}

export function broadcastTerminalOutput(data: string): void {
  broadcast({ type: "terminal_output", data });
}
