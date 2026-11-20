/**
 * outlive — hand work to something that outlives the harness process.
 *
 * Every background job the harness itself starts (including `bash` with
 * `run_in_background`) is a child of the `dsh web` process. Restart that process
 * — which is exactly what you do when you are fixing the process itself — and
 * the job dies mid-step with no record that it ever ran.
 *
 * So this bundle never runs anything itself. It writes a script, hands it to a
 * transient systemd unit in a *different* cgroup, and afterwards only reads
 * files: the job's log, its exit marker, its metadata. Restart the harness and
 * nothing is lost except the in-memory polling loop, which reloads and picks the
 * work back up — including telling the session how it ended.
 *
 * Three layers, deliberately separate:
 *   tools    — what the model can call
 *   dispatch — how a job becomes a systemd unit (the only OS-specific part)
 *   record   — the on-disk job directory, which is the source of truth
 */

import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'outlive'
export const inject = ['tools', 'agents']

const STATE_DIR = process.env.OUTLIVE_HOME || join(homedir(), 'runtime', 'outlive')
const UNIT_PREFIX = 'outlive-'
const DEFAULT_RUNTIME_MAX_SEC = 2 * 60 * 60
const MAX_TAIL_LINES = 400
const MAX_RESULT_BYTES = 16 * 1024
const ID_PATTERN = /^[a-z0-9]{6,16}$/
const DEFAULT_PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin'

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

function jobDir(id) {
  return join(STATE_DIR, id)
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function readJob(id) {
  if (!ID_PATTERN.test(String(id ?? ''))) return undefined
  const job = readJson(join(jobDir(id), 'job.json'), undefined)
  return job && typeof job === 'object' && typeof job.id === 'string' ? job : undefined
}

function writeJob(job) {
  writeFileSync(join(jobDir(job.id), 'job.json'), `${JSON.stringify(job, null, 2)}\n`)
}

/**
 * Write only the fields one reader owns, on top of a fresh read.
 *
 * The record has several independent writers — the launcher, the poll loop
 * settling a finished job, the delivery ledger, a cancel — and they run in
 * different ticks. Rewriting a whole record from a stale read silently undoes
 * another writer's field, which is how `sessionId` used to disappear between
 * dispatch and the first poll.
 */
function patchJob(id, patch) {
  const current = readJson(join(jobDir(id), 'job.json'), undefined)
  if (!current) return undefined
  const next = { ...current, ...patch }
  writeJob(next)
  return next
}

// ---------------------------------------------------------------------------
// saved tasks — the panel's "常用任务" list, on disk next to the jobs
// ---------------------------------------------------------------------------

const TASKS_PATH = join(STATE_DIR, 'tasks.json')
const MAX_TASKS = 40

/** Read the saved-task list, dropping anything a hand edit left malformed. */
function readTasks() {
  const value = readJson(TASKS_PATH, undefined)
  const list = Array.isArray(value && value.tasks) ? value.tasks : []
  return list.filter((task) => task
    && typeof task.id === 'string'
    && typeof task.command === 'string'
    && task.command.trim() !== '')
}

function writeTasks(tasks) {
  writeFileSync(TASKS_PATH, `${JSON.stringify({ tasks }, null, 2)}\n`)
}

/** Content-addressed id: saving the same command twice updates one row. */
function taskKey(command) {
  return createHash('sha256').update(String(command)).digest('hex').slice(0, 12)
}

/**
 * Save or update one task.
 *
 * Identity is the command text, so re-saving an edited label keeps one row
 * instead of growing a duplicate with the same meaning.
 */
function saveTask({ label, command, cwd }) {
  const text = String(command ?? '').trim()
  if (!text) return undefined
  const tasks = readTasks()
  const id = taskKey(text)
  const now = new Date().toISOString()
  const existing = tasks.find((task) => task.id === id)
  const next = {
    id,
    command: text,
    label: String(label ?? '').trim() || existing?.label || text.split('\n')[0].slice(0, 60),
    cwd: String(cwd ?? '').trim() || existing?.cwd || '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    runCount: existing?.runCount ?? 0,
    lastRunAt: existing?.lastRunAt,
  }
  const rest = tasks.filter((task) => task.id !== id)
  rest.unshift(next)
  writeTasks(rest.slice(0, MAX_TASKS))
  return next
}

function dropTask(id) {
  const tasks = readTasks()
  const kept = tasks.filter((task) => task.id !== id)
  writeTasks(kept)
  return kept.length !== tasks.length
}

function bumpTask(id, jobId) {
  const tasks = readTasks()
  const task = tasks.find((entry) => entry.id === id)
  if (!task) return undefined
  task.runCount = (task.runCount ?? 0) + 1
  task.lastRunAt = new Date().toISOString()
  writeTasks(tasks)
  return jobId
}

/** Collect one JSON request body, bounded — these routes are small by design. */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * The panel's write routes require this header.
 *
 * The gate already authenticates the human; this is the second, cheaper lock:
 * a form post from some other origin cannot set a custom header without a
 * preflight the panel never grants.
 */
function fromPanel(req) {
  return String(req.headers['x-outlive'] || '') === '1'
}

async function readPanelJson(req, res) {
  if (!fromPanel(req)) {
    sendJson(res, 403, { error: '缺少 x-outlive 头' })
    return undefined
  }
  const raw = await readBody(req)
  if (raw.trim() === '') return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : {}
  } catch {
    sendJson(res, 400, { error: '请求体不是 JSON' })
    return undefined
  }
}

