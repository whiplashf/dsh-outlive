/**
 * Restart planning for the process that hosts DSH.
 *
 * Two plans, chosen by evidence rather than configuration:
 *  - unit: the host process is the main process of a persistent user unit, so
 *    systemd stays in charge and performs the restart.
 *  - process: no persistent unit owns the process, so it is terminated and the
 *    same argv is launched in a fresh transient unit that outlives this job.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shellQuote } from './agents.js'

const PROC = {
  cgroup: (pid) => `/proc/${pid}/cgroup`,
  cmdline: (pid) => `/proc/${pid}/cmdline`,
  cwd: (pid) => `/proc/${pid}/cwd`,
  environ: (pid) => `/proc/${pid}/environ`,
}

/** Everything after the last `.service`/`.scope` component, deepest first. */
export function serviceUnitsInCgroup(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('0::'))
  const path = line ? line.slice(3) : String(text || '')
  return path
    .split('/')
    .filter((part) => part.endsWith('.service') || part.endsWith('.scope'))
    .reverse()
}

export function readProcInfo(pid, io = { readFile: readFileSync, readlink: readlinkSync }) {
  const readText = (path) => io.readFile(path, 'utf8')
  const argv = readText(PROC.cmdline(pid))
    .split('\0')
    .filter((entry) => entry.length > 0)
  const cwd = io.readlink(PROC.cwd(pid))
  const env = {}
  for (const entry of readText(PROC.environ(pid)).split('\0')) {
    const index = entry.indexOf('=')
    if (index <= 0) continue
    const key = entry.slice(0, index)
    const value = entry.slice(index + 1)
    if (!key || value.includes('\n')) continue
    env[key] = value
  }
  return { argv, cwd, env }
}

export function argvValue(argv, flag) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === flag) return argv[index + 1] ?? null
    if (value.startsWith(`${flag}=`)) return value.slice(flag.length + 1)
  }
  return null
}

export function httpHost(argv) {
  const host = argvValue(argv, '--host')
  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host) || host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1'
  return host
}

/** Parse `ss -Hltnp` output for the ports this pid listens on. */
export function portsFromSs(output, pid) {
  const ports = new Set()
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!line.includes(`pid=${pid},`) && !line.includes(`pid=${pid})`)) continue
    const fields = line.trim().split(/\s+/)
    const local = fields[3] || ''
    const index = local.lastIndexOf(':')
    if (index < 0) continue
    const port = Number(local.slice(index + 1))
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port)
  }
  return [...ports].sort((a, b) => a - b)
}

export function listeningPorts(pid) {
  const result = spawnSync('ss', ['-Hltnp'], { encoding: 'utf8', timeout: 5000 })
  if (result.error || result.status !== 0) return []
  return portsFromSs(result.stdout, pid)
}

export function showUnit(unit) {
  const result = spawnSync(
    'systemctl',
    ['--user', 'show', unit, '--property=LoadState,Transient,MainPID,FragmentPath,ActiveState'],
    { encoding: 'utf8', timeout: 10000 },
  )
  if (result.error || result.status !== 0) return null
  const fields = {}
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) fields[line.slice(0, index)] = line.slice(index + 1)
  }
  return {
    loadState: fields.LoadState || null,
    transient: fields.Transient === 'yes',
    mainPid: Number(fields.MainPID) || null,
    fragmentPath: fields.FragmentPath || null,
    activeState: fields.ActiveState || null,
  }
}

/**
 * @param pid - the host process to restart (normally `process.pid`).
 * @param io - injectable /proc readers for tests.
 * @param show - injectable `systemctl show` probe for tests.
 */
export function planRestart({ pid = process.pid, io, show = showUnit, ports = listeningPorts } = {}) {
  const info = readProcInfo(pid, io)
  if (!info.argv.length) throw new Error(`cannot read the command line of pid ${pid}`)
  const cgroupText = (io?.readFile || readFileSync)(PROC.cgroup(pid), 'utf8')
  const units = serviceUnitsInCgroup(cgroupText)
  for (const candidate of units) {
    if (!candidate.endsWith('.service')) continue
    const unit = candidate
    const details = show(unit)
    if (!details || details.loadState !== 'loaded' || details.transient) continue
    if (details.mainPid !== pid) continue
    return {
      mode: 'unit',
      pid,
      unit,
      argv: info.argv,
      cwd: info.cwd,
      env: info.env,
      ports: uniquePorts(ports(pid), portFromArgv(info.argv)),
      host: httpHost(info.argv),
      detail: 'persistent user unit',
    }
  }
  return {
    mode: 'process',
    pid,
    unit: null,
    argv: info.argv,
    cwd: info.cwd,
    env: info.env,
    ports: uniquePorts(ports(pid), portFromArgv(info.argv)),
    host: httpHost(info.argv),
    detail: units.length ? `no persistent unit owns pid ${pid}` : 'no unit owns this process',
  }
}

