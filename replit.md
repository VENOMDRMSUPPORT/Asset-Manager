# VenomGPT — AI Coding Workspace

## Overview

A browser-based personal AI coding assistant. The user types a task in natural language and the system executes it end-to-end: reads files, edits code, runs commands, detects errors, and reports results without constant approval prompts.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (available but not required for MVP)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)
- **Frontend**: React + Vite, Monaco editor, Tailwind CSS, Zustand, TanStack Query, Wouter
- **Real-time**: WebSocket (`ws` package)
- **AI provider**: Z.AI (primary for all local usage), Replit OpenAI Integration (fallback only when no ZAI key)

## Architecture

```
Browser (React + Monaco)
     |  HTTP + WebSocket
     v
Local Node.js Server (Express, artifacts/api-server)
  ├── env-loader.ts              → loads .env from repo root (fixes monorepo dotenv path)
  ├── Safety Layer (lib/safety.ts)     → enforces workspace root scoping
  ├── File Tools (lib/fileTools.ts)    → read/write/create/delete files
  ├── Terminal (lib/terminal.ts)       → runs shell commands in workspace
  ├── Model Adapter (lib/modelAdapter.ts) → OpenAI-compatible (Replit integration or ZAI)
  ├── Agent Loop (lib/agentLoop.ts)    → orchestrates full task execution
  ├── Session Manager (lib/sessionManager.ts) → in-memory task storage, events (300-cap), failure details
  ├── Task Persistence (lib/taskPersistence.ts) → saves/loads ~/.venomgpt/history.json (max 100 tasks); migrates from legacy ~/.devmind on first run
  ├── Project Index (lib/projectIndex.ts) → file relevance scoring (TTL 60s, min score 2, max 15 files)
  ├── Response Normalizer (lib/responseNormalizer.ts) → JSON extraction + repair (trailing commas, comments, BOM)
  └── WS Server (lib/wsServer.ts)     → WebSocket for real-time streaming
```

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/           # Express API server + agent backend
│   │   └── src/
│   │       ├── env-loader.ts         # Loads .env from repo root (3 dirs up)
│   │       ├── lib/
│   │       │   ├── safety.ts         # Filesystem safety + workspace scoping
│   │       │   ├── fileTools.ts      # File read/write/list/delete
│   │       │   ├── terminal.ts       # Shell command execution
│   │       │   ├── modelAdapter.ts   # Dual-provider: Replit OpenAI or ZAI
│   │       │   ├── agentLoop.ts      # Agent orchestration loop (up to 30 steps)
│   │       │   ├── sessionManager.ts # In-memory task + event + failureDetail storage
│   │       │   └── wsServer.ts       # WebSocket broadcast server
│   │       └── routes/
│   │           ├── workspace.ts      # GET/POST /api/workspace
│   │           ├── files.ts          # /api/files (list/read/write/delete)
│   │           └── agent.ts          # POST/GET /api/agent/tasks
│   └── workspace-ide/        # React + Vite IDE frontend
│       └── src/
│           ├── components/
│           │   ├── panels/           # file-explorer, code-editor, output-panel, task-panel
│           │   └── layout/           # top-bar
│           ├── hooks/
│           │   └── use-websocket.ts  # WebSocket connection + event handling
│           ├── store/
│           │   └── use-ide-store.ts  # Zustand global IDE state
│           └── pages/
│               └── ide.tsx           # Main IDE page (four-panel layout)
├── lib/
│   ├── api-spec/             # OpenAPI spec + Orval codegen config
│   ├── api-client-react/     # Generated React Query hooks
│   └── api-zod/              # Generated Zod validation schemas
├── .env.example              # Environment configuration template
└── README.md                 # Full setup + run instructions
```

## Environment Variables

### In Replit (auto-configured, no manual setup needed)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Replit AI proxy URL (set by `setupReplitAIIntegrations`)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Replit AI proxy key (set by `setupReplitAIIntegrations`)

### In local `.env` file (for local dev without Replit)
- `ZAI_API_KEY` — z.ai API key (required for local agent to work)
- `ZAI_BASE_URL` — defaults to `https://api.z.ai/v1`
- `ZAI_MODEL` — model name override (defaults to `z1-32b` for ZAI, `gpt-5.2` for Replit)
- `WORKSPACE_ROOT` — optional pre-configured workspace directory
- `PORT` — server port (auto-assigned by Replit, defaults to 3001 locally)

**Important**: The `.env` file must live at the **repo root** (`/home/runner/workspace/.env`).
`env-loader.ts` uses `import.meta.url` to locate the repo root from the api-server package, regardless of `process.cwd()`.

## AI Provider Resolution

The model adapter checks providers in priority order:
1. **Replit OpenAI Integration** — uses `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`. Model: `gpt-5.2`
2. **ZAI (z.ai)** — uses `ZAI_API_KEY` + `ZAI_BASE_URL`. Model: `ZAI_MODEL` env var or `z1-32b`
3. **Error** — emits a structured `ModelError` with category `missing_api_key` if neither is set

