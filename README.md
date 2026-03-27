# DevMind AI — Local AI Coding Workspace

A browser-based personal AI coding assistant. Give it a natural language task and it executes it end-to-end on your local codebase: reads files, edits code, runs commands, detects errors, and reports results — without constant approval prompts.

---

## Architecture

**Browser-based web app** (not a desktop app):

- React + Vite frontend with Monaco editor running in your browser.
- Node.js/Express backend running locally that does all the real work: filesystem access, terminal execution, and AI model calls.
- WebSocket for real-time streaming of agent output.
- z.ai as the default AI model provider (OpenAI-compatible API, swappable).

```
Browser (React + Monaco)
     |  HTTP + WebSocket
     v
Local Node.js Server (Express)
  ├── Safety Layer        → enforces workspace root scoping, blocks dangerous operations
  ├── File Tools          → read, write, create, delete files
  ├── Terminal Tool       → runs shell commands in workspace
  ├── Model Adapter       → calls z.ai (OpenAI-compatible)
  └── Agent Loop          → orchestrates full task execution with structured reporting
```

---

## Requirements

### All platforms
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A z.ai API key (or another OpenAI-compatible provider)

### Windows — **Git Bash or WSL required**

The agent executes shell commands (npm, git, tsc, etc.) via bash. On Windows, you **must** install one of:

