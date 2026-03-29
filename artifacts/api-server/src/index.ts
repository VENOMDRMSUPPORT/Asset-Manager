import "./env-loader.js";
import http from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initWebSocketServer } from "./lib/wsServer.js";
import { setWorkspaceRoot } from "./lib/safety.js";
import { logProviderDiagnostic } from "./lib/modelAdapter.js";
import { initTaskPersistence, loadPersistedHistory } from "./lib/taskPersistence.js";
import { loadSettings } from "./lib/settingsStore.js";

const rawPort = process.env["PORT"] ?? "3001";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (process.env["WORKSPACE_ROOT"]) {
  setWorkspaceRoot(process.env["WORKSPACE_ROOT"]);
  logger.info({ root: process.env["WORKSPACE_ROOT"] }, "Workspace root initialized from env");
}

// Load operator settings first so all downstream modules see the correct values
await loadSettings();

// Register persistence hook before tasks can run, then load saved history
initTaskPersistence();
loadPersistedHistory().catch((err) => {
  logger.warn({ err }, "Could not load persisted task history — continuing without it");
});

logProviderDiagnostic();

const server = http.createServer(app);

initWebSocketServer(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