function tail(path, lines) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return ''
  }
  if (text.length > MAX_RESULT_BYTES) text = text.slice(-MAX_RESULT_BYTES)
  const split = text.split('\n')
  return split.slice(Math.max(0, split.length - lines)).join('\n').trimEnd()
}

function listJobs(limit, settleRecords = true) {
  let entries
  try {
    entries = readdirSync(STATE_DIR)
  } catch {
    return []
  }
  const jobs = []
  for (const id of entries) {
    const job = readJob(id)
    if (job) jobs.push(settleRecords ? settle(job) : job)
  }
  jobs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
  return Number.isFinite(limit) ? jobs.slice(0, limit) : jobs
}

/**
 * Freeze a running job once its exit marker has content.
 *
 * An empty marker means "the script has not finished", never "failed" — that is
 * why the marker records the exit code and its timestamp together, written last.
 */
function settle(job) {
  if (job.status !== 'running') return job
  let raw
  try {
    raw = readFileSync(join(jobDir(job.id), 'exit'), 'utf8').trim()
  } catch {
    return job
  }
  if (raw === '') return job
  const [codeText, atText] = raw.split(/\s+/)
  const code = Number.parseInt(codeText, 10)
  const at = Number.parseInt(atText, 10)
  const exitCode = Number.isFinite(code) ? code : null
  const status = job.killed === true ? 'killed' : (exitCode === 0 ? 'completed' : 'failed')
  const finishedAt = new Date(Number.isFinite(at) ? at : Date.now()).toISOString()
  return patchJob(job.id, { exitCode, status, finishedAt })
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

function run(command, args, { timeout = 20_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, out, err: String(error.message || error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

/**
 * Write the runner script. It owns its own log redirection and its exit marker,
 * so the unit has no reason to phone home: an unfinished run is simply a run
 * whose marker has no content yet.
 */
function writeRunner({ dir, command, cwd }) {
  const logPath = join(dir, 'out.log')
  const exitPath = join(dir, 'exit')
  const scriptPath = join(dir, 'run.sh')
  const commandPath = join(dir, 'command.sh')
  const workdir = cwd || homedir()

  // The caller's text is its own file, run as its own process. Inlined, a single
  // `exit 0` in the command would end the runner before it could record the
  // outcome — and the job would look like it never finished.
  writeFileSync(commandPath, `${command}\n`)
  chmodSync(commandPath, 0o755)

  writeFileSync(scriptPath, [
    '#!/usr/bin/env bash',
    `exec >> ${shellQuote(logPath)} 2>&1`,
    `cd ${shellQuote(workdir)} || { echo "outlive: cannot enter ${workdir}" >&2; echo "1 $(date +%s%3N)" > ${shellQuote(exitPath)}; exit 1; }`,
    'echo "outlive: start $(date -Is) in $(pwd)"',
    `/usr/bin/env bash ${shellQuote(commandPath)}`,
    'code=$?',
    'echo "outlive: exit ${code} $(date -Is)"',
    `echo "$code $(date +%s%3N)" > ${shellQuote(exitPath)}`,
    'exit "$code"',
    '',
  ].join('\n'))
  chmodSync(scriptPath, 0o755)
  return { logPath, scriptPath, commandPath }
}

/**
 * Launch one detached unit and record it.
 *
 * @param spec.kind - `run` or `agent`, for display only
 * @param spec.id - reuse a caller-made id (the agent path needs the task file
 *   written before dispatch, so it reserves the id first)
 */
async function dispatch(spec) {
  const id = spec.id || randomUUID().replaceAll('-', '').slice(0, 12)
  const dir = spec.dir || jobDir(id)
  mkdirSync(dir, { recursive: true })

  const { logPath, scriptPath } = writeRunner({ dir, command: spec.command, cwd: spec.cwd })
  const job = {
    id,
    kind: spec.kind || 'run',
    label: spec.label || String(spec.command).split('\n')[0].slice(0, 80),
    command: spec.command,
    cwd: spec.cwd || homedir(),
    unit: `${UNIT_PREFIX}${id}`,
    dir,
    logPath,
    startedAt: new Date().toISOString(),
    status: 'running',
    exitCode: null,
    sessionId: null,
    notices: [],
    runtimeMaxSec: spec.runtimeMaxSec,
  }
  writeJob(job)

  const env = Object.entries(spec.env && typeof spec.env === 'object' ? spec.env : {})
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => `--setenv=${key}=${value}`)

  const result = await run('systemd-run', [
    '--user', '--collect', '--quiet',
    `--unit=${job.unit}`,
    `--description=outlive: ${String(job.label).slice(0, 120)}`,
    `--property=RuntimeMaxSec=${job.runtimeMaxSec}`,
    `--property=WorkingDirectory=${job.cwd}`,
    `--setenv=HOME=${homedir()}`,
    `--setenv=PATH=${DEFAULT_PATH}`,
    `--setenv=LANG=${process.env.LANG || 'C.UTF-8'}`,
    ...env,
    '--', '/usr/bin/env', 'bash', scriptPath,
  ])
  if (result.code !== 0) {
    const detail = (result.err || result.out || 'systemd-run failed').trim()
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.error = detail
    writeJob(job)
    return { job, error: detail }
  }
  return { job }
}

/**
 * Stop a job and record the outcome ourselves.
 *
 * Stopping the unit kills the runner too, so the runner can never write its own
 * exit marker — the canceller is the last writer we can rely on. `143` is the
 * conventional 128+SIGTERM, and `killed: true` is what turns it into `killed`
 * rather than a failure.
 */
async function killUnit(job) {
  const result = await run('systemctl', ['--user', 'stop', job.unit])
  if (result.code !== 0) {
    const detail = (result.err || result.out || 'systemctl stop failed').trim()
    if (!/not loaded|not found|no such|Failed to stop/i.test(detail)) return { ok: false, detail }
  }
  writeFileSync(join(jobDir(job.id), 'exit'), `143 ${Date.now()}`)
  patchJob(job.id, { killed: true })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// delivery: a finished job is a message the session did not ask for
// ---------------------------------------------------------------------------

/** Live agents by session id; a restarted harness repopulates this as sessions open. */
const agents = new Map()

function sessionKey(agent) {
  const id = agent?.session?.id
  return id === undefined ? undefined : String(id)
}

function noticeText(job) {
  const elapsed = job.finishedAt && job.startedAt
    ? Math.max(0, Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000))
    : null
  const head = `[outlive] 任务 ${job.id}（${job.label}）已结束：${job.status}`
    + (job.exitCode === null ? '' : `，exit ${job.exitCode}`)
    + (elapsed === null ? '' : `，用时 ${elapsed}s`)
  const body = tail(job.logPath, 12)
  return [
    head,
    `日志：${job.logPath}`,
    body ? `最后几行：\n${body}` : '（日志为空）',
    `要看全部用 outlive_status("${job.id}")。`,
  ].join('\n')
}

function userMessage(text, jobId) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'outlive', jobId },
  }
}

