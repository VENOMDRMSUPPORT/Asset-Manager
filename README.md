# DevMind AI — Local AI Coding Workspace

A browser-based personal AI coding assistant. Give it a task in plain English and it executes it end-to-end on your local codebase: reads files, edits code, runs commands, fixes errors, and reports results — without constant approval prompts.

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set ZAI_API_KEY (required)

# 3. Start both API server and frontend
pnpm run dev
```

Open **http://localhost:5173** in your browser. Enter a workspace directory path when prompted, then describe a task.

---

## Requirements

- **Node.js 20+**
- **pnpm** (`npm install -g pnpm`)
- **z.ai API key** (or any OpenAI-compatible provider)

### Windows — Git Bash or WSL required

The AI agent executes shell commands (npm, git, tsc, etc.) via bash. On Windows you must install one of:

- **Git Bash**: https://git-scm.com/download/win
- **WSL**: https://learn.microsoft.com/en-us/windows/wsl/install

The app itself runs fine on Windows — only the agent's bash commands require Git Bash or WSL. The in-app workspace setup dialog shows this warning automatically when Windows is detected.

---

## Local Development

### What `pnpm run dev` does

The root `dev` script uses `concurrently` to start two processes simultaneously:

| Process | Port | Description |
|---|---|---|
| API server | **3001** | Express + WebSocket, file tools, agent loop |
| Frontend (Vite) | **5173** | React IDE with Monaco editor |

Vite automatically proxies all `/api` and `/api/ws` traffic from port 5173 to the API server at port 3001. You access everything through **http://localhost:5173** only.

### API server hot-reload

The API server uses `tsx watch`, so it automatically restarts when you edit files in `artifacts/api-server/src/`.

### Frontend hot-reload

Vite's HMR updates the browser instantly on any frontend file change.

### Running services individually

```bash
# API server only (port 3001)
PORT=3001 pnpm --filter @workspace/api-server run dev

# Frontend only (port 5173, proxying to API on 3001)
PORT=5173 BASE_PATH=/ VITE_API_PORT=3001 pnpm --filter @workspace/workspace-ide run dev
```

---

## Configuration

Edit `.env` (copied from `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `ZAI_API_KEY` | **Yes** | — | Your z.ai API key |
| `ZAI_BASE_URL` | No | `https://api.z.ai/v1` | API base URL |
| `ZAI_MODEL` | No | `z1-32b` | Model name |
| `WORKSPACE_ROOT` | No | — | Pre-configure workspace directory |

You do **not** need to set `PORT` when using `pnpm run dev` — the root dev script sets `PORT=3001` for the API server and `PORT=5173` for the frontend automatically.

### Swapping the AI provider

Change these values in `.env` to use any OpenAI-compatible provider:

```env
# OpenAI
ZAI_BASE_URL=https://api.openai.com/v1
ZAI_API_KEY=sk-...
ZAI_MODEL=gpt-4o

# Local Ollama
ZAI_BASE_URL=http://localhost:11434/v1
ZAI_API_KEY=ollama
ZAI_MODEL=codellama
```

---

## Verification

After cloning, run these in order from the repo root:

```bash
pnpm install          # Install all dependencies
pnpm run test         # Run safety and model config tests (32 checks)
pnpm run typecheck    # TypeScript check across all packages
pnpm run dev          # Start API (port 3001) + frontend (port 5173)
```

Expected output from `pnpm run dev`:

```
[api] Server listening on port 3001
[ide] VITE ready in Xms ➜ Local: http://localhost:5173/
```

Open **http://localhost:5173** — you should see the workspace setup dialog.

---

## How the Agent Loop Works

When you submit a task, the agent executes up to 30 steps:

1. **Think** — reasons about the task and approach
2. **Inspect** — reads the file tree and relevant files before touching anything
3. **Edit** — writes files one at a time with full new content
4. **Verify** — runs build/lint/test commands and checks exit codes
5. **Fix** — if a command fails, reads the error and retries with a different approach
6. **Done** — sends a structured report: files changed, commands run, final status

All steps stream live to the browser via WebSocket.

**Task cancellation**: click Cancel while the agent is working.

---

## Architecture

```
Browser (React + Monaco, port 5173)
     │  HTTP /api/** → Vite proxy
     │  WebSocket /api/ws → Vite proxy
     ▼
API Server (Express, port 3001)
  ├── safety.ts         → workspace root scoping, command blocklist
  ├── fileTools.ts      → read / write / list / delete
  ├── terminal.ts       → shell commands (bash on Linux/Mac, cmd.exe on Windows)
  ├── modelAdapter.ts   → z.ai / OpenAI-compatible adapter
  ├── agentLoop.ts      → orchestrates full task execution (up to 30 steps)
  ├── sessionManager.ts → in-memory task storage + AbortController cancellation
  └── wsServer.ts       → WebSocket server at /api/ws
```

