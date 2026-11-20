/**
 * Starting and observing systemd units. Everything here is a thin, explicit
 * wrapper: no shell interpolation of caller data, no long waits, no retries
 * that could start the same job twice.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { shellQuote } from './agents.js'

const SYSTEMD_TIMEOUT = 15000

/** Environment keys a job may need. Everything else stays with the host. */
const ENV_ALLOW = [
  /^HOME$/,
  /^PATH$/,
  /^DSH_HOME$/,
  /^LANG$/,
  /^LC_/,
  /^XDG_/,
  /^TERM$/,
  /^USER$/,
  /^SHELL$/,
  /^TMPDIR$/,
  /^SSH_AUTH_SOCK$/,
  /^NODE_OPTIONS$/,
  /^http_proxy$/i,
  /^https_proxy$/i,
  /^no_proxy$/i,
  /API_KEY$/,
  /^ANTHROPIC_/,
  /^OPENAI_/,
  /^DEEPSEEK_/,
  /^GOOGLE_/,
  /^GEMINI_/,
  /^QWEN_/,
  /^CODEX_/,
]

export function acceptedEnv(env = process.env) {
  const out = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue
    if (value.includes('\0') || value.includes('\n')) continue
    if (ENV_ALLOW.some((pattern) => pattern.test(key))) out[key] = value
  }
  return out
}

export function unitFor(id) {
  return `outlive-${id}`
}

/**
 * systemd parses unit-file values, not shell words: a path with spaces must be
 * double quoted inside the property value, otherwise the rest is dropped.
 */
export function unitValue(value) {
  const text = String(value)
  if (text === '' || !/[\s"\\]/.test(text)) return text
  return JSON.stringify(text)
}

function writeScript(path, text, mode = 0o700) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, text, { mode })
  chmodSync(path, mode)
  return path
}

/** The command the user or the agent preset asked for, with `set -u`. */
export function writeCommandScript(dir, body) {
  return writeScript(join(dir, 'command.sh'), `#!/usr/bin/env bash\nset -u\n${String(body).replace(/\n*$/, '')}\n`)
}

/**
 * The wrapper: captures output, records the exit status, and never lets a
 * missing working directory look like a crash without a record.
 */
export function writeRunScript({ dir, commandPath, cwd, logPath, exitPath }) {
  const cd = cwd ? `cd ${shellQuote(cwd)} || { echo "outlive: working directory not found: ${String(cwd).replace(/"/g, '')}" >&2; printf '127 %s\\n' "$(date +%s%3N)" > ${shellQuote(exitPath)}; exit 127; }` : ':'
  const text = `#!/usr/bin/env bash
set -u
exec >> ${shellQuote(logPath)} 2>&1
${cd}
echo "[outlive] started $(date -Is)"
/usr/bin/env bash ${shellQuote(commandPath)} < /dev/null
code=$?
echo "[outlive] exit $code $(date -Is)"
printf '%s %s\\n' "$code" "$(date +%s%3N)" > ${shellQuote(exitPath)}
exit "$code"
`
  return writeScript(join(dir, 'run.sh'), text)
}

/**
 * Start one transient unit. Returns `{ ok: true }` or `{ error, detail }`.
 * The unit name is unique per job, so a retry can never attach to an old unit.
 */
export function startUnit({ unit, description, cwd, runtimeMaxSec, scriptPath, env }) {
  if (!/^outlive-[a-z0-9-]+$/.test(unit)) return { error: 'invalidUnit' }
  const args = [
    '--user',
    '--collect',
    '--quiet',
    `--unit=${unit}`,
    `--description=${String(description || unit).replace(/[\r\n]/g, ' ').slice(0, 200)}`,
  ]
  if (Number.isFinite(runtimeMaxSec) && runtimeMaxSec > 0) args.push(`--property=RuntimeMaxSec=${Math.trunc(runtimeMaxSec)}`)
  if (cwd) args.push(`--property=WorkingDirectory=${unitValue(cwd)}`)
  for (const [key, value] of Object.entries(acceptedEnv(env))) args.push(`--setenv=${key}=${value}`)
  args.push('--', '/usr/bin/env', 'bash', scriptPath)

  const result = spawnSync('systemd-run', args, { encoding: 'utf8', timeout: SYSTEMD_TIMEOUT })
  if (result.error?.code === 'ENOENT') return { error: 'systemdMissing' }
  if (result.error) return { error: 'systemdFailed', detail: result.error.message }
  if (result.status !== 0) return { error: 'systemdFailed', detail: (result.stderr || result.stdout || '').trim().slice(0, 2000) }
  return { ok: true }
}

export function probeUnit(unit) {
  if (!/^outlive-[a-z0-9-]+$/.test(unit)) return null
  const result = spawnSync(
    'systemctl',
    ['--user', 'show', unit, '--property=ActiveState,ExecMainStatus,Result,MainPID,LoadState'],
    { encoding: 'utf8', timeout: SYSTEMD_TIMEOUT },
  )
  if (result.error || result.status !== 0) return null
  const fields = {}
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) fields[line.slice(0, index)] = line.slice(index + 1)
  }
  return {
    loadState: fields.LoadState || null,
    activeState: fields.ActiveState || null,
    execMainStatus: fields.ExecMainStatus === undefined ? null : Number(fields.ExecMainStatus),
    result: fields.Result || null,
    mainPid: fields.MainPID === undefined ? null : Number(fields.MainPID),
  }
}

export function stopUnit(unit) {
  if (!/^outlive-[a-z0-9-]+$/.test(unit)) return { error: 'invalidUnit' }
  const result = spawnSync('systemctl', ['--user', 'stop', unit], { encoding: 'utf8', timeout: SYSTEMD_TIMEOUT })
  if (result.error) return { error: 'systemctlFailed', detail: result.error.message }
  return { ok: result.status === 0, detail: (result.stderr || '').trim().slice(0, 500) }
}

export function removeDir(path) {
  try {
    rmSync(path, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
