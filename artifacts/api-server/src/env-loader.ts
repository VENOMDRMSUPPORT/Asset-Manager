import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// Load .env from the monorepo root regardless of process.cwd().
// import.meta.url points to this file (src/env-loader.ts in dev, dist/env-loader.js in prod).
// Three directories up from src/ or dist/ reaches the repo root.
const _dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(_dir, "../../..");

// Load .env without overriding variables already set by the OS/platform (Replit secrets, CI, etc.)
const result = config({ path: path.join(repoRoot, ".env"), override: false });

if (result.parsed) {
  const keyCount = Object.keys(result.parsed).length;
  console.log(`[env-loader] Loaded ${keyCount} variable(s) from ${path.join(repoRoot, ".env")}`);
} else if (result.error) {
  // Not an error in production or Replit (env vars come from the platform)
  console.log(`[env-loader] No .env file found at ${path.join(repoRoot, ".env")} — relying on process environment`);
}