function portFromArgv(argv) {
  const raw = argvValue(argv, '--port')
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65536 ? [port] : []
}

function uniquePorts(...lists) {
  const set = new Set()
  for (const list of lists) for (const port of list) if (port) set.add(port)
  return [...set].sort((a, b) => a - b)
}

export function restartPlanText(plan) {
  if (plan.mode === 'unit') return `systemctl --user restart ${plan.unit}`
  return [
    `kill -TERM ${plan.pid}`,
    `start ${plan.argv.map((arg) => (arg.includes(' ') ? shellQuote(arg) : arg)).join(' ')}`,
  ].join('\n')
}

/** Write a 0600 environment file systemd can read for the relaunched process. */
export function writeEnvironmentFile(path, env) {
  const lines = ['# Generated by Outlive for one detached process. Remove after it starts.']
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if (value.includes('\n')) continue
    lines.push(`${key}=${JSON.stringify(value)}`)
  }
  writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

function systemdQuotedPath(path) {
  return `"${String(path).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Build the script that performs the restart. It runs inside the job's own
 * unit, so it survives the process it is restarting.
 *
 * @param dir - job directory.
 * @param plan - result of `planRestart`.
 * @param unit - unit name for the relaunched process (process mode).
 */
export function writeRestartScript({ dir, plan, unit, logPath, exitPath, envPath }) {
  const host = plan.host
  const ports = plan.ports
  const health = ports.length
    ? `ok=0
for port in ${ports.map(String).join(' ')}; do
  for _ in $(seq 1 60); do
    if (exec 3<>"/dev/tcp/${host}/$port") 2>/dev/null; then exec 3>&- 3<&-; ok=$((ok+1)); break; fi
    sleep 0.5
  done
done
[ "$ok" -eq ${ports.length} ]`
    : `sleep 3
systemctl --user is-active --quiet ${shellQuote(unit || 'dsh')} 2>/dev/null`
  const launch =
    plan.mode === 'unit'
      ? `systemctl --user restart ${shellQuote(plan.unit)}
status=$?`
      : `kill -TERM ${plan.pid} 2>/dev/null || true
for _ in $(seq 1 60); do kill -0 ${plan.pid} 2>/dev/null || break; sleep 0.5; done
if kill -0 ${plan.pid} 2>/dev/null; then kill -KILL ${plan.pid} 2>/dev/null || true; sleep 1; fi
systemd-run --user --collect --quiet \
  --unit=${shellQuote(unit)} \
  --description='outlive: dsh web' \
  --property=WorkingDirectory=${systemdQuotedPath(plan.cwd)} \
  --property=EnvironmentFile=${systemdQuotedPath(envPath)} \
  -- ${plan.argv.map((arg) => shellQuote(arg)).join(' ')}
status=$?`
  const text = `#!/usr/bin/env bash
set -u
exec >> ${shellQuote(logPath)} 2>&1
echo "[outlive] restart plan: ${plan.mode} (${plan.detail})"
${launch}
if [ "$status" -ne 0 ]; then
  echo "[outlive] restart command failed with status $status"
  printf '%s %s\\n' 1 "$(date +%s%3N)" > ${shellQuote(exitPath)}
  exit 1
fi
if ${health}; then
  echo "[outlive] dsh is serving on ${ports.join(', ') || 'its unit'}"
  rm -f ${shellQuote(envPath)} ${shellQuote(join(dir, 'restart.sh'))}
  printf '%s %s\\n' 0 "$(date +%s%3N)" > ${shellQuote(exitPath)}
  exit 0
fi
echo "[outlive] dsh did not come back within the health-check window"
printf '%s %s\\n' 1 "$(date +%s%3N)" > ${shellQuote(exitPath)}
exit 1
`
  const path = join(dir, 'restart.sh')
  writeFileSync(path, text, { mode: 0o700 })
  chmodSync(path, 0o700)
  return path
}
