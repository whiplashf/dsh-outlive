# Outlive — design

> Status: paused (2026-11-20). This document describes the design as built, not a roadmap. The open question is whether a plugin that only adds "run work outside the host process tree" earns its place next to the harness's own background jobs.

Outlive lets a DSH session hand work to a transient systemd unit that lives outside the dsh process tree. A dsh restart loses the poll loop, not the work — which also means the job that restarts dsh is one of the jobs this plugin is for.

## Goals

- Install with `dsh plugin add` and work without editing paths, arguments, or unit files.
- Detect coding-agent CLIs on `PATH`; let the user add any other executable through a file browser, not a text path field.
- Keep the panel readable on a large screen: one centered column, no controls pinned to the viewport edge.
- Explain every failure in the panel, with the command that will run available before dispatch.

## Non-goals

- Windows and macOS. The host half requires Linux with a systemd user manager.
- Replacing the harness's own background jobs. A job started with `bash run_in_background` is a child of dsh and still dies with it; Outlive is for work that must outlive the process.
- Being a scheduler. There is no cron, retry policy, or queue. One task, one transient unit.

## Architecture

```
client.js (browser)                 index.js (host)
  page + drawer + file picker  ──▶   /api/outlive/* routes
  locale dictionaries                 tools (outlive_*)
        │                                  │
        └──────────── HTTP ────────────────┤
                                           ▼
                              lib/store.js      ledger on disk
                              lib/agents.js     detection + command building
                              lib/dispatch.js   systemd-run, cancel, reconcile
                              lib/fsbrowse.js   host filesystem listing
                              lib/notify.js     result messages
```

The host never runs work itself. It writes `command.sh` and `run.sh` under the state directory, starts `systemd-run --user --collect --unit=outlive-<job>`, and afterwards reads `out.log` and the `exit` marker. The browser polls one snapshot route; logs are fetched only for an expanded job.

### State

```
$OUTLIVE_HOME | ${XDG_STATE_HOME:-~/.local/state}/outlive/
  jobs/<12-hex>/
    job.json      ledger record
    command.sh    the command
    run.sh        launcher: redirects output, records the exit marker
    task.txt      agent input (agent jobs only)
    out.log       combined stdout/stderr
    exit          "<code> <epoch-ms>" written by run.sh
  tasks.json      saved tasks
  agents.json     custom agents
```

`job.json` fields: `id`, `kind` (`agent` | `command`), `label`, `agent`, `command`, `cwd`, `unit`, `dir`, `logPath`, `status` (`running` | `completed` | `failed` | `cancelled`), `exitCode`, `startedAt`, `finishedAt`, `runtimeMaxSec`, `sessionId`, `lang`, `notify`, `error`, `killed`, `taskId`.

### HTTP API

The routes live on DSH's authenticated `/api` Fetch channel, so the host's browser-session gate runs first: no session is `401`, a non-owner peer is `403`. Outlive adds its own fence on top — every mutating call must carry `x-outlive: 1` and a JSON content type, which turns a cross-origin request into a CORS preflight the server never answers. Each route is registered as one exact `path` with a single `method`; the carrier only hands the handler a body-less `Request` when the route declares `requestBody: 'buffered'`, so GET routes declare it too.

| Route | Method | Purpose |
|---|---|---|
| `/api/outlive/state` | GET | One snapshot: jobs, agents, tasks, defaults, version, platform support. |
| `/api/outlive/log` | GET | Log tail (`id`, `tail`). |
| `/api/outlive/cancel` | POST | Stop a running job's unit. |
| `/api/outlive/delete` | POST | Remove a settled job directory. |
| `/api/outlive/jobs/clear` | POST | Remove every settled job directory. |
| `/api/outlive/agents` | GET | Detection; `refresh=1` bypasses the 30 s cache. |
| `/api/outlive/agents` | POST | Add or replace a custom agent (absolute executable + template). |
| `/api/outlive/agents/delete` | POST | Remove a custom agent. |
| `/api/outlive/preview` | POST | The exact command an agent or command job will run. |
| `/api/outlive/tasks` | GET/POST | List or save a task. |
| `/api/outlive/tasks/delete` | POST | Delete a saved task. |
| `/api/outlive/fs` | GET | Directory listing for the file and directory pickers. |
| `/api/outlive/run` | POST | Dispatch an agent or command job. |

Errors are `{ "error": "agentNeedsArgs", "detail": "gemini" }`. The panel maps known codes to localized copy; unknown codes fall back to `detail`.

### Agent detection

Presets ship with a binary name and, when the non-interactive invocation has been verified, an argument template. Detection looks up each binary on `PATH`, runs `<bin> --version` with a 5 s timeout, and caches the result for 30 s. A preset with a verified template is *ready*. An unverified preset is listed as *detected, needs flags*: the panel offers a configure form, and the agent cannot be selected until the user provides an executable and a template containing `{file}`.

Custom agents are stored in `agents.json`. A custom agent with the same name as a preset overrides that preset, which is how a user pins a different binary or different flags for `opencode`.

`{file}` expands to `"$(cat '<task-file>')"`; `{title}` expands to the shell-quoted label. The command is built once, on the host, so the preview and the executed script cannot diverge.

### Restarting dsh

Restarting the host is not a feature of this plugin: it is an ordinary command job, and the detached unit is what makes it safe. `outlive_run command="systemctl --user restart dsh-web"` writes a script that calls systemd, so systemd owns the relaunch and one instance comes back. There is no kill-then-relaunch path in this codebase, and therefore no way for a failed relaunch to leave the host dead with the job still holding the only record of what was tried.

Users who want a restart that waits for idle agents and wakes the asking session should install a dedicated restart plugin.

### Notifications

A finished job is delivered with `agent.followup` as a `source.kind = 'outlive'` user message. The message language follows the job: panel submissions store the active UI language, model-tool submissions use English. Delivery is retried by the poll loop while the notice is `pending` and the session's agent exists; five failed attempts mark it `failed` and stop retrying. A restarted harness repopulates the session map from `agent/created` events and delivers anything still owed.

### Retention

After a job settles, the ledger is pruned to the newest 200 jobs. Only settled jobs are removed, oldest first. Running jobs, saved tasks, and custom agents are untouched.

## Failure handling

- `systemd-run` missing or the user manager unavailable → dispatch fails immediately; the job is `failed` with the stderr in `error`.
- The unit exits without an `exit` marker (timeout, `systemctl stop`, crash) → the poll loop asks `systemctl show` for `ActiveState`/`ExecMainStatus` and marks the job failed instead of leaving it `running` forever.
- A bad `cwd` → the launcher writes exit 1 with a message before running the command.
- A missing agent binary after dispatch → the command fails with exit 127 in the log; the job is `failed`.
- A command job that restarts dsh → the job is a plain command job: its own log ends with the new process starting, and the panel reconnects by itself.

## Testing

`node --test` covers the pure modules: state resolution and retention, task identity and legacy-task migration, agent detection and command building, directory listing, and route handlers mounted on a fake web server with an injected dispatcher. Systemd itself is not exercised by the test suite; a manual smoke test is documented in the README.