/** Deliver once per owning session; the record keeps the ledger. */
function deliver(job) {
  const key = job.sessionId
  if (!key) return false
  const agent = agents.get(key)
  if (!agent) return false
  if (Array.isArray(job.notices) && job.notices.includes(key)) return false
  try {
    agent.followup(userMessage(noticeText(job), job.id))
  } catch {
    return false
  }
  const current = readJson(join(jobDir(job.id), 'job.json'), job)
  patchJob(job.id, { notices: [...(current.notices || []), key] })
  return true
}

/** Anything that finished while the session was away is still owed to it. */
function adopt(agent) {
  const key = sessionKey(agent)
  if (!key) return
  agents.set(key, agent)
  for (const job of listJobs()) {
    if (job.sessionId !== key || job.status === 'running') continue
    deliver(job)
  }
}

// ---------------------------------------------------------------------------
// tool plumbing
// ---------------------------------------------------------------------------

function clip(text, max = MAX_RESULT_BYTES) {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, max)}\n…（已截断）`
}

function textResult(text) {
  return { text: clip(text) }
}

function renderText(_args, value) {
  return [{ type: 'text', text: value.text }]
}

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string', description: 'Tool result as markdown/plain text.' } },
    required: ['text'],
  },
  render: renderText,
}

/** Compile the per-property map into the JSON Schema the registry puts on the wire. */
function parameterSchema(parameters = {}) {
  const properties = {}
  const required = []
  for (const [key, value] of Object.entries(parameters)) {
    if (value && value.required === true) {
      const { required: _required, ...schema } = value
      properties[key] = schema
      required.push(key)
    } else {
      properties[key] = value
    }
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

function describe(job) {
  const exit = job.exitCode === null ? '' : ` exit=${job.exitCode}`
  return `${job.id}  ${job.status}${exit}  ${job.startedAt}  ${job.label}`
}

function runtimeMax(value) {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : DEFAULT_RUNTIME_MAX_SEC
}

/**
 * Built-in executors, best first. Each `build` returns a shell snippet rather
 * than an argv: the runner is a shell script, and reading the task out of its
 * file keeps user text away from any quoting boundary.
 *
 * Every one of them is started non-interactively and pre-authorized, because
 * there is no human at the other end to answer a prompt.
 */
const BUILTIN_ENGINES = {
  opencode: {
    label: 'OpenCode',
    bin: 'opencode',
    versionArgs: ['--version'],
    build: (file, title) => 'exec "$(command -v opencode || echo /usr/local/nodejs/bin/opencode)"'
      + ` run --standalone --auto --archived --title ${shellQuote(title)} -- "$(cat ${shellQuote(file)})"`,
  },
  codex: {
    label: 'Codex',
    bin: 'codex',
    versionArgs: ['--version'],
    build: (file) => 'exec "$(command -v codex || echo /usr/local/nodejs/bin/codex)"'
      + ` exec --skip-git-repo-check -s workspace-write -- "$(cat ${shellQuote(file)})"`,
  },
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    build: (file) => 'exec "$(command -v claude || echo /usr/local/nodejs/bin/claude)"'
      + ` -p --dangerously-skip-permissions "$(cat ${shellQuote(file)})"`,
  },
}

const PREFERRED_ENGINES = ['opencode', 'codex', 'claude']
const ENGINE_CACHE_MS = 30_000

function findBinary(bin) {
  for (const dir of DEFAULT_PATH.split(':')) {
    if (!dir) continue
    const candidate = join(dir, bin)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function binaryVersion(path, args) {
  try {
    const out = execFileSync(path, args, { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    return String(out).trim().split('\n')[0].slice(0, 60)
  } catch {
    return ''
  }
}

let engineCache

/**
 * What can actually run on this machine right now, in preference order.
 * Detection is a PATH lookup plus a `--version`, so it is cached: a tool call
 * should not pay three process spawns to learn nothing changed.
 */
function detectedEngines(config, { refresh = false } = {}) {
  if (!refresh && engineCache && Date.now() - engineCache.at < ENGINE_CACHE_MS) return engineCache.list
  const custom = config?.engines && typeof config.engines === 'object' ? config.engines : {}
  const names = [...new Set([...PREFERRED_ENGINES, ...Object.keys(custom)])]
  const list = []
  for (const name of names) {
    const builtin = BUILTIN_ENGINES[name]
    const build = typeof custom[name] === 'function' ? custom[name] : builtin?.build
    if (typeof build !== 'function') continue
    const bin = builtin?.bin || name
    const path = findBinary(bin)
    if (!path) continue
    list.push({
      name,
      label: builtin?.label || name,
      bin: path,
      version: builtin ? binaryVersion(path, builtin.versionArgs) : '',
    })
  }
  engineCache = { at: Date.now(), list }
  return list
}

/** Resolve `engine` to the snippet that runs it, or say why it cannot. */
function resolveEngine(requested, config) {
  const asked = String(requested || 'auto').trim() || 'auto'
  const available = detectedEngines(config)
  const pick = asked === 'auto'
    ? available.find((engine) => engine.name === config?.defaultEngine) ?? available[0]
    : available.find((engine) => engine.name === asked)
  if (!pick) {
    const known = [...new Set([...PREFERRED_ENGINES, ...Object.keys(config?.engines || {})])]
    return asked === 'auto'
      ? { error: `本机没检测到可用的编码 agent（找过 ${known.join(' / ')}）。` }
      : { error: `执行器 "${asked}" 不可用。本机可用：${available.map((e) => e.name).join(', ') || '（无）'}` }
  }
  const custom = config?.engines?.[pick.name]
  const build = typeof custom === 'function' ? custom : BUILTIN_ENGINES[pick.name].build
  return { engine: pick, build }
}

// ---------------------------------------------------------------------------
// panel: the small JSON surface the browser side (client.js) reads
// ---------------------------------------------------------------------------

/**
 * A running job is shown as settled once its exit marker has content, but read
 * here *without* writing: settling is the poll loop's job, and a panel refresh
 * must never steal the one transition that owes the session a notice.
 */
function peekStatus(job) {
  if (job.status !== 'running') return job
  let raw
  try {
    raw = readFileSync(join(jobDir(job.id), 'exit'), 'utf8').trim()
  } catch {
    return job
  }
  if (raw === '') return job
  const [codeText, atText] = raw.split(/\s+/)
  const code = Number.parseInt(codeText, 10)
  const at = Number.parseInt(atText, 10)
  const exitCode = Number.isFinite(code) ? code : null
  return {
    ...job,
    exitCode,
    status: job.killed === true ? 'killed' : (exitCode === 0 ? 'completed' : 'failed'),
    finishedAt: new Date(Number.isFinite(at) ? at : Date.now()).toISOString(),
  }
}

function panelJob(job) {
  const shown = peekStatus(job)
  return {
    id: shown.id,
    status: shown.status,
    kind: shown.kind,
    engine: shown.engine || null,
    label: shown.label,
    cwd: shown.cwd || null,
    startedAt: shown.startedAt,
    finishedAt: shown.finishedAt || null,
    exitCode: shown.exitCode ?? null,
    error: shown.error || null,
  }
}

function sendText(res, status, body, type = 'text/plain; charset=utf-8') {
  if (res.headersSent) return
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendJson(res, status, value) {
  sendText(res, status, JSON.stringify(value), 'application/json; charset=utf-8')
}

/** What `engine: 'auto'` would pick right now, for the panel header. */
function resolvedDefault(config) {
  const picked = resolveEngine('auto', config)
  return picked.engine ? { name: picked.engine.name, label: picked.engine.label } : null
}

export function apply(ctx, config = {}) {
  mkdirSync(STATE_DIR, { recursive: true })

  const register = (definition) => ctx.tools.register({
    ...definition,
    parameters: parameterSchema(definition.parameters),
  })

  // The panel lives on the same origin as the page, so it rides the host web
  // server instead of opening a port of its own. No secrets cross this line:
  // job labels, statuses and the tail of a log the model can already read.
  //
  // Routes are registered in a *child* fiber that waits for `webServer`: a
  // profile without a web server (headless, CLI) must still get the tools, so
  // this dependency cannot be in `inject`, and a plain `ctx.get()` here would
  // read `undefined` — bundle plugins mount before the web layers do.
  ctx.inject(['webServer'], (web) => {
    web.effect(() => web.webServer.register({
      kind: 'exact',
      path: '/__outlive/jobs',
      handler(_req, res) {
        sendJson(res, 200, {
          engines: detectedEngines(config),
          defaultEngine: resolvedDefault(config),
          stateDir: STATE_DIR,
          jobs: listJobs(undefined, false).map(panelJob),
        })
      },
    }))
    web.effect(() => web.webServer.register({
      kind: 'exact',
      path: '/__outlive/log',
      handler(req, res) {
        const url = new URL(req.url || '/', 'http://localhost')
        const id = String(url.searchParams.get('id') || '')
        if (!ID_PATTERN.test(id)) return sendJson(res, 400, { error: 'id 不合法' })
        const job = readJob(id)
        if (!job) return sendJson(res, 404, { error: `没有任务 ${id}` })
        const lines = Math.min(MAX_TAIL_LINES, Math.max(1, Math.trunc(Number(url.searchParams.get('tail')) || 200)))
        sendText(res, 200, tail(join(jobDir(id), 'out.log'), lines) || '（暂无输出）')
      },
    }))
    // The three surfaces the user asked for from the panel: detect engines
    // again on demand, keep a short list of tasks worth repeating, and start
    // one without going through the model.
    web.effect(() => web.webServer.register({
      kind: 'exact',
      path: '/__outlive/engines',
      handler(req, res) {
        const url = new URL(req.url || '/', 'http://localhost')
        const refresh = url.searchParams.get('refresh') === '1'
        sendJson(res, 200, {
          engines: detectedEngines(config, { refresh }),
          defaultEngine: resolvedDefault(config),
        })
      },
    }))
    web.effect(() => web.webServer.register({
      kind: 'exact',
      path: '/__outlive/tasks',
      async handler(req, res) {
        if ((req.method || 'GET').toUpperCase() === 'GET') {
          return sendJson(res, 200, { tasks: readTasks() })
        }
        const body = await readPanelJson(req, res)
        if (body === undefined) return undefined
        const task = saveTask({ label: body.label, command: body.command, cwd: body.cwd })
        if (!task) return sendJson(res, 400, { error: 'command 不能为空' })
        return sendJson(res, 200, { task, tasks: readTasks() })
      },
    }))
    web.effect(() => web.webServer.register({
      kind: 'exact',
      path: '/__outlive/tasks/delete',
      async handler(req, res) {
        const body = await readPanelJson(req, res)
        if (body === undefined) return undefined
        const id = String(body.id || '')
        if (!/^[0-9a-f]{12}$/.test(id)) return sendJson(res, 400, { error: 'id 不合法' })
        return sendJson(res, 200, { removed: dropTask(id), tasks: readTasks() })
      },
    }))
    web.effect(() => web.webServer.register({
      kind: 'exact',
      path: '/__outlive/run',
      async handler(req, res) {
        const body = await readPanelJson(req, res)
        if (body === undefined) return undefined
        const command = String(body.command ?? '').trim()
        if (!command) return sendJson(res, 400, { error: 'command 不能为空' })
        const { job, error } = await dispatch({
          kind: 'run',
          command,
          cwd: String(body.cwd ?? '').trim() || undefined,
          label: String(body.label ?? '').trim() || undefined,
          runtimeMaxSec: runtimeMax(body.runtime_max_sec),
        })
        if (error) return sendJson(res, 500, { error })
        if (body.taskId) bumpTask(String(body.taskId), job.id)
        return sendJson(res, 200, { id: job.id, unit: job.unit })
      },
    }))
  })

  register({
    name: 'outlive_run',
    description:
      '把一条 shell 命令投递到 harness 进程之外运行（systemd 瞬态 unit），立刻返回任务 id。\n\n'
      + '什么时候用它而不是 bash 的后台任务：当这件事必须在下一次 harness 重启之后还活着——重启服务、迁移、'
      + '长跑（建索引、批量下载、编译）、或者任何“dsh 死了就等于白跑”的工作。bash 的 run_in_background 是 dsh web '
      + '的子进程，dsh 重启即死；outlive 的 unit 在另一个 cgroup 里，不受影响。\n\n'
      + '跑完如果会话还活着，会自动收到一条结果消息；会话不在的话，下次打开补发。'
      + '用 outlive_status 看日志，outlive_list 看历史，outlive_cancel 中止。',
    parameters: {
      command: { type: 'string', required: true, description: '要执行的命令（bash 语义，工作目录见 cwd）。' },
      label: { type: 'string', description: '一句话说明这次在做什么，出现在列表和完成通知里。' },
      cwd: { type: 'string', description: '工作目录，默认 $HOME。' },
      runtime_max_sec: { type: 'integer', description: `最长运行秒数，默认 ${DEFAULT_RUNTIME_MAX_SEC}；到点 systemd 杀掉它。` },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: '额外环境变量（走 --setenv 传给 unit）。',
      },
    },
    output,
    async execute(args, exec) {
      const command = String(args.command ?? '').trim()
      if (!command) return textResult('ERROR: command 不能为空')
      const { job, error } = await dispatch({
        kind: 'run',
        command,
        cwd: args.cwd,
        label: args.label,
        env: args.env,
        runtimeMaxSec: runtimeMax(args.runtime_max_sec),
      })
      if (error) return textResult(`ERROR: 投递失败（${error}）\n目录：${job.dir}`)
      const sessionId = sessionKey(exec?.agent) ?? null
      if (sessionId) {
        agents.set(sessionId, exec.agent)
        patchJob(job.id, { sessionId })
      }
      return textResult([
        `已投递：${job.id}（unit ${job.unit}）`,
        `目录：${job.dir}`,
        `日志：${job.logPath}`,
        '它在 harness 之外运行，重启 dsh 不会中断；结束时会把结果送回来。',
      ].join('\n'))
    },
  })

  register({
    name: 'outlive_agent',
    description:
      '把一整件任务交给一个离场编码 agent 去做：它在本机独立进程里跑，不占当前会话的上下文，'
      + '也不受 harness 重启影响。返回任务 id，完成时结果送回会话。\n\n'
      + '引擎默认自动挑：探测本机装了哪些编码 agent（opencode / codex / claude），按这个顺序选第一个可用的；'
      + '也可以用 engine 点名。想知道探测结果就调 outlive_engines。\n\n'
      + '和内置 subagent 的区别：内置 subagent 活在 dsh web 里，dsh 一重启就一起没了，而且整个过程占着当前回合；'
      + 'outlive_agent 是“交出去就不管了”，你可以继续做别的，它跑完来敲你。'
      + '适合自成一体、耗时、能独立验收的活（写一个脚本并测通、跑一次迁移、某个仓库的调研）。'
      + '不适合需要你中途盯着、频繁来回确认的活。',
    parameters: {
      task: { type: 'string', required: true, description: '完整任务描述。对方看不到这段对话，必须自带上下文、路径和验收标准。' },
      engine: { type: 'string', description: '执行器；不给就自动挑（opencode → codex → claude 里第一个装着的）。' },
      label: { type: 'string', description: '一句话标题，出现在列表里。' },
      cwd: { type: 'string', description: '在哪个目录里干，默认 $HOME。' },
      runtime_max_sec: { type: 'integer', description: `最长运行秒数，默认 ${DEFAULT_RUNTIME_MAX_SEC}。` },
    },
    output,
    async execute(args, exec) {
      const task = String(args.task ?? '').trim()
      if (!task) return textResult('ERROR: task 不能为空')
      const resolved = resolveEngine(args.engine, config)
      if (resolved.error) return textResult(`ERROR: ${resolved.error}`)
      const engine = resolved.engine.name
      const title = args.label || task.split('\n')[0].slice(0, 60)
      const id = randomUUID().replaceAll('-', '').slice(0, 12)
      const dir = jobDir(id)
      mkdirSync(dir, { recursive: true })
      const taskFile = join(dir, 'task.txt')
      writeFileSync(taskFile, task)
      const command = resolved.build(taskFile, title)
      const { job, error } = await dispatch({
        kind: 'agent',
        id,
        dir,
        command,
        cwd: args.cwd,
        label: title,
        runtimeMaxSec: runtimeMax(args.runtime_max_sec),
      })
      if (error) return textResult(`ERROR: 投递失败（${error}）\n目录：${dir}`)
      const sessionId = sessionKey(exec?.agent) ?? null
      if (sessionId) {
        agents.set(sessionId, exec.agent)
        patchJob(job.id, { sessionId, engine })
      }
      return textResult([
        `已交给 ${resolved.engine.label}（${engine}${resolved.engine.version ? ' · ' + resolved.engine.version : ''}）：${job.id}`,
        `任务文件：${taskFile}`,
        `日志：${job.logPath}`,
        '它在本机独立 cgroup 里跑，不受 dsh 重启影响；跑完会把结果送回这个会话。',
      ].join('\n'))
    },
  })

  register({
    name: 'outlive_engines',
    description:
      '看本机现在有哪些编码 agent 可以被 outlive_agent 派活：探测 opencode / codex / claude 装在哪、什么版本，'
      + '以及 engine 留空时会选哪个。装完新 agent 之后调一次（探测有 30 秒缓存，这里会强制刷新）。',
    parameters: {},
    output,
    async execute() {
      const available = detectedEngines(config, { refresh: true })
      if (available.length === 0) {
        return textResult(`没检测到可用的编码 agent。找过 ${PREFERRED_ENGINES.join(' / ')}，命令行都不在 PATH 里。`)
      }
      const fallback = resolvedDefault(config)
      const custom = Object.keys(config?.engines || {})
      return textResult([
        `engine 留空时用：${fallback ? `${fallback.label}（${fallback.name}）` : config?.defaultEngine || '（无）'}`,
        '',
        ...available.map((engine) => `- ${engine.name.padEnd(9)}${engine.label.padEnd(12)}${engine.bin}${engine.version ? `  ${engine.version}` : ''}`),
        ...(custom.length ? ['', `自定义执行器（config.engines）：${custom.join(', ')}`] : []),
      ].join('\n'))
    },
  })

  register({
    name: 'outlive_status',
    description:
      '看某个 outlive 任务的现状：状态、退出码、日志尾部。任务目录在磁盘上，所以 harness 重启、会话重开之后照样能查。',
    parameters: {
      id: { type: 'string', required: true, description: '任务 id（outlive_run / outlive_agent / outlive_list 给的那个）。' },
      tail_lines: { type: 'integer', description: `返回最后多少行日志，默认 60，上限 ${MAX_TAIL_LINES}。` },
    },
    output,
    async execute(args) {
      const job = readJob(args.id)
      if (!job) return textResult(`ERROR: 没有任务 ${args.id}（在 ${STATE_DIR} 里找不到）`)
      const settled = settle(job)
      const lines = Math.min(MAX_TAIL_LINES, Math.max(1, Math.trunc(Number(args.tail_lines) || 60)))
      const head = [
        `id=${settled.id} status=${settled.status} exit=${settled.exitCode ?? '-'}`,
        `label=${settled.label}`,
        `started=${settled.startedAt} finished=${settled.finishedAt ?? '-'}`,
        `cwd=${settled.cwd}`,
        `log=${settled.logPath}`,
      ]
      if (settled.error) head.push(`error=${settled.error}`)
      return textResult(`${head.join('\n')}\n\n${tail(settled.logPath, lines) || '（暂无输出）'}`)
    },
  })

  register({
    name: 'outlive_list',
    description: '列出最近的 outlive 任务（含跨重启的历史），最新的在前。用来回答“我之前交出去的那些活怎么样了”。',
    parameters: {
      limit: { type: 'integer', description: '最多几条，默认 15。' },
    },
    output,
    async execute(args) {
      const limit = Math.min(100, Math.max(1, Math.trunc(Number(args.limit) || 15)))
      const jobs = listJobs(limit)
      if (jobs.length === 0) return textResult('还没有任何 outlive 任务。')
      const running = jobs.filter((job) => job.status === 'running').length
      return textResult([
        `${jobs.length} 条（运行中 ${running}）· 目录 ${STATE_DIR}`,
        '',
        ...jobs.map((job) => `- ${describe(job)}`),
      ].join('\n'))
    },
  })

  register({
    name: 'outlive_cancel',
    description: '中止一个还在运行的 outlive 任务（给 unit 发 TERM）。已完成的任务不受影响。',
    parameters: {
      id: { type: 'string', required: true, description: '任务 id。' },
    },
    output,
    async execute(args) {
      const job = readJob(args.id)
      if (!job) return textResult(`ERROR: 没有任务 ${args.id}`)
      if (job.status !== 'running') return textResult(`任务 ${job.id} 已经是 ${job.status}，无需中止。`)
      const result = await killUnit(job)
      return textResult(result.ok
        ? `已发送 TERM 给 ${job.unit}；用 outlive_status("${job.id}") 确认收尾。`
        : `ERROR: ${result.detail}`)
    },
  })

  // A finished job is owed to the session that started it, even if that session
  // was closed while it ran. A newly created agent flushes whatever it is owed.
  ctx.on('agent/created', ({ agent }) => {
    adopt(agent)
  })

  // The polling loop is the only thing here that does not survive a restart; the
  // jobs do. Losing it costs one interval, nothing else.
  ctx.effect(() => {
    const timer = setInterval(() => {
      // Read raw records here: listJobs() would settle them already, and the
      // only reason this loop exists is to notice the transition to settled.
      for (const job of listJobs(undefined, false)) {
        if (job.status !== 'running') continue
        const settled = settle(job)
        if (settled.status !== 'running') deliver(settled)
      }
    }, Number.isFinite(config?.pollMs) ? Math.max(500, config.pollMs) : 3000)
    timer.unref?.()
    return () => clearInterval(timer)
  })

  return () => {
    agents.clear()
  }
}

/** The on-disk root this instance reads. Exposed for the README and for tests. */
export const stateDir = STATE_DIR

/** Exposed for a smoke test: does this plugin see the given job id on disk? */
export function jobDirForTests(id) {
  return existsSync(jobDir(id)) ? jobDir(id) : undefined
}
