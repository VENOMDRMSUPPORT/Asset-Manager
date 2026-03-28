import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// ── Body parser limits ─────────────────────────────────────────────────────────
// Screenshots arrive as base64 data URLs inside the JSON body.  Even with
// client-side JPEG compression (max 1280 px, 85 % quality), a single screenshot
// is typically 150–350 KB as base64.  Five images → ≤ 2.5 MB, well inside 30 MB.
// We set the limit intentionally rather than using the 100 KB default, which
// triggers 413 for any real screenshot.  The per-image cap (routes/agent.ts)
// provides the hard safety guard; this just ensures the transport layer accepts
// the body.
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ limit: "30mb", extended: true }));

app.use("/api", router);

export default app;
