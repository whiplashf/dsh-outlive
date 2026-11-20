# Outlive

> **Status: on hold (2026-11-20).** The code works, but what the plugin is *for* is still unresolved. Detached jobs came out of "let an agent hand work to something that outlives the session", and after building it I could not say why that matters more than the harness's own background jobs. Development is paused until that question has an answer; nothing here is broken, and the removal of the built-in restart task in this release is part of the same reckoning — restarting belongs to plugins that do only that.

Run coding agents and shell commands **outside** the DSH session, in a transient systemd unit that survives a closed tab, a stopped session, and a restarted `dsh` process. Results come back into the conversation when the job finishes.

```
browser panel ──▶ /api/outlive/* ──▶ systemd-run --user --unit=outlive-<job>
                                            │
      log + exit marker ◀── out.log / exit ─┘
```

## Requirements

| | |
|---|---|
| OS | Linux with a systemd **user** manager (`systemd-run --user`, `systemctl --user`) |
| DSH | `>= 0.2.2-rc.3` |
| Node | `>= 20` |

macOS and Windows are not supported: the host half depends on systemd user units. If you need that, run work under `bash` with `run_in_background` instead.

## Install

```bash
dsh plugin --profile web add @whiplashf/dsh-outlive
```

Then restart the DSH web app once so the host half and the client bundle are loaded. After that the panel appears in the sidebar as **Outlive**.

The package declares `dsh.bundle` and `dsh.client`, so the plugin manager adds it to your profile's bundle list automatically. Keep the profile name (`web` above) if you use the web app; use `tui` for the terminal app.

## Use it

### Restarting DSH

Outlive has no restart button, and that is deliberate: restarting a process is an ordinary shell command, and a detached unit is exactly where such a command belongs. Because the job runs outside the `dsh` process tree, the restart it triggers does not kill the job:

```bash
outlive_run command="systemctl --user restart dsh-web" label="Restart DSH"
```

Save it as a task in the panel to get a one-click button for later. If you want a restart that waits for agents to go idle and then wakes the session that asked for it, install a dedicated restart plugin from the marketplace — those plugins already do it better than a generic runner could.

### Give an agent a task

1. Pick an agent. Detected CLIs are listed with their binary path and version; `auto` uses the first ready agent in the order OpenCode → Codex → Claude Code.
2. Write the task. The agent never sees your conversation, so put the background, the paths, and the acceptance criteria in the text.
3. Optionally set a working directory (file browser) and a runtime limit (default 2 h).
4. Expand **Preview command** to see the exact shell command before dispatch.

The task text is written to `task.txt` with mode `0600` and read by the agent through a command substitution (`"$(cat …)"`), so quotes and newlines in the task can never be interpreted by the shell.

### Run a shell command

Same panel, **Command** tab. This is the escape hatch for anything a single command can express — a build, a migration, a log tail.

### Saved tasks

**Save** stores the task without running it; **Run** dispatches it. Saving is deduplicated by `kind + command/task + agent + cwd`, so re-saving the same task bumps it to the top instead of creating a copy. Up to 40 tasks are kept.

## Model tools

Every tool is available to the model in the session. Jobs dispatched this way report their result back into the same conversation when they finish.

| Tool | Purpose |
|---|---|
| `outlive_agent` | Run a whole task on a coding agent. Args: `task` (required), `agent`, `label`, `cwd`, `runtime_max_sec` |
| `outlive_run` | Run one shell command. Args: `command` (required), `label`, `cwd`, `runtime_max_sec`, `env` |
| `outlive_agents` | List detected agents, their paths, versions, and whether their arguments are verified. Arg: `refresh` |
| `outlive_status` | Status, exit code, and the tail of a job's log. Args: `id`, `tail_lines` |
| `outlive_list` | Recent jobs, newest first. Arg: `limit` |
| `outlive_cancel` | Stop a running job. Arg: `id` |
| `outlive_engines` | Deprecated alias of `outlive_agents`; removed in 2.0 |

## Agents

Presets are marked **verified** only when their argument template has been exercised against the real CLI:

| Agent | Arguments | Verified |
|---|---|---|
| OpenCode (`opencode`) | `run --standalone --auto --archived --title {title} -- {file}` | yes |
| Codex (`codex`) | `exec --skip-git-repo-check -s workspace-write -- {file}` | yes |
| Claude Code (`claude`) | `-p --dangerously-skip-permissions {file}` | yes |
| Gemini CLI, Cursor Agent, GitHub Copilot CLI, Aider, Qwen Code, Goose, Crush, Amp | — | no: detected, needs arguments |

Unverified presets are still probed so the panel can say "installed, needs arguments" instead of pretending the agent is ready.

**Any other CLI** can be added from the panel: choose the executable with the built-in file browser (it lists the host filesystem, executables only by default), give it a name, and provide an argument template containing `{file}`. `{file}` expands to the task file; `{title}` expands to a quoted job title. A custom agent whose name matches a preset replaces that preset.

## Layout and behaviour

- The panel is one centered column (max 1120 px) with a fixed-width side column; below 980 px it collapses to a single column.
- The panel polls one snapshot route every 3 s; a job's log is fetched only while it is expanded and running.
- Jobs are tracked in `job.json` and reconciled against the systemd unit, so a record cannot stay `running` after its unit died.
- Jobs started from the panel do not send a chat notification (the panel has no session id); jobs started by a tool do.

## State directory

```
$OUTLIVE_HOME
  or ${XDG_STATE_HOME:-~/.local/state}/outlive/
    jobs/<12-hex>/{job.json,command.sh,run.sh,out.log,exit,…}
    tasks.json
    agents.json
```

`OUTLIVE_HOME` and the `stateDir` config key both override the default. The last 200 settled jobs are kept; running jobs are never pruned. `agents.json` and `tasks.json` are written atomically and a corrupt file is set aside as `*.corrupt-*` instead of being deleted.

## Configuration

`cordis.patch.yml` inserts the bundle with:

```yaml
- insert:
    - id: tool-outlive
      name: '@whiplashf/dsh-outlive'
      config:
        pollMs: 3000
```

| Key | Default | Meaning |
|---|---|---|
| `pollMs` | `3000` | How often the host reconciles running jobs (500–60000) |
| `stateDir` | XDG state home | Ledger location; `OUTLIVE_HOME` wins over it |
| `defaultAgent` | `auto` | Agent used when a request does not name one (`defaultEngine` is the old spelling) |

## Security

- The panel API lives on DSH's authenticated `/api` channel, so it inherits the host's own browser-session gate: a request without a valid session gets `401` and a non-owner peer gets `403` before Outlive sees it.
- Every state-changing call also needs `x-outlive: 1` and a JSON content type; a cross-origin form cannot send the header, and a cross-origin JSON `fetch` triggers a preflight the server never answers.
- The file browser is read-only, absolute paths only, capped at 1000 entries.
- Job scripts and the task file are `0600`/`0700` under the state directory.
- An agent job inherits a small allowlist of environment variables (paths, locale, proxy, and common `*_API_KEY` names); nothing else from the host process leaks into the unit.
- Anything you run as a job runs as your user; a restart job can only touch units you already own.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `systemd-run is not available on this host` | No systemd user manager in this session. Log in as a normal user session (`loginctl enable-linger` if needed) — Outlive cannot work without it. |
| Agent listed as *needs arguments* | That preset has no verified argument template. Add the same binary as a custom agent with an argument template containing `{file}`. |
| Panel shows no agents | Nothing on `PATH`. Outlive also searches `~/.local/bin`, `~/.opencode/bin`, `~/.bun/bin`, `~/.cargo/bin`, `~/.npm-global/bin`, `~/go/bin`, `/usr/local/bin`, `/usr/local/nodejs/bin`, `/usr/bin`. |

## Development

```bash
npm test     # node --test, no network, no systemd required
npm run check
```

Layout: `index.js` (host: ledger, routes, tools), `client.js` (browser panel), `lib/store.js` (records), `lib/agents.js` (detection, command building), `lib/dispatch.js` (systemd units), `lib/fsbrowse.js` (file browser), `lib/notify.js` (result messages).

See [docs/DESIGN.md](docs/DESIGN.md), [docs/adr/](docs/adr/), and [GLOSSARY.md](GLOSSARY.md).

中文文档：[README.zh.md](README.zh.md)

## License

MIT
