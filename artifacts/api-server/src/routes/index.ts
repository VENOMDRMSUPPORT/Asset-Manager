import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import workspaceRouter from "./workspace.js";
import filesRouter from "./files.js";
import agentRouter from "./agent.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workspaceRouter);
router.use(filesRouter);
router.use(agentRouter);

export default router;
