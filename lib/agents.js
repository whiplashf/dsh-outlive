/**
 * Agent catalog: known CLI presets, PATH probing, and command construction.
 *
 * A preset is "verified" only when its argument template has been exercised
 * against the real CLI. Unverified presets are still probed, so the panel can
 * show "installed, needs arguments" instead of pretending the agent is ready.
 */
import { spawnSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

export const PREFERENCE = Object.freeze(['opencode', 'codex', 'claude'])

export const PRESETS = Object.freeze([
  {
    name: 'opencode',
    label: 'OpenCode',
    args: 'run --standalone --auto --archived --title {title} -- {file}',
    verified: true,
  },
  {
    name: 'codex',
    label: 'Codex',
    args: 'exec --skip-git-repo-check -s workspace-write -- {file}',
    verified: true,
  },
  {
    name: 'claude',
    label: 'Claude Code',
    args: '-p --dangerously-skip-permissions {file}',
    verified: true,
  },
  { name: 'gemini', label: 'Gemini CLI', args: '', verified: false },
  { name: 'cursor-agent', label: 'Cursor Agent', args: '', verified: false },
  { name: 'copilot', label: 'GitHub Copilot CLI', args: '', verified: false },
  { name: 'aider', label: 'Aider', args: '', verified: false },
  { name: 'qwen', label: 'Qwen Code', args: '', verified: false },
  { name: 'goose', label: 'Goose', args: '', verified: false },
  { name: 'crush', label: 'Crush', args: '', verified: false },
  { name: 'amp', label: 'Amp', args: '', verified: false },
].map(Object.freeze))

/** PATH plus the install locations people actually use, in that order. */
export const EXTRA_BIN_DIRS = Object.freeze([
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.opencode', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), '.cargo', 'bin'),
  join(homedir(), '.npm-global', 'bin'),
  join(homedir(), 'go', 'bin'),
  '/usr/local/bin',
  '/usr/local/nodejs/bin',
  '/usr/bin',
])

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function searchDirs(pathEnv = process.env.PATH || '', extra = EXTRA_BIN_DIRS) {
  const seen = new Set()
  const dirs = []
  for (const dir of [...String(pathEnv).split(delimiter), ...extra]) {
    if (!dir || dir === '.' || seen.has(dir)) continue
    seen.add(dir)
    dirs.push(dir)
  }
  return dirs
}

/** Resolve `name` to an executable path. Absolute and relative paths are checked as given. */
export function findBinary(name, pathEnv = process.env.PATH || '') {
  if (typeof name !== 'string' || !name) return null
  if (name.includes('/')) {
    const path = isAbsolute(name) ? name : join(process.cwd(), name)
    return isExecutableFile(path) ? path : null
  }
  for (const dir of searchDirs(pathEnv)) {
    const candidate = join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/** First line of `--version`, or null. Never throws and never blocks for long. */
export function probeVersion(bin, timeout = 3000) {
  if (!bin) return null
  try {
    const result = spawnSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
    if (!text) return null
    const first = text.split(/\r?\n/).find((line) => line.trim())
    return first ? first.trim().slice(0, 120) : null
  } catch {
    return null
  }
}

/**
 * Build the shell command for an agent. `{file}` becomes a command
 * substitution that reads the task file without interpolating its content.
 */
export function buildAgentCommand({ bin, args, taskFile, title }) {
  if (!bin) throw new Error('agent has no executable')
  if (!args || !args.includes('{file}')) throw new Error('agent arguments must include {file}')
  const body = args
    .replaceAll('{file}', `"$(cat ${shellQuote(taskFile)})"`)
    .replaceAll('{title}', shellQuote(String(title || '').slice(0, 200)))
  return `exec ${shellQuote(bin)} ${body}`.trim()
}

function normalizeCustom(agent) {
  return {
    name: String(agent.name || '').trim(),
    label: String(agent.label || agent.name || '').trim(),
    bin: String(agent.bin || '').trim(),
    args: String(agent.args || '').trim(),
    source: 'custom',
    verified: false,
    presetArgs: '',
    installed: isExecutableFile(String(agent.bin || '')),
    version: null,
  }
}

/** Validate a custom agent form. Returns `{ ok }` or `{ error, detail }`. */
export function validateCustomAgent(input) {
  const name = String(input?.name || '').trim()
  const bin = String(input?.bin || '').trim()
  const args = String(input?.args || '').trim()
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/i.test(name)) return { error: 'invalidName' }
  if (!isAbsolute(bin)) return { error: 'binNotAbsolute' }
  if (!isExecutableFile(bin)) return { error: 'binNotExecutable' }
  if (!args.includes('{file}')) return { error: 'argsMissingFile' }
  return { ok: true, name, bin, args }
}

/**
 * @param pathEnv - PATH used for probing.
 * @param readCustom - returns the persisted custom agents.
 * @param now - clock injection for tests.
 * @param ttl - probe cache lifetime.
 */
export function createAgents({ pathEnv = process.env.PATH || '', readCustom = () => [], now = () => Date.now(), ttl = 30000 } = {}) {
  let cached = null
  let cachedAt = 0

  function customAgents() {
    try {
      return Array.isArray(readCustom()) ? readCustom() : []
    } catch {
      return []
    }
  }

  function probe() {
    const custom = customAgents().map(normalizeCustom)
    const customByName = new Map(custom.map((agent) => [agent.name, agent]))
    const entries = []
    for (const preset of PRESETS) {
      if (customByName.has(preset.name)) continue
      const bin = findBinary(preset.name, pathEnv)
      entries.push({
        ...preset,
        source: 'preset',
        bin,
        installed: Boolean(bin),
        version: probeVersion(bin),
      })
    }
    for (const agent of custom) {
      entries.push({ ...agent, installed: agent.installed && isExecutableFile(agent.bin), version: probeVersion(agent.bin) })
    }
    return entries
  }

  function list({ refresh = false } = {}) {
    if (!refresh && cached && now() - cachedAt < ttl) return cached
    cached = probe()
    cachedAt = now()
    return cached
  }

  function usable(agent) {
    return Boolean(agent && agent.installed && agent.args && agent.args.includes('{file}'))
  }

  function resolve(requested) {
    const agents = list()
    const want = String(requested || 'auto').trim() || 'auto'
    if (want === 'auto') {
      for (const name of PREFERENCE) {
        const agent = agents.find((entry) => entry.name === name)
        if (agent && usable(agent)) return { agent }
      }
      const rank = (name) => (PREFERENCE.includes(name) ? PREFERENCE.indexOf(name) : PREFERENCE.length)
      const ready = agents.filter(usable).sort((a, b) => rank(a.name) - rank(b.name))
      if (ready.length) return { agent: ready[0] }
      return { error: 'noneReady', detail: agents.filter((entry) => entry.installed).map((entry) => entry.name) }
    }
    const agent = agents.find((entry) => entry.name === want)
    if (!agent) return { error: 'unknown' }
    if (!agent.installed) return { error: 'notInstalled', agent }
    if (!usable(agent)) return { error: 'needsArguments', agent }
    return { agent }
  }

  return { list, resolve, usable, probeVersion }
}