### WebSocket

The WebSocket endpoint is at `/api/ws`. Vite's dev proxy forwards WebSocket upgrades to this path through to the API server. The same path is used in production via Replit's infrastructure proxy.

---

## Project Structure

```
devmind-ai/
├── artifacts/
│   ├── api-server/           # Express API + agent backend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── safety.ts         # Path scoping + command blocklist
│   │       │   ├── fileTools.ts      # File operations
│   │       │   ├── terminal.ts       # Shell execution (cross-platform)
│   │       │   ├── modelAdapter.ts   # z.ai / OpenAI adapter
│   │       │   ├── agentLoop.ts      # Agent loop (30 steps max)
│   │       │   ├── sessionManager.ts # Task storage + cancellation
│   │       │   └── wsServer.ts       # WebSocket at /api/ws
│   │       └── routes/
│   │           ├── workspace.ts      # GET/POST /api/workspace
│   │           ├── files.ts          # /api/files (list/read/write/delete)
│   │           └── agent.ts          # POST/GET /api/agent/tasks + cancel
│   └── workspace-ide/        # React + Vite IDE frontend
│       ├── vite.config.ts    # Proxy config: /api → localhost:3001 (local only)
│       └── src/
│           ├── components/panels/    # FileExplorer, CodeEditor, OutputPanel, TaskPanel
│           ├── hooks/use-websocket.ts
│           └── store/use-ide-store.ts
├── lib/
│   ├── api-spec/             # OpenAPI spec + Orval codegen config
│   ├── api-client-react/     # Generated React Query hooks
│   └── api-zod/              # Generated Zod validation schemas
├── scripts/
│   └── src/
│       ├── test-safety.ts        # Path traversal + command blocklist tests
│       └── test-model-config.ts  # Model adapter config tests
├── .env.example              # Environment configuration template
└── README.md
```

---

## Root Scripts

| Script | Description |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm run dev` | Start API (3001) + frontend (5173) concurrently |
| `pnpm run test` | Run 32 automated safety + model config tests |
| `pnpm run typecheck` | TypeScript check across all packages |
| `pnpm run build` | Full production build (typecheck + esbuild) |

---

## Filesystem Safety

- All file operations are **strictly sandboxed** to the configured workspace root via `path.resolve` + prefix checks. No path traversal is possible.
- **Absolute paths** from the client are explicitly rejected — only relative paths are accepted.
- **URL-encoded traversal** (`..%2F..`) is decoded before checking.
- **Windows backslash traversal** (`..\..`) is normalized before checking.
- **System directories** (`/`, `/etc`, `C:\Windows`, etc.) are blocked as workspace roots.
- A blocklist of ~15 shell patterns blocks `rm -rf /`, fork bombs, `curl | bash`, `shutdown`, Windows `del /s`, and more.
- All commands run with the workspace root as their `cwd`.
- Command timeout defaults to 120 seconds; agent can request up to 300 seconds.

---

## Known Limitations

- **No API hot-reload without restart**: The `tsx watch` dev server restarts the API process on file changes. In-flight tasks are cancelled on restart.
- **No persistent storage**: Task history and workspace settings live in memory. Set `WORKSPACE_ROOT` in `.env` to auto-restore the workspace after a restart.
- **No interactive terminal**: The terminal panel shows command output but is not a PTY shell.
- **No file diff view**: The editor shows the final state of edited files.
- **No multi-workspace support**: One workspace root per server instance.
- **Windows bash requirement**: The agent's shell commands require Git Bash or WSL on Windows.
- **Context window pruning**: For very long tasks, old messages are pruned. The system prompt and last 8 messages are always kept.

---

## What Is Fully Working

- Four-panel IDE: file explorer, Monaco editor, agent activity panel, AI task panel
- Workspace directory picker with validation
- Full directory tree navigation in the file explorer
- Monaco editor: open, read, save files with syntax highlighting and Ctrl+S
- Files edited by the agent automatically refresh in the editor if open
- AI task panel: submit tasks, cancel mid-run, watch live streaming output
- Agent loop: real multi-step execution (plan → inspect → edit → verify → fix → summarize)
- Structured completion card showing files changed, commands run, final status
- WebSocket streaming: all agent events appear in real time
- Task history: view all past tasks and their status
- Task cancellation via AbortController
- Live connection status indicator in the top bar and AI panel
- Windows detection: shows Git Bash/WSL guidance in workspace setup dialog