Model errors are categorized: `missing_api_key | invalid_api_key | model_not_found | base_url_error | network_error | rate_limit | context_length | unexpected_response | unknown`

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`.

- **Always typecheck from the root** — run `pnpm run typecheck`.
- `emitDeclarationOnly` — only emit `.d.ts` files during typecheck.

## Root Scripts

- `pnpm run dev` — start API server (port 3001) + frontend (port 5173) concurrently via `concurrently`
- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build` then checks all packages including scripts
- `pnpm run test` — runs `scripts/src/test-safety.ts` and `scripts/src/test-model-config.ts` via tsx (33 total tests)
- `pnpm --filter @workspace/api-server run dev` — API server only (tsx watch, port from PORT env or default 3001)
- `pnpm --filter @workspace/workspace-ide run dev` — frontend only (Vite, port from PORT env or default 5173)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client and Zod schemas

## Local Dev Port Coordination

The root `dev` script always sets:
- `PORT=3001` for the API server
- `PORT=5173 BASE_PATH=/ VITE_API_PORT=3001` for the frontend

Vite proxies `/api` (HTTP) and `/api/ws` (WebSocket) from port 5173 to the API server at port 3001, **only when not in Replit** (`REPL_ID` is absent). In Replit, the infrastructure proxy handles `/api` routing directly.

## Task Observability

Each task in the session manager stores:
- `events[]` — full event stream (status, thought, file_read, file_write, command, command_output, error, done) — capped at 300 events per task
- `summary` — final human-readable summary
- `completion` — structured completion data (changed_files, commands_run, final_status, remaining)
- `failureDetail` — structured failure info (title, detail, step, category) — only on error status

Failure categories: `model | tool | command | workspace | orchestration | cancelled`

The UI surfaces failure details in:
- **Execution Feed panel** — stage-aware thought items with colored badges (PLANNING/INSPECTING/EDITING/VERIFYING/REPAIRING/WRAPPING UP), compact file ops, repair count + "verified" badge; red FailureCard with title, technical detail, step, and category badge
- **Task History** — expandable error detail per card showing failure category + message; clicking a historical task replays its events via `GET /api/agent/tasks/:id/events`

## Task Persistence

- Tasks are persisted to `~/.venomgpt/history.json` (canonical); configurable via `VENOMGPT_DATA_DIR` env var; `DEVMIND_DATA_DIR` is accepted as a legacy backward-compat alias only (not for new use)
- Max 100 tasks stored; loaded at server startup
- Frontend hydrates events on historical task click via `hydrateTaskEvents()` (one-fetch-per-task via `taskLogsLoaded` Set)

## Parse Recovery

`responseNormalizer.ts` extracts JSON from model responses using multiple strategies:
1. `json_block` — fenced code block extraction
2. `first_object` — regex-based first `{...}` extraction  
3. `json_repaired` — `tryRepairJson()` — strips trailing commas, JS comments, BOM before parsing

In the agent loop, parse failures on attempts 1–2 emit a quiet `status` event (not visible as an error card); only the final failed attempt shows a red error card.

## Agent Loop

The agent runs in a loop of up to 30 steps:
1. `think` — internal reasoning (no side effects)
2. `list_dir` — explore workspace file structure
3. `read_file` — read file contents before editing
4. `write_file` — apply changes one file at a time
5. `run_command` — execute shell commands in workspace context
6. `done` — report summary (complete | partial | blocked)

All steps stream in real time to the UI via WebSocket. Backend uses structured pino logging with `taskId`, `step`, `actionType`, `category` on every log line.

## WebSocket

- WebSocket server listens at `/api/ws` (not `/ws`) so Replit's proxy routes it correctly alongside all other `/api` traffic.
- Frontend connects to `${protocol}//${location.host}/api/ws`.
- Server sends a `ping` on connect; client responds to keep-alive.

## Safety Rules

- All file ops are scoped to `WORKSPACE_ROOT` via `path.resolve` + prefix checks
- Absolute paths from clients are explicitly rejected
- URL-encoded traversal (e.g. `..%2F..%2F`) is decoded and re-checked
- Windows backslash traversal (`..\..`) is normalized and checked
- Dangerous commands (`rm -rf /`, `mkfs`, `curl|bash`, etc.) blocked by ~15 regex patterns
- Commands run with workspace root as `cwd`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server with WebSocket. Handles all backend agent logic.

- `pnpm --filter @workspace/api-server run dev` — dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle

### `artifacts/workspace-ide` (`@workspace/workspace-ide`)

React + Vite IDE frontend with Monaco editor, four-panel layout.

- `pnpm --filter @workspace/workspace-ide run dev` — dev server

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI spec + codegen: `pnpm --filter @workspace/api-spec run codegen`
