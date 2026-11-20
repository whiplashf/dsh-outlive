# Glossary

The vocabulary this plugin uses in code, API payloads, and UI copy. One concept, one word.

| Term | Meaning | Not this |
|---|---|---|
| **Job** | One detached execution recorded under the state directory: its script, log, exit marker, and ledger entry. | task, run, session |
| **Task** | A saved, repeatable recipe shown in the panel and in the `/` menu. Running a task creates a job. | job |
| **Agent** | An external coding CLI invoked non-interactively, with a task file as input. | engine, executor, model |
| **Agent preset** | A known agent (name, binary, arguments) shipped with the plugin. A preset is either *verified* or *unverified*. | built-in agent |
| **Verified preset** | Arguments that have been tested against the current CLI; the preset is selectable without editing. | supported |
| **Unverified preset** | The binary is recognized, but its non-interactive arguments have not been confirmed. It is detected but cannot be selected until the user supplies arguments. | broken |
| **Custom agent** | A user-defined agent: an absolute binary path chosen with the file browser, plus an argument template containing `{file}`. | preset |
| **Task file** | The UTF-8 file holding the task text that an agent reads through `{file}`. | prompt |
| **Argument template** | The agent's argument string with `{file}` and `{title}` placeholders. | command |
| **State directory** | Where jobs, tasks, and custom agents live: `$OUTLIVE_HOME`, else `${XDG_STATE_HOME:-~/.local/state}/outlive`. | data dir |
| **Detached** | Running in a transient systemd unit outside the dsh process tree, so a dsh restart does not stop it. | background |
| **Notification** | The message a finished job delivers back to the session that started it. | result |
| **Notice state** | `none`, `pending`, `sent`, or `failed` — whether a job's notification has been delivered. | notified flag |
| **Retention** | The newest 200 jobs are kept; older settled jobs and their directories are removed. Running jobs are never pruned. | cleanup |

## Naming rules

- Code and API use `agent`, never `engine`. The tool parameter `engine` is accepted as a deprecated alias for one minor release.
- The panel title and the package name use **Outlive**; the UI language follows the host locale.
- A job *completes*, *fails*, or is *cancelled*; it is never "done" or "killed" in user-facing copy.
