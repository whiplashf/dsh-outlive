# Changelog

## 1.0.0 — 2026-11-20

First public release. The plugin was rewritten around the release requirements rather than patched.

**Breaking**

- Package renamed from `@local/dsh-outlive` to `@whiplashf/dsh-outlive`.
- Status values are now `completed` / `failed` / `cancelled` (previously `done` / `killed`).
- `outlive_agent` takes `agent`; `engine` is accepted as a deprecated alias for one release.
- `outlive_engines` is a deprecated alias of the new `outlive_agents`.
- State moves to `${XDG_STATE_HOME:-~/.local/state}/outlive` (`OUTLIVE_HOME` and `stateDir` still win). An old `~/runtime/outlive` directory is left untouched, not migrated.

**Added**

- Built-in **Restart DSH Web** task with two automatic paths: `systemctl --user restart` when a persistent unit owns the process, otherwise `SIGTERM` plus a relaunch in a transient unit. Both wait for the listening port before reporting success.
- Built-in file browser for choosing an agent executable or a working directory, replacing the free-text path fields.
- Agent detection over `PATH` plus the usual install directories, with a verified/unverified flag per preset and eight additional presets.
- Command preview before dispatch, for agents and restarts alike.
- Job records reconciled against their systemd unit, so a dead unit cannot leave a job `running`.
- Retention: 200 settled jobs, 40 saved tasks; running jobs are never pruned.
- English and Chinese UI, and result messages in the language of the panel that started the job.
- Tests for the ledger, agent detection, restart planning, the file browser, dispatch, notifications, and the HTTP/tool surface.

**Changed**

- The panel API moved from public `/__outlive/*` routes to `/api/outlive/*` on DSH's authenticated connection channel, so it inherits the host's browser-session gate (`401` without a session, `403` for a non-owner peer) instead of relying on a custom header alone.
- The panel is a centered column (max 1120 px) with a side column instead of full-width rows with controls pinned to the viewport edge.
- Panel copy is written as product copy: no debug output, no chatty hints.
- Custom agents replace a preset of the same name instead of being shadowed by it.
- `agents.json` / `tasks.json` writes are atomic; a corrupt file is kept as `*.corrupt-*`.

**Removed**

- The hard-coded `/usr/local/nodejs/bin` fallback for agent binaries.
- The trigger-source debug line in the panel.
