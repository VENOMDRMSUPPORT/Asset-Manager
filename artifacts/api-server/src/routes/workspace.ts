import { Router, type IRouter } from "express";
import {
  getWorkspaceRoot,
  isWorkspaceSet,
  setWorkspaceRoot,
  validateWorkspaceRootExists,
} from "../lib/safety.js";

const router: IRouter = Router();

router.get("/workspace", (_req, res) => {
  const root = getWorkspaceRoot();
  res.json({ root, isSet: isWorkspaceSet() });
});

router.post("/workspace", (req, res) => {
  const { root } = req.body as { root?: string };

  if (!root || typeof root !== "string" || !root.trim()) {
    res.status(400).json({ error: "invalid_path", message: "root path is required" });
    return;
  }

  const trimmed = root.trim();

  if (!validateWorkspaceRootExists(trimmed)) {
    res.status(400).json({
      error: "invalid_path",
      message: `Directory does not exist or is not accessible: ${trimmed}`,
    });
    return;
  }

  setWorkspaceRoot(trimmed);
  const newRoot = getWorkspaceRoot();
  res.json({ root: newRoot, isSet: true });
});

export default router;
