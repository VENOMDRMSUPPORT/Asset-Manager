import { Router, type IRouter } from "express";
import type { Response } from "express";
import {
  listDirectory,
  readFile,
  writeFile,
  deleteFile,
} from "../lib/fileTools.js";
import { SafetyError, isWorkspaceSet, getWorkspaceRoot } from "../lib/safety.js";

const router: IRouter = Router();

function safetyCheck(res: Response): boolean {
  if (!isWorkspaceSet()) {
    res.status(400).json({
      error: "no_workspace",
      message: "Workspace root is not configured. Set it via POST /api/workspace",
    });
    return false;
  }
  return true;
}

router.get("/files", async (req, res) => {
  if (!safetyCheck(res)) return;
  const { path: rawPath } = req.query as { path?: string };
  try {
    const entries = await listDirectory(rawPath || "");
    res.json({ entries, workspaceRoot: getWorkspaceRoot() });
  } catch (err) {
    const msg = err instanceof SafetyError ? err.message : String(err);
    res.status(400).json({ error: "file_error", message: msg });
  }
});

router.get("/files/read", async (req, res) => {
  if (!safetyCheck(res)) return;
  const { path: rawPath } = req.query as { path?: string };

  if (!rawPath) {
    res.status(400).json({ error: "missing_param", message: "path query parameter is required" });
    return;
  }

  try {
    const { content, language } = await readFile(rawPath);
    res.json({ path: rawPath, content, language });
  } catch (err) {
    if (err instanceof SafetyError) {
      res.status(400).json({ error: "safety_error", message: err.message });
    } else if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "not_found", message: `File not found: ${rawPath}` });
    } else {
      res.status(400).json({ error: "file_error", message: String(err) });
    }
  }
});

router.post("/files/write", async (req, res) => {
  if (!safetyCheck(res)) return;
  const { path: rawPath, content } = req.body as { path?: string; content?: string };

  if (!rawPath || content === undefined) {
    res.status(400).json({ error: "missing_param", message: "path and content are required" });
    return;
  }

  try {
    await writeFile(rawPath, content);
    res.json({ success: true, message: `File written: ${rawPath}` });
  } catch (err) {
    const msg = err instanceof SafetyError ? err.message : String(err);
    res.status(400).json({ error: "file_error", message: msg });
  }
});

router.delete("/files/delete", async (req, res) => {
  if (!safetyCheck(res)) return;
  const { path: rawPath } = req.query as { path?: string };

  if (!rawPath) {
    res.status(400).json({ error: "missing_param", message: "path query parameter is required" });
    return;
  }

  try {
    await deleteFile(rawPath);
    res.json({ success: true, message: `Deleted: ${rawPath}` });
  } catch (err) {
    const msg = err instanceof SafetyError ? err.message : String(err);
    res.status(400).json({ error: "file_error", message: msg });
  }
});

export default router;
