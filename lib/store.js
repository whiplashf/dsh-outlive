/**
 * The on-disk ledger: jobs, saved tasks, and custom agents.
 *
 * Records are small, so they are read and written synchronously. Writes go
 * through a temporary file and a rename so a crash cannot leave half a JSON
 * document behind. Job directories are addressed by a 12-hex id and every id
 * that comes from a request is validated before it reaches a path.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const JOB_ID = /^[0-9a-f]{12}$/
// `builtin-…` is kept so a task id written by an older release can still be
// deleted; no built-in task exists any more.
export const TASK_ID = /^(?:builtin-[a-z-]+|[0-9a-f]{12})$/
export const MAX_TASKS = 40
export const RETENTION = 200
/** Task ids from an older release that must disappear on read. */
const LEGACY_TASKS = Object.freeze(['builtin-restart-dsh'])

/** Expand only a leading `~/`; everything else is left to `resolve`. */
export function expandHome(value, home = homedir()) {
  const text = String(value ?? '')
  if (text === '~') return home
  if (text.startsWith('~/')) return join(home, text.slice(2))
  return text
}

/** `$OUTLIVE_HOME` wins, then an explicit config, then the XDG state home. */
export function resolveStateDir({ env = process.env, home = homedir(), configured } = {}) {
  if (env.OUTLIVE_HOME) return resolve(expandHome(env.OUTLIVE_HOME, home))
  if (typeof configured === 'string' && configured.trim()) return resolve(expandHome(configured, home))
  const xdg = env.XDG_STATE_HOME
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, '.local', 'state')
  return join(base, 'outlive')
}

export function newJobId() {
  return randomBytes(6).toString('hex')
}

export function taskKey({ kind, command, agent, cwd }) {
  return createHash('sha256')
    .update([kind || '', command || '', agent || '', cwd || ''].join('\u0000'))
    .digest('hex')
    .slice(0, 12)
}

function nowIso(now) {
  return new Date(now()).toISOString()
}

function atomicWrite(path, text, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
  writeFileSync(tmp, text, { mode })
  renameSync(tmp, path)
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      // best effort; the fallback still keeps the plugin usable
    }
    return fallback
  }
}

function writeJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function createStore({ stateDir, now = () => Date.now() } = {}) {
  if (!stateDir) throw new Error('createStore requires a stateDir')
  const jobsDir = join(stateDir, 'jobs')
  const tasksPath = join(stateDir, 'tasks.json')
  const agentsPath = join(stateDir, 'agents.json')

  mkdirSync(jobsDir, { recursive: true, mode: 0o700 })

  function jobDir(id) {
    if (!JOB_ID.test(String(id ?? ''))) throw new Error(`invalid job id: ${id}`)
    return join(jobsDir, id)
  }

  function readJob(id) {
    if (!JOB_ID.test(String(id ?? ''))) return null
    const record = readJson(join(jobDir(id), 'job.json'), null)
    if (!record || typeof record !== 'object') return null
    if (!record.agent && record.engine) record.agent = record.engine
    return record
  }

  function writeJob(job) {
    writeJson(join(jobDir(job.id), 'job.json'), job)
  }

  function patchJob(id, patch) {
    const current = readJob(id)
    if (!current) return null
    const next = { ...current, ...patch }
    writeJob(next)
    return next
  }

  function listJobs({ limit } = {}) {
    let entries = []
    try {
      entries = readdirSync(jobsDir, { withFileTypes: true })
    } catch {
      return []
    }
    const jobs = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !JOB_ID.test(entry.name)) continue
      const job = readJob(entry.name)
      if (job) jobs.push(job)
    }
    jobs.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
    return limit === undefined ? jobs : jobs.slice(0, Math.max(0, Math.trunc(limit)))
  }

  function createJob(record) {
    const job = {
      version: 1,
      status: 'running',
      exitCode: null,
      finishedAt: null,
      killed: false,
      error: null,
      sessionId: null,
      lang: 'en',
      notify: { state: 'none', attempts: 0 },
      runtimeMaxSec: 7200,
      ...record,
      id: record.id || newJobId(),
      startedAt: record.startedAt || nowIso(now),
    }
    job.dir = jobDir(job.id)
    job.logPath = join(job.dir, 'out.log')
    mkdirSync(job.dir, { recursive: true, mode: 0o700 })
    writeJob(job)
    return job
  }

  function readExit(job) {
    try {
      const text = readFileSync(join(job.dir || jobDir(job.id), 'exit'), 'utf8').trim()
      if (!text) return null
      const [codeText, atText] = text.split(/\s+/)
      const code = Number(codeText)
      if (!Number.isFinite(code)) return null
      return { code, at: Number(atText) || null }
    } catch {
      return null
    }
  }

  /**
   * Move a running job to its terminal state.
   * @param job - the ledger record.
   * @param unit - optional `{ activeState, execMainStatus, result }` probe.
   */
  function settle(job, { unit } = {}) {
    if (!job || job.status !== 'running') return job
    const exit = readExit(job)
    if (exit) {
      const status = job.killed ? 'cancelled' : exit.code === 0 ? 'completed' : 'failed'
      return patchJob(job.id, {
        status,
        exitCode: exit.code,
        finishedAt: exit.at ? new Date(exit.at).toISOString() : nowIso(now),
        notify: { ...(job.notify || {}), state: job.sessionId ? 'pending' : 'none' },
      })
    }
    const alive = ['active', 'activating', 'reloading'].includes(unit?.activeState)
    if (unit && !alive) {
      const code = Number.isFinite(unit.execMainStatus) ? unit.execMainStatus : null
      return patchJob(job.id, {
        status: job.killed ? 'cancelled' : 'failed',
        exitCode: code,
        finishedAt: nowIso(now),
        error: `unit ${unit.activeState || 'inactive'}${unit.result && unit.result !== 'success' ? ` (${unit.result})` : ''}`,
        notify: { ...(job.notify || {}), state: job.sessionId ? 'pending' : 'none' },
      })
    }
    return job
  }

  function removeJob(id) {
    if (!JOB_ID.test(String(id ?? ''))) return { error: 'invalidId' }
    const job = readJob(id)
    if (!job) return { error: 'notFound' }
    if (job.status === 'running') return { error: 'running' }
    rmSync(jobDir(id), { recursive: true, force: true })
    return { ok: true }
  }

  function clearSettled() {
    let removed = 0
    for (const job of listJobs()) {
      if (job.status === 'running') continue
      if (removeJob(job.id).ok) removed += 1
    }
    return { removed }
  }

  /** Keep the newest `keep` settled jobs; running jobs are never touched. */
  function prune({ keep = RETENTION } = {}) {
    const settled = listJobs().filter((job) => job.status !== 'running')
    if (settled.length <= keep) return { removed: 0 }
    let removed = 0
    for (const job of settled.slice(keep)) {
      if (removeJob(job.id).ok) removed += 1
    }
    return { removed }
  }

  function readTaskState() {
    const raw = readJson(tasksPath, null)
    if (!raw || typeof raw !== 'object') return { version: 1, tasks: [] }
    const tasks = Array.isArray(raw.tasks) ? raw.tasks : []
    return {
      version: 1,
      // A release of this plugin shipped a built-in restart task. Its id is
      // dropped here so an upgrade cannot leave a task that no longer runs.
      tasks: tasks.filter((task) => !(task && LEGACY_TASKS.includes(task.id))),
    }
  }

  function writeTaskState(state) {
    writeJson(tasksPath, {
      version: 1,
      tasks: state.tasks.slice(0, MAX_TASKS),
    })
  }

  function readTasks() {
    return readTaskState().tasks
  }

  function saveTask(input) {
    const kind = input.kind === 'command' ? 'command' : 'agent'
    const command = kind === 'command' ? String(input.command || '').trim() : ''
    const task = kind === 'agent' ? String(input.task || '').trim() : ''
    if (kind === 'command' && !command) return { error: 'commandEmpty' }
    if (kind === 'agent' && !task) return { error: 'taskEmpty' }
    const agent = kind === 'agent' ? String(input.agent || '').trim() || null : null
    const cwd = String(input.cwd || '').trim() || null
    const body = kind === 'command' ? command : task
    const label = String(input.label || '').trim() || body.split('\n')[0].slice(0, 60)
    const id = taskKey({ kind, command: body, agent, cwd })
    const state = readTaskState()
    const existing = state.tasks.find((entry) => entry && entry.id === id)
    const next = {
      id,
      kind,
      label,
      command: kind === 'command' ? command : null,
      task: kind === 'agent' ? task : null,
      agent,
      cwd,
      createdAt: existing?.createdAt || nowIso(now),
      lastRunAt: existing?.lastRunAt || null,
      runs: existing?.runs || 0,
    }
    state.tasks = [next, ...state.tasks.filter((entry) => entry && entry.id !== id)]
    if (state.tasks.length > MAX_TASKS) state.tasks.pop()
    writeTaskState(state)
    return { task: next }
  }

  function bumpTask(id) {
    const state = readTaskState()
    const task = state.tasks.find((entry) => entry && entry.id === id)
    if (!task) return null
    task.lastRunAt = nowIso(now)
    task.runs = (task.runs || 0) + 1
    writeTaskState(state)
    return task
  }

  function deleteTask(id) {
    const state = readTaskState()
    const task = state.tasks.find((entry) => entry && entry.id === id)
    if (!task) return { error: 'notFound' }
    state.tasks = state.tasks.filter((entry) => entry && entry.id !== id)
    writeTaskState(state)
    return { ok: true }
  }

  function readAgents() {
    const raw = readJson(agentsPath, null)
    const agents = raw && Array.isArray(raw.agents) ? raw.agents : []
    return agents
      .filter((agent) => agent && typeof agent.name === 'string' && typeof agent.bin === 'string')
      .map((agent) => ({
        name: agent.name,
        label: agent.label || agent.name,
        bin: agent.bin,
        args: agent.args || '',
        createdAt: agent.createdAt || null,
      }))
  }

  function writeAgents(agents) {
    writeJson(agentsPath, { version: 1, agents })
  }

  function upsertAgent(agent) {
    const agents = readAgents().filter((entry) => entry.name !== agent.name)
    agents.push(agent)
    writeAgents(agents)
    return agent
  }

  function removeAgent(name) {
    const agents = readAgents()
    const next = agents.filter((entry) => entry.name !== name)
    if (next.length === agents.length) return { error: 'notFound' }
    writeAgents(next)
    return { ok: true }
  }

  function stats() {
    let bytes = 0
    try {
      const entries = readdirSync(jobsDir)
      for (const entry of entries) {
        if (!JOB_ID.test(entry)) continue
        try {
          bytes += statSync(join(jobsDir, entry, 'out.log')).size
        } catch {
          // a job without a log yet contributes nothing
        }
      }
    } catch {
      // no jobs directory yet
    }
    return { jobCount: listJobs().length, logBytes: bytes, exists: existsSync(stateDir) }
  }

  return {
    stateDir,
    jobsDir,
    tasksPath,
    agentsPath,
    jobDir,
    readJob,
    writeJob,
    patchJob,
    createJob,
    listJobs,
    readExit,
    settle,
    removeJob,
    clearSettled,
    prune,
    readTasks,
    readTaskState,
    saveTask,
    bumpTask,
    deleteTask,
    readAgents,
    writeAgents,
    upsertAgent,
    removeAgent,
    stats,
  }
}
