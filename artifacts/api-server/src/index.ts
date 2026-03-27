import "dotenv/config";
import http from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initWebSocketServer } from "./lib/wsServer.js";
import { setWorkspaceRoot } from "./lib/safety.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (process.env["WORKSPACE_ROOT"]) {
  setWorkspaceRoot(process.env["WORKSPACE_ROOT"]);
  logger.info({ root: process.env["WORKSPACE_ROOT"] }, "Workspace root initialized from env");
}

const server = http.createServer(app);

initWebSocketServer(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