- **Git Bash** (recommended for quick setup): [https://git-scm.com/download/win](https://git-scm.com/download/win)
- **WSL (Windows Subsystem for Linux)**: [https://learn.microsoft.com/en-us/windows/wsl/install](https://learn.microsoft.com/en-us/windows/wsl/install)

cmd.exe alone will not work for agent command execution. The app itself (browser + Node.js server) runs fine on Windows — only the *agent's bash commands* require Git Bash or WSL.

The in-app workspace setup dialog will display this warning automatically when Windows is detected.

---

## Setup

### Windows (with Git Bash)

```cmd
git clone <repo-url>
cd devmind-ai
pnpm install
copy .env.example .env
notepad .env
```

Fill in your `ZAI_API_KEY` in `.env`, then:

```cmd
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note:** Run the above from Git Bash or PowerShell, not cmd.exe. The `pnpm run dev` script uses `cross-env` for cross-platform compatibility.

### Mac / Linux

```bash
git clone <repo-url>
cd devmind-ai
pnpm install
cp .env.example .env
# Edit .env and set your ZAI_API_KEY
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Configuration

Edit `.env`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ZAI_API_KEY` | **Yes** | — | Your z.ai API key |
| `ZAI_BASE_URL` | No | `https://api.z.ai/v1` | API base URL |
| `ZAI_MODEL` | No | `z1-32b` | Model name |
| `WORKSPACE_ROOT` | No | — | Pre-configure workspace directory (can also set in UI) |
| `PORT` | No | `3000` | Backend server port |

### Swapping the AI Model Provider

The model adapter uses an OpenAI-compatible interface. To switch providers, change these `.env` values:

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

## How the Agent Loop Works

When you submit a task, the agent executes up to 30 steps:

1. **Plan** — Thinks about what files to inspect and what changes are needed.
2. **Inspect** — Reads the workspace file tree and relevant files before touching anything.
3. **Edit** — Writes files one at a time with their complete new content.
4. **Verify** — Runs build/lint/test commands and checks exit codes.
5. **Fix** — If a command fails, reads the error and tries a different approach.
6. **Summarize** — Ends with a structured report: files changed, commands run, final status.

All steps stream live to the UI via WebSocket. A completion card shows the structured result when done.

**Task cancellation**: Click the Cancel button that appears while a task is running.

---

## Verification Commands

After cloning and installing, verify the setup:

```bash
# Typecheck everything
pnpm run typecheck

# Run safety tests (path traversal, command blocklist, model config)
pnpm run test

# Start the dev server
pnpm run dev
```

Expected startup output:
- API server: `Server listening` on port 3000 (or your configured PORT)
- Frontend: Vite dev server starts, browser opens to the workspace setup dialog
- After setting workspace: file explorer shows your project tree, AI panel ready for tasks

---

## Project Structure

```
devmind-ai/
├── artifacts/
│   ├── api-server/           # Node.js/Express backend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── safety.ts         # Path scoping, command blocklist, system dir protection
│   │       │   ├── fileTools.ts      # File read/write/list/delete
│   │       │   ├── terminal.ts       # Shell command execution (Windows + POSIX)
│   │       │   ├── modelAdapter.ts   # z.ai / OpenAI-compatible adapter
│   │       │   ├── agentLoop.ts      # Agent orchestration loop
│   │       │   ├── sessionManager.ts # In-memory task storage + cancellation
│   │       │   └── wsServer.ts       # WebSocket server
│   │       └── routes/
│   │           ├── workspace.ts      # GET/POST /api/workspace
│   │           ├── files.ts          # File operation routes
│   │           └── agent.ts          # Agent task routes + cancel
│   └── workspace-ide/        # React + Vite frontend (Monaco IDE)
│       └── src/
│           ├── components/panels/    # FileExplorer, CodeEditor, OutputPanel, TaskPanel
│           ├── hooks/use-websocket.ts
│           └── store/use-ide-store.ts
├── scripts/
│   └── src/
│       ├── test-safety.ts    # Path traversal + command blocklist tests
│       └── test-model-config.ts  # Model adapter config tests
├── lib/
│   ├── api-spec/             # OpenAPI spec + codegen config
│   ├── api-client-react/     # Generated React Query hooks
│   └── api-zod/              # Generated Zod validation schemas
├── .env.example              # Environment variable template
└── README.md
```

---

## Filesystem Safety

- All file operations are **strictly sandboxed** to the configured workspace root via `path.resolve` + prefix checks. No path traversal is possible.
- Absolute paths from the client are **explicitly rejected** — only relative paths are accepted.
- System directories (`/`, `/etc`, `C:\Windows`, etc.) are **blocked as workspace roots**.
- A blocklist of ~15 dangerous shell patterns prevents commands like `rm -rf /`, fork bombs, `curl | bash`, `shutdown`, Windows `del /s`, etc.
- All commands run with the workspace root as their `cwd`.
- Command timeout defaults to 120 seconds; the agent can request up to 300 seconds per command.

---

## Known Limitations

- **No persistent storage**: Task history and workspace settings are in-memory only. A server restart clears them. Set `WORKSPACE_ROOT` in `.env` to auto-restore the workspace on restart.
- **No interactive terminal**: The terminal panel shows agent command output but is not an interactive PTY shell. Adding `node-pty` would enable a real shell but requires native addon compilation.
- **No file diff view**: The editor shows the final state of edited files, not a before/after diff.
- **No multi-workspace support**: One workspace root per server instance.
- **Agent context window**: Very long tasks automatically prune old message history. The system prompt and last 8 messages are always kept.
- **Windows bash requirement**: cmd.exe is not supported for agent command execution. Git Bash or WSL required.

---

## What Is Fully Working

- Four-panel IDE: file explorer, Monaco editor, agent activity panel, AI task panel.
- Workspace directory picker with validation — configure any local project folder.
- File explorer with full directory tree navigation.
- Monaco editor: open, read, save files with syntax highlighting and Ctrl+S.
- Files edited by the agent automatically refresh in the editor if open.
- AI task panel: submit a task, cancel it, watch live streaming updates.
- Agent loop: real multi-step execution with plan → inspect → edit → verify → fix → summarize.
- Structured completion card: files changed, commands run, final status, any remaining issues.
- WebSocket streaming: all agent events appear in real time.
- Task history: view all past tasks and their status.
- Task cancellation: Cancel button appears while agent is working.
- Live connection status indicator in top bar and task panel.
- Windows detection: shows Git Bash/WSL guidance in workspace setup dialog.
