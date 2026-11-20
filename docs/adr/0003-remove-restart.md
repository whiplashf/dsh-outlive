# 0003 — Remove the built-in restart task; restarting dsh is a command job

- Status: accepted
- Date: 2026-11-20
- Supersedes: [0001](0001-restart-strategy.md)

## Context

`0.1.x` shipped a built-in **Restart DSH Web** task with its own plan detector, a kill-then-relaunch path, a health check, and a generated relaunch script ([0001](0001-restart-strategy.md)). Reviewing that path against how the plugin is actually installed turned up three problems:

- **The unsupervised path can brick the host.** It terminates the dsh process first and only then calls `systemd-run`. On a host without a usable user manager or `systemd-run` (containers, minimal images), the relaunch fails and nothing is left to bring dsh back. The failure is written to a log inside a job directory, so it is discoverable only after the user restarts dsh by hand.
- **It duplicates a saturated niche.** The plugin catalog lists 49 plugins whose name matches restart/relaunch/autorestart and 166 whose description mentions restarting. Several of them (`dsh-autonomous-restart`, `@dr-co/dsh-graceful-restart`, `dsh-autorestart`, `dsh-restart-planner`) already do the part that is hard — waiting for idle work, counting down visibly, waking the session that asked — and `dsh-restart-anywhere` restarts in place with `execve`, so it cannot fail to come back.
- **It carries risk the rest of the plugin does not need.** The value of Outlive is "the job runs outside the host's process tree", which a restart gets for free by being a plain command job. Everything the built-in task added was restart-specific surface: a second dispatch kind, a plan payload, panel copy, a restore path for the built-in row, and ~400 lines of code and tests.

## Decision

Delete the restart feature. Restarting dsh is:

```bash
outlive_run command="systemctl --user restart dsh-web"
```

or the same command saved as a task in the panel. `systemctl` owns the relaunch, so exactly one instance comes back, and there is no kill-then-run window in which a failure leaves the host dead.

The plugin keeps no built-in task. `tasks.json` from an older release is migrated on read: the `builtin-restart-dsh` record is dropped, and the `removedBuiltins` bookkeeping field is no longer written.

## Consequences

- One dispatch kind fewer (`agent` | `command`), no plan detector, no `/proc` environment capture, no relaunch script with inherited secrets.
- Users who want idle-aware restart with session wake-up install a dedicated restart plugin; the README and DESIGN say so.
- [ADR 0001](0001-restart-strategy.md) stays as the record of why the old design looked reasonable; its lesson that `systemd-run` execs without a shell or this process's PATH still applies to `lib/dispatch.js`.
