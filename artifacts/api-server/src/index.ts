import "./env-loader.js";
import http from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initWebSocketServer } from "./lib/wsServer.js";
import { setWorkspaceRoot } from "./lib/safety.js";
import { logProviderDiagnostic } from "./lib/modelAdapter.js";

const rawPort = process.env["PORT"] ?? "3001";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (process.env["WORKSPACE_ROOT"]) {
  setWorkspaceRoot(process.env["WORKSPACE_ROOT"]);
  logger.info({ root: process.env["WORKSPACE_ROOT"] }, "Workspace root initialized from env");
}

logProviderDiagnostic();

const server = http.createServer(app);

initWebSocketServer(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
