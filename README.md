# DevMind AI — Local AI Coding Workspace

A browser-based personal AI coding assistant. Give it a natural language task and it executes it end-to-end on your local codebase: reads files, edits code, runs commands, detects errors, and reports results — without constant approval prompts.

---

## Architecture

**Browser-based web app** (not a desktop app):

- A React + Vite frontend with Monaco editor running in your browser.
- A Node.js/Express backend running locally that does all the real work: filesystem access, terminal execution, and AI model calls.
- WebSocket for real-time streaming of agent output.
- z.ai as the default AI model provider (OpenAI-compatible API, swappable).

```
Browser (React + Monaco)
     |  HTTP + WebSocket
     v
Local Node.js Server (Express)
  ├── Safety Layer        → enforces workspace root scoping
  ├── File Tools          → read, write, create, delete files
  ├── Terminal Tool       → runs shell commands in workspace
  ├── Model Adapter       → calls z.ai (OpenAI-compatible)
  └── Agent Loop          → orchestrates the full task execution
```

---

## Requirements

- Node.js 18+ (or 20+)
- pnpm (`npm install -g pnpm`)
- A z.ai API key (or another OpenAI-compatible provider)

---

## Setup (Windows)

```cmd
# 1. Clone the repo and enter it
git clone <repo-url>
cd devmind-ai

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
copy .env.example .env
# Open .env in Notepad and fill in your ZAI_API_KEY
notepad .env

# 4. Start the development server
pnpm run dev
```

Open http://localhost:3000 in your browser.

---

## Setup (Mac / Linux)

```bash
git clone <repo-url>
cd devmind-ai
pnpm install
cp .env.example .env
# Edit .env with your ZAI_API_KEY
pnpm run dev
```

Open http://localhost:3000 in your browser.

---

## Configuration

Edit `.env`:

| Variable | Required | Description |
|---|---|---|
| `ZAI_API_KEY` | Yes | Your z.ai API key |
| `ZAI_BASE_URL` | No | API base URL (default: `https://api.z.ai/v1`) |
| `ZAI_MODEL` | No | Model name (default: `z1-32b`) |
| `WORKSPACE_ROOT` | No | Pre-configure your workspace directory |
| `PORT` | No | Server port (default: `3000`) |

### Swapping the AI Model Provider

The model adapter is in `artifacts/api-server/src/lib/modelAdapter.ts`. It uses an OpenAI-compatible interface. To switch providers:

1. Change `ZAI_BASE_URL` in `.env` to your provider's endpoint.
2. Change `ZAI_API_KEY` to your key.
3. Change `ZAI_MODEL` to the model name.

Examples:
- **OpenAI**: `ZAI_BASE_URL=https://api.openai.com/v1`, `ZAI_MODEL=gpt-4o`
- **Local Ollama**: `ZAI_BASE_URL=http://localhost:11434/v1`, `ZAI_MODEL=codellama`

---

## How the Agent Loop Works

When you submit a task, the agent executes this loop (up to 30 steps):

1. **Think** — Reasons about the task internally.
2. **List directory** — Explores the workspace file structure.
3. **Read files** — Reads relevant files before editing.
4. **Write files** — Applies changes one file at a time.
5. **Run commands** — Executes shell commands (npm install, build, test, etc.) in the workspace directory.
6. **Read errors** — If a command fails, reads the output and attempts a fix.
7. **Done** — Reports a summary of what changed and what's left.

All steps are streamed live to the UI via WebSocket.

---

## Filesystem Safety Rules

- **All file operations are strictly sandboxed** to the configured workspace root using `path.resolve` + prefix checks. No operation can escape the workspace directory.
- Attempts to access paths outside the workspace return a 400 error.
- Dangerous shell commands (`rm -rf /`, `mkfs`, `dd if=...of=/dev/...`) are blocked by a regex blocklist.
- Commands run with the workspace root as their `cwd`, so relative commands stay inside the project.

---

## Project Structure

```
devmind-ai/
├── artifacts/
│   ├── api-server/           # Node.js backend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── safety.ts         # Filesystem safety + workspace scoping
│   │       │   ├── fileTools.ts      # File read/write/list/delete
│   │       │   ├── terminal.ts       # Shell command execution
│   │       │   ├── modelAdapter.ts   # z.ai / OpenAI-compatible adapter
│   │       │   ├── agentLoop.ts      # Agent orchestration loop
│   │       │   ├── sessionManager.ts # In-memory task storage
│   │       │   └── wsServer.ts       # WebSocket server
│   │       └── routes/
│   │           ├── workspace.ts      # GET/POST /api/workspace
│   │           ├── files.ts          # File operation routes
│   │           └── agent.ts          # Agent task routes
│   └── workspace-ide/        # React + Vite frontend (Monaco IDE)
├── lib/
│   ├── api-spec/             # OpenAPI spec + codegen config
│   ├── api-client-react/     # Generated React Query hooks
│   └── api-zod/              # Generated Zod validation schemas
├── .env.example              # Environment variable template
└── README.md                 # This file
```

---

## What Is Fully Working

- Four-panel IDE layout: file explorer, Monaco editor, output/terminal panel, AI task panel.
- Workspace directory picker — configure any local folder.
- File explorer with directory tree navigation.
- Monaco editor — open, read, and save files with syntax highlighting.
- AI task panel — submit a task and receive live streaming updates.
- Agent loop — real multi-step execution: think, read, write, run, fix, summarize.
- WebSocket streaming — all agent events appear in real time in the UI.
- Task history — view all past tasks and their event logs.
- Filesystem safety — strict workspace root scoping, no path traversal possible.
- z.ai integration — uses the OpenAI-compatible API, fully swappable.

## What Is Partially Implemented

- Terminal panel shows agent command output. A fully interactive PTY terminal (like a real shell) would require `node-pty` (native addon). This uses `child_process.spawn` which covers 95% of real use cases.
- File diff view — Monaco can show diffs but the UI shows the final state, not before/after.
- Git operations — work via the agent running `git` commands, not a dedicated UI panel.

## Suggested Next Improvements

1. **Interactive terminal** — Add `node-pty` for a real PTY shell session, not just command output.
2. **File diff view** — Show Monaco diff editor before/after agent edits.
3. **Agent memory** — Persist task history and workspace settings to a JSON file or SQLite so they survive restarts.
4. **Multi-file diff summary** — Show a unified summary of all file changes in a task.
5. **Context limits** — Automatically summarize long conversation histories to stay within model token limits.
6. **Model selector** — Add a UI dropdown to switch models without editing `.env`.
7. **Task cancellation** — Allow canceling a running agent task.
8. **Git panel** — Show git status, staged changes, and allow committing from the UI.
9. **Search** — Full-text search across workspace files.
10. **Multiple workspaces** — Switch between different projects without restarting.
