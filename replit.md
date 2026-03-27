# DevMind AI — Local AI Coding Workspace

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
- **AI provider**: z.ai (OpenAI-compatible, swappable via env vars)

## Architecture

```
Browser (React + Monaco)
     |  HTTP + WebSocket
     v
Local Node.js Server (Express, artifacts/api-server)
  ├── Safety Layer (lib/safety.ts)     → enforces workspace root scoping
  ├── File Tools (lib/fileTools.ts)    → read/write/create/delete files
  ├── Terminal (lib/terminal.ts)       → runs shell commands in workspace
  ├── Model Adapter (lib/modelAdapter.ts) → z.ai (OpenAI-compatible API)
  ├── Agent Loop (lib/agentLoop.ts)    → orchestrates full task execution
  ├── Session Manager (lib/sessionManager.ts) → in-memory task storage
  └── WS Server (lib/wsServer.ts)     → WebSocket for real-time streaming
```

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/           # Express API server + agent backend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── safety.ts         # Filesystem safety + workspace scoping
│   │       │   ├── fileTools.ts      # File read/write/list/delete
│   │       │   ├── terminal.ts       # Shell command execution
│   │       │   ├── modelAdapter.ts   # z.ai/OpenAI adapter
│   │       │   ├── agentLoop.ts      # Agent orchestration loop (up to 30 steps)
│   │       │   ├── sessionManager.ts # In-memory task + event storage
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

Required in `.env`:
- `ZAI_API_KEY` — z.ai API key (required for agent to work)
- `ZAI_BASE_URL` — defaults to `https://api.z.ai/v1`
- `ZAI_MODEL` — defaults to `z1-32b`
- `WORKSPACE_ROOT` — optional pre-configured workspace directory
- `PORT` — server port (auto-assigned by Replit)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`.

- **Always typecheck from the root** — run `pnpm run typecheck`.
- `emitDeclarationOnly` — only emit `.d.ts` files during typecheck.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-server run dev` — run API server in dev mode
- `pnpm --filter @workspace/workspace-ide run dev` — run frontend in dev mode
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client and Zod schemas

## Agent Loop

The agent runs in a loop of up to 30 steps:
1. `think` — internal reasoning (no side effects)
2. `list_dir` — explore workspace file structure
3. `read_file` — read file contents before editing
4. `write_file` — apply changes one file at a time
5. `run_command` — execute shell commands in workspace context
6. `done` — report summary

All steps stream in real time to the UI via WebSocket.

## Safety Rules

- All file ops are scoped to `WORKSPACE_ROOT` via `path.resolve` + prefix checks
- Dangerous commands (`rm -rf /`, `mkfs`, etc.) are blocked by regex
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
