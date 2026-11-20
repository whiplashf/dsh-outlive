# 0001 — Restart dsh through systemd when a unit owns it, otherwise relaunch the process

- Status: accepted
- Date: 2026-11-20

## Context

The built-in task must restart DSH Web without the user naming a unit. On this class of host, `dsh web` is normally the main process of a persistent user unit with `Restart=on-failure`. systemd counts a signal-terminated main process as a failure, so killing it to relaunch it by hand starts a race: systemd restarts the unit while the task also starts a copy, and two instances compete for the same port. A pure `systemctl restart` is wrong for the opposite reason: it needs a unit name that unsupervised installations do not have.

## Decision

Ask the host for a plan at dispatch time. If the dsh process is the main process of a persistent, loaded unit, the plan is `systemctl --user restart <unit>`. Otherwise the plan is: capture argv, cwd, and environment from `/proc/<pid>`, terminate the process, and start the same argv in a fresh transient unit. `systemd-run` execs without a shell or this process's PATH, so a bare `argv[0]` is resolved to an absolute path (or wrapped in `/usr/bin/env` when it cannot be found); otherwise a shebang-launched `dsh` fails with "Failed to find executable node". The panel shows which plan will run before dispatch.

## Consequences

- The supervised path keeps systemd's bookkeeping intact and cannot create a second instance.
- The unsupervised path survives the process it replaces and restores the environment, including credentials the CLI needs.
- The restart script stores the inherited environment in a mode-0600 file inside the job directory. It is removed after a successful restart, and it is visible only to the same user; the alternative (a process that loses its API keys) is worse.
- A process started by a desktop session rather than a unit is relaunched into a transient unit, so its lifecycle changes from "child of a terminal" to "user-scoped unit". This is the intended trade: it is the only way the new process survives the restart job.
