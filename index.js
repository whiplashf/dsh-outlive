/**
 * Outlive — run long jobs outside the agent session.
 *
 * The host side owns the ledger, the HTTP panel API, and the model tools. All
 * execution happens in user-scoped systemd units, so a job survives a closed
 * browser tab and a restarted DSH.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStore, resolveStateDir, BUILTIN_TASKS, RETENTION, TASK_ID, JOB_ID } from './lib/store.js'
import {
  createAgents,
  buildAgentCommand,
  validateCustomAgent,
  probeVersion,
} from './lib/agents.js'
import {
  startUnit,
  probeUnit,
  stopUnit,
  writeCommandScript,
  writeRunScript,
  unitFor,
} from './lib/dispatch.js'
import { planRestart, restartPlanText, writeRestartScript, writeEnvironmentFile } from './lib/restart.js'
import { browse } from './lib/fsbrowse.js'
import { noticeText, userMessage, pickLang, readTail } from './lib/notify.js'

export const name = 'outlive'
export const inject = ['tools', 'agents']

const MAX_BODY = 64 * 1024
const MAX_RESULT = 16 * 1024
const MAX_TAIL = 400
const DEFAULT_RUNTIME = 7200
const MIN_RUNTIME = 60
const MAX_RUNTIME = 604800
const DEFAULT_POLL = 3000

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

function text(value) {
  return { text: String(value ?? '').slice(0, MAX_RESULT) }
}

const textOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function sessionKey(agent) {
  const id = agent?.session?.id ?? agent?.sessionId
  return typeof id === 'string' && id ? id : null
}

function jobLine(job) {
  const status = job.status
  const agent = job.agent ? ` · agent ${job.agent}` : ''
  const exit = Number.isFinite(job.exitCode) ? ` · exit ${job.exitCode}` : ''
  return `${job.id}  ${status}${exit}  ${job.kind}${agent}  ${job.label || ''}`.trim()
}

export function apply(ctx, config = {}) {
  const pollMs = clampInt(config.pollMs, 500, 60000, DEFAULT_POLL)
  const stateDir = resolveStateDir({ configured: config.stateDir })
  const store = createStore({ stateDir })
  store.ensureBuiltins()

  const catalog = createAgents({
    pathEnv: process.env.PATH || '',
    readCustom: () => store.readAgents(),
  })
  const sessions = new Map()
  const defaultCwd = process.cwd()
  let lastPrune = 0

  const defaultAgent = () => {
    const preferred = config.defaultAgent || config.defaultEngine
    const result = catalog.resolve(preferred || 'auto')
    return result.agent?.name ?? null
  }

  function panelJob(job) {
    return {
      id: job.id,
      kind: job.kind,
      label: job.label || null,
      status: job.status,
      agent: job.agent || null,
      cwd: job.cwd || null,
      mode: job.mode || null,
      restartUnit: job.restartUnit || null,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt || null,
      exitCode: Number.isFinite(job.exitCode) ? job.exitCode : null,
      error: job.error || null,
      builtin: job.builtin || null,
      logPath: job.logPath,
    }
  }

  function agentsView({ refresh = false } = {}) {
    const list = catalog.list({ refresh }).map((agent) => ({
      name: agent.name,
      label: agent.label,
      bin: agent.bin || null,
      version: agent.version || null,
      installed: Boolean(agent.installed),
      verified: Boolean(agent.verified),
      source: agent.source,
      args: agent.args || '',
      ready: catalog.usable(agent),
    }))
    return { list, default: defaultAgent() }
  }

  function deliver(job) {
    const notify = job.notify || { state: 'none', attempts: 0 }
    if (notify.state !== 'pending') return
    const agent = sessions.get(job.sessionId)
    const attempts = (notify.attempts || 0) + 1
    if (!agent) {
      store.patchJob(job.id, {
        notify: { ...notify, attempts, state: attempts >= 5 ? 'skipped' : 'pending' },
      })
      return
    }
    try {
      const message = noticeText(job, { lang: pickLang(job.lang) })
      const result = agent.followup?.(userMessage(message, job.id))
      if (result && typeof result.catch === 'function') result.catch(() => {})
      store.patchJob(job.id, {
        notify: { ...notify, attempts, state: 'delivered', at: new Date().toISOString() },
      })
    } catch (error) {
      store.patchJob(job.id, {
        notify: {
          ...notify,
          attempts,
          state: attempts >= 5 ? 'failed' : 'pending',
          error: String(error?.message || error).slice(0, 500),
        },
      })
    }
  }

  function adopt(agent) {
    const key = sessionKey(agent)
    if (!key) return
    sessions.set(key, agent)
    for (const job of store.listJobs()) {
      if (job.sessionId === key && job.status !== 'running' && job.notify?.state === 'pending') deliver(job)
    }
  }

  function settleJob(job, { probe = true } = {}) {
    if (job.status !== 'running') return job
    const age = Date.now() - Date.parse(job.startedAt || 0)
    let unit = null
    if (probe && age > 2500) unit = probeUnit(job.unit)
    const next = store.settle(job, { unit })
    if (next.status !== 'running' && next.notify?.state === 'pending') deliver(next)
    return next
  }

  function tick() {
    for (const job of store.listJobs()) settleJob(job, { probe: true })
    const now = Date.now()
    if (now - lastPrune > 60000) {
      lastPrune = now
      store.prune({ keep: RETENTION })
    }
  }

  function startScriptJob({ kind, job, scriptPath, env = {}, runtimeMaxSec, description }) {
    const started = startUnit({
      unit: unitFor(job.id),
      description: description || `outlive: ${job.label || job.kind}`,
      cwd: job.cwd,
      runtimeMaxSec,
      scriptPath,
      env,
    })
    if (!started.ok) {
      const reason =
        started.error === 'systemdMissing'
          ? 'systemd-run is not available on this host'
          : started.detail || started.error
      return store.patchJob(job.id, {
        status: 'failed',
        error: reason,
        finishedAt: new Date().toISOString(),
      })
    }
    return job
  }

  function startCommandJob({ command, label, cwd, runtimeMaxSec, env, sessionId = null, lang = 'en' }) {
    const job = store.createJob({
      kind: 'command',
      label: label || String(command).split('\n')[0].slice(0, 60),
      command,
      cwd,
      agent: null,
      runtimeMaxSec,
      sessionId,
      lang: pickLang(lang),
    })
    try {
      if (cwd && !isDirectory(cwd)) throw new Error(`working directory does not exist: ${cwd}`)
      writeCommandScript(job.dir, command)
      writeRunScript({
        dir: job.dir,
        commandPath: join(job.dir, 'command.sh'),
        cwd,
        logPath: job.logPath,
        exitPath: join(job.dir, 'exit'),
      })
      const current = startScriptJob({
        kind: 'command',
        job,
        scriptPath: join(job.dir, 'run.sh'),
        env,
        runtimeMaxSec,
        description: `outlive: ${job.label}`,
      })
      return current.status === 'running'
        ? { job: store.readJob(job.id) }
        : { job: current, error: current.error || 'dispatchFailed' }
    } catch (error) {
      const reason = String(error?.message || error).slice(0, 1000)
      return { job: store.patchJob(job.id, { status: 'failed', error: reason, finishedAt: new Date().toISOString() }), error: reason }
    }
  }

  function startAgentJob({ task, requestedAgent, label, cwd, runtimeMaxSec, env, sessionId = null, lang = 'en' }) {
    const resolved = catalog.resolve(requestedAgent)
    if (!resolved.agent) return { error: resolved.error, detail: resolved }
    const agent = resolved.agent
    const job = store.createJob({
      kind: 'agent',
      label: label || String(task).split('\n')[0].slice(0, 60),
      command: null,
      cwd,
      agent: agent.name,
      runtimeMaxSec,
      sessionId,
      lang: pickLang(lang),
    })
    try {
      if (cwd && !isDirectory(cwd)) throw new Error(`working directory does not exist: ${cwd}`)
      if (!task.trim()) throw new Error('task is empty')
      const taskFile = join(job.dir, 'task.txt')
      writeFileSync(taskFile, `${String(task).replace(/\n*$/, '')}\n`, { mode: 0o600 })
      const command = buildAgentCommand({ bin: agent.bin, args: agent.args, taskFile, title: job.label })
      store.patchJob(job.id, { command, taskFile })
      writeCommandScript(job.dir, command)
      writeRunScript({
        dir: job.dir,
        commandPath: join(job.dir, 'command.sh'),
        cwd,
        logPath: job.logPath,
        exitPath: join(job.dir, 'exit'),
      })
      const current = startScriptJob({
        kind: 'agent',
        job,
        scriptPath: join(job.dir, 'run.sh'),
        env,
        runtimeMaxSec,
        description: `outlive: ${agent.name} · ${job.label}`,
      })
      return current.status === 'running'
        ? { job: store.readJob(job.id), agent: agent.name }
        : { job: current, agent: agent.name, error: current.error || 'dispatchFailed' }
    } catch (error) {
      const reason = String(error?.message || error).slice(0, 1000)
      return { job: store.patchJob(job.id, { status: 'failed', error: reason, finishedAt: new Date().toISOString() }), error: reason }
    }
  }

  function startRestartJob({ lang = 'en', sessionId = null } = {}) {
    let plan
    try {
      plan = planRestart({ pid: process.pid })
    } catch (error) {
      return { error: 'planFailed', detail: String(error?.message || error) }
    }
    const job = store.createJob({
      kind: 'restart',
      label: null,
      builtin: 'restart-dsh',
      command: restartPlanText(plan),
      cwd: plan.cwd,
      agent: null,
      runtimeMaxSec: 300,
      sessionId,
      lang: pickLang(lang),
      mode: plan.mode,
      restartUnit: plan.mode === 'unit' ? plan.unit : null,
      plan: {
        mode: plan.mode,
        unit: plan.unit,
        pid: plan.pid,
        ports: plan.ports,
        host: plan.host,
        argv: plan.argv,
      },
    })
    const relaunchUnit = plan.mode === 'unit' ? plan.unit : `outlive-dsh-${job.id}`
    const envPath = join(job.dir, 'restart.env')
    try {
      if (plan.mode === 'process') writeEnvironmentFile(envPath, plan.env)
      const script = writeRestartScript({
        dir: job.dir,
        plan,
        unit: relaunchUnit,
        logPath: job.logPath,
        exitPath: join(job.dir, 'exit'),
        envPath,
      })
      const started = startUnit({
        unit: unitFor(job.id),
        description: 'outlive: restart dsh',
        cwd: plan.cwd,
        runtimeMaxSec: 300,
        scriptPath: script,
        env: {},
      })
      if (!started.ok) {
        const reason = started.error === 'systemdMissing' ? 'systemd-run is not available' : started.detail || started.error
        return { job: store.patchJob(job.id, { status: 'failed', error: reason, finishedAt: new Date().toISOString() }), error: 'dispatchFailed', detail: reason }
      }
      return { job: store.readJob(job.id), plan: { mode: plan.mode, unit: plan.unit, restartUnit: relaunchUnit, pid: plan.pid, ports: plan.ports, host: plan.host } }
    } catch (error) {
      const reason = String(error?.message || error).slice(0, 1000)
      return { job: store.patchJob(job.id, { status: 'failed', error: reason, finishedAt: new Date().toISOString() }), error: 'restartFailed', detail: reason }
    }
  }

  function agentErrorText(error, detail) {
    if (error === 'noneReady') {
      const detected = detail?.detail?.length ? detail.detail.join(', ') : 'none'
      return `No agent is ready. Detected but not usable: ${detected}. Install OpenCode, Codex, or Claude Code, or add a custom agent in the Outlive panel.`
    }
    if (error === 'unknown') return `Unknown agent. Choose one of the detected agents, or run outlive_agents to list them.`
    if (error === 'notInstalled') return `Agent "${detail?.agent?.name}" is not installed on this host.`
    if (error === 'needsArguments') return `Agent "${detail?.agent?.name}" needs an argument template with {file} before it can run. Add it in the Outlive panel.`
    return `Cannot start the job: ${error || 'unknown error'}`
  }

  const tools = [
    {
      name: 'outlive_agent',
      description:
        'Hand a self-contained task to a coding agent (OpenCode, Codex, Claude Code, or a custom CLI) that runs outside this session in a detached systemd unit. Returns immediately with a job id; the result is delivered back to this session when the job finishes. Use it for long, independent work that can be verified on its own.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: { type: 'string', description: 'Complete task description. The agent cannot see this conversation, so include paths, context, and acceptance criteria.' },
          agent: { type: 'string', description: 'Agent name. Omit to use the preferred installed agent.' },
          engine: { type: 'string', description: 'Deprecated alias for agent.' },
          label: { type: 'string', description: 'Short label for the job list.' },
          cwd: { type: 'string', description: 'Absolute working directory. Defaults to the DSH working directory.' },
          runtime_max_sec: { type: 'integer', minimum: MIN_RUNTIME, maximum: MAX_RUNTIME, description: `Wall-clock limit in seconds (default ${DEFAULT_RUNTIME}).` },
        },
        required: ['task'],
      },
      output: textOutput,
      async execute(args, exec) {
        const runtimeMaxSec = clampInt(args.runtime_max_sec, MIN_RUNTIME, MAX_RUNTIME, DEFAULT_RUNTIME)
        const cwd = String(args.cwd || defaultCwd).trim() || defaultCwd
        const result = startAgentJob({
          task: String(args.task || ''),
          requestedAgent: args.agent || args.engine || 'auto',
          label: args.label,
          cwd,
          runtimeMaxSec,
          sessionId: sessionKey(exec?.agent),
          lang: 'en',
        })
        if (result.error) return text(agentErrorText(result.error, result.detail))
        const job = result.job
        return text(
          `Started job ${job.id} (agent ${result.agent}). It runs outside this session; you will receive a message when it finishes.\nLog: ${job.logPath}\nUse outlive_status with this id to read progress.`,
        )
      },
    },
    {
      name: 'outlive_run',
      description:
        'Run a shell command outside this session in a detached systemd unit. Use it for builds, migrations, long downloads, or a service restart that must survive this session. Returns immediately with a job id.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string', description: 'Shell command to run with bash.' },
          label: { type: 'string', description: 'Short label for the job list.' },
          cwd: { type: 'string', description: 'Absolute working directory. Defaults to the DSH working directory.' },
          runtime_max_sec: { type: 'integer', minimum: MIN_RUNTIME, maximum: MAX_RUNTIME, description: `Wall-clock limit in seconds (default ${DEFAULT_RUNTIME}).` },
          env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra environment variables. Keep secrets out of the command line.' },
        },
        required: ['command'],
      },
      output: textOutput,
      async execute(args, exec) {
        const runtimeMaxSec = clampInt(args.runtime_max_sec, MIN_RUNTIME, MAX_RUNTIME, DEFAULT_RUNTIME)
        const cwd = String(args.cwd || defaultCwd).trim() || defaultCwd
        const env = args.env && typeof args.env === 'object' ? args.env : {}
        const result = startCommandJob({
          command: String(args.command || ''),
          label: args.label,
          cwd,
          runtimeMaxSec,
          env,
          sessionId: sessionKey(exec?.agent),
          lang: 'en',
        })
        if (result.error) return text(`Cannot start the job: ${result.error}`)
        const job = result.job
        return text(
          `Started job ${job.id}. It runs outside this session; you will receive a message when it finishes.\nLog: ${job.logPath}\nUse outlive_status with this id to read progress.`,
        )
      },
    },
    {
      name: 'outlive_agents',
      description: 'List coding agents detected on this host, their versions, and whether their argument template is ready to use.',
      parameters: { type: 'object', additionalProperties: false, properties: { refresh: { type: 'boolean', description: 'Re-probe instead of using the 30-second cache.' } } },
      output: textOutput,
      async execute(args) {
        const view = agentsView({ refresh: args.refresh === true })
        const lines = view.list.map((agent) => {
          const state = agent.ready ? 'ready' : agent.installed ? (agent.args ? 'not ready' : 'needs arguments') : 'not installed'
          return `${agent.name}  ${state}${agent.version ? `  ${agent.version}` : ''}${agent.bin ? `  ${agent.bin}` : ''}`
        })
        return text([`Default agent: ${view.default || 'none'}`, ...lines].join('\n'))
      },
    },
    {
      name: 'outlive_engines',
      description: 'Deprecated alias for outlive_agents.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: textOutput,
      async execute() {
        const view = agentsView({ refresh: false })
        return text([`Default agent: ${view.default || 'none'}`, ...view.list.map((agent) => `${agent.name}  ${agent.ready ? 'ready' : agent.installed ? 'not ready' : 'not installed'}`)].join('\n'))
      },
    },
    {
      name: 'outlive_status',
      description: 'Read one job: status, exit code, duration, and the last lines of its log.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Job id returned by outlive_agent or outlive_run.' },
          tail_lines: { type: 'integer', minimum: 1, maximum: MAX_TAIL, description: 'How many trailing log lines to include.' },
        },
        required: ['id'],
      },
      output: textOutput,
      async execute(args) {
        const id = String(args.id || '').trim()
        if (!JOB_ID.test(id)) return text('Invalid job id.')
        const job = store.readJob(id)
        if (!job) return text(`No job with id ${id}.`)
        const current = settleJob(job, { probe: true })
        const lines = Math.min(MAX_TAIL, Math.max(1, Number(args.tail_lines) || 60))
        const tail = readLogTail(current.logPath, lines)
        const header = [
          `Job ${current.id}  ${current.status}${Number.isFinite(current.exitCode) ? `  exit ${current.exitCode}` : ''}`,
          `Kind: ${current.kind}${current.agent ? `  Agent: ${current.agent}` : ''}  Started: ${current.startedAt}${current.finishedAt ? `  Finished: ${current.finishedAt}` : ''}`,
          current.error ? `Error: ${current.error}` : '',
          `Log: ${current.logPath}`,
        ]
          .filter(Boolean)
          .join('\n')
        return text(tail ? `${header}\n\n${tail}` : header)
      },
    },
    {
      name: 'outlive_list',
      description: 'List recent Outlive jobs, newest first.',
      parameters: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      output: textOutput,
      async execute(args) {
        const limit = Math.min(100, Math.max(1, Number(args.limit) || 20))
        const jobs = store.listJobs({ limit })
        if (!jobs.length) return text('No jobs yet.')
        return text(jobs.map(jobLine).join('\n'))
      },
    },
    {
      name: 'outlive_cancel',
      description: 'Stop a running job. The job is recorded as cancelled; its log stays readable.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', description: 'Job id.' } },
        required: ['id'],
      },
      output: textOutput,
      async execute(args) {
        const id = String(args.id || '').trim()
        if (!JOB_ID.test(id)) return text('Invalid job id.')
        const job = store.readJob(id)
        if (!job) return text(`No job with id ${id}.`)
        if (job.status !== 'running') return text(`Job ${id} is already ${job.status}.`)
        stopUnit(job.unit)
        const next = store.patchJob(id, {
          status: 'cancelled',
          killed: true,
          exitCode: 143,
          finishedAt: new Date().toISOString(),
          notify: { ...(job.notify || {}), state: job.sessionId ? 'pending' : 'none' },
        })
        if (next.notify?.state === 'pending') deliver(next)
        return text(`Cancelled job ${id}.`)
      },
    },
  ]

  for (const tool of tools) ctx.tools.register(tool)

  // ---- HTTP panel API -----------------------------------------------------

  function jsonResponse(status, body) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(payload, {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  function failure(error) {
    const status = error?.status || 500
    return jsonResponse(status, {
      error: error?.code || (status === 500 ? 'internal' : 'badRequest'),
      detail: String(error?.message || error).slice(0, 1000),
    })
  }

  function get(handler) {
    return { method: 'GET', handler }
  }

  function post(handler) {
    return { method: 'POST', handler }
  }

  /** Answer one panel request; the transport has already applied its trust and authentication policy. */
  async function dispatch(route, request) {
    try {
      const url = new URL(request.url)
      if (route.method === 'GET') return jsonResponse(200, (await route.handler(url)) ?? { ok: true })
      if (request.headers.get('x-outlive') !== '1') return jsonResponse(403, { error: 'forbidden', detail: 'missing x-outlive header' })
      const type = String(request.headers.get('content-type') || '')
      if (!type.includes('application/json')) {
        return jsonResponse(415, { error: 'unsupportedMediaType', detail: 'content-type must be application/json' })
      }
      const raw = await request.text()
      if (raw.length > MAX_BODY) return jsonResponse(413, { error: 'bodyTooLarge', detail: `body exceeds ${MAX_BODY} bytes` })
      let body
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        return jsonResponse(400, { error: 'badRequest', detail: 'invalid JSON' })
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return jsonResponse(400, { error: 'badRequest', detail: 'body must be an object' })
      }
      return jsonResponse(200, (await route.handler(body)) ?? { ok: true })
    } catch (error) {
      return failure(error)
    }
  }

  function statePayload(flags = {}) {
    const view = agentsView({ refresh: Boolean(flags.refresh) })
    const taskState = store.readTaskState()
    return {
      version: pkg.version,
      stateDir,
      pollMs,
      defaultCwd,
      retention: RETENTION,
      agents: view,
      jobs: store.listJobs({ limit: 100 }).map(panelJob),
      tasks: taskState.tasks,
      builtins: {
        available: BUILTIN_TASKS.map((entry) => ({ key: entry.key, id: entry.id })),
        removed: taskState.removedBuiltins,
      },
    }
  }

  const routes = [
    [
      '/api/outlive/state',
      get((url) => {
        if (url.searchParams.get('refresh') === '1') catalog.list({ refresh: true })
        return statePayload()
      }),
    ],
    [
      '/api/outlive/log',
      get((url) => {
        const id = String(url.searchParams.get('id') || '')
        if (!JOB_ID.test(id)) throw Object.assign(new Error('invalid job id'), { status: 400 })
        const job = store.readJob(id)
        if (!job) throw Object.assign(new Error('job not found'), { status: 404 })
        const tail = clampInt(url.searchParams.get('tail'), 1, MAX_TAIL, 300)
        return { id, log: readLogTail(job.logPath, tail) }
      }),
    ],
    [
      '/api/outlive/fs',
      get((url) => {
        const result = browse({
          path: url.searchParams.get('path') || '',
          showHidden: url.searchParams.get('showHidden') === '1',
          executablesOnly: url.searchParams.get('executablesOnly') === '1',
        })
        if (result.error) throw Object.assign(new Error(result.error), { status: result.error === 'denied' ? 403 : 404, code: result.error })
        return result
      }),
    ],
    [
      '/api/outlive/run',
      post((body) => {
        const kind = body.kind === 'command' ? 'command' : body.kind === 'restart' ? 'restart' : 'agent'
        const lang = pickLang(body.lang)
        const cwd = String(body.cwd || defaultCwd).trim() || defaultCwd
        const runtimeMaxSec = clampInt(body.runtime_max_sec, MIN_RUNTIME, MAX_RUNTIME, DEFAULT_RUNTIME)
        let result
        if (kind === 'restart') {
          result = startRestartJob({ lang, sessionId: null })
        } else if (kind === 'command') {
          result = startCommandJob({
            command: String(body.command || ''),
            label: body.label,
            cwd,
            runtimeMaxSec,
            env: body.env && typeof body.env === 'object' ? body.env : {},
            lang,
          })
        } else {
          result = startAgentJob({
            task: String(body.task || ''),
            requestedAgent: body.agent || body.engine || 'auto',
            label: body.label,
            cwd,
            runtimeMaxSec,
            env: {},
            lang,
          })
        }
        if (result.error) return { error: result.error, detail: result.detail || null, job: result.job ? panelJob(result.job) : null }
        if (body.taskId && TASK_ID.test(String(body.taskId))) store.bumpTask(String(body.taskId))
        return { job: panelJob(result.job), plan: result.plan || null }
      }),
    ],
    [
      '/api/outlive/cancel',
      post((body) => {
        const id = String(body.id || '')
        if (!JOB_ID.test(id)) throw Object.assign(new Error('invalid job id'), { status: 400 })
        const job = store.readJob(id)
        if (!job) throw Object.assign(new Error('job not found'), { status: 404 })
        if (job.status !== 'running') return { ok: false, detail: 'already settled' }
        stopUnit(job.unit)
        const next = store.patchJob(id, {
          status: 'cancelled',
          killed: true,
          exitCode: 143,
          finishedAt: new Date().toISOString(),
          notify: { state: 'pending', attempts: 0 },
        })
        deliver(next)
        return { job: panelJob(store.readJob(id) || next) }
      }),
    ],
    [
      '/api/outlive/delete',
      post((body) => {
        const id = String(body.id || '')
        if (!JOB_ID.test(id)) throw Object.assign(new Error('invalid job id'), { status: 400 })
        const result = store.removeJob(id)
        if (result.error === 'running') throw Object.assign(new Error('running jobs cannot be deleted'), { status: 409 })
        if (result.error) throw Object.assign(new Error(result.error), { status: 404 })
        return { ok: true }
      }),
    ],
    [
      '/api/outlive/jobs/clear',
      post(() => store.clearSettled()),
    ],
    [
      '/api/outlive/agents',
      post((body) => {
        const checked = validateCustomAgent(body)
        if (checked.error) throw Object.assign(new Error(checked.error), { status: 400 })
        const existing = store.readAgents().find((agent) => agent.name === checked.name)
        store.upsertAgent({
          name: checked.name,
          label: String(body.label || existing?.label || checked.name).slice(0, 60),
          bin: checked.bin,
          args: checked.args,
          createdAt: existing?.createdAt || new Date().toISOString(),
        })
        return { agents: agentsView({ refresh: true }), version: probeVersion(checked.bin) }
      }),
    ],
    [
      '/api/outlive/agents/delete',
      post((body) => {
        const name = String(body.name || '').trim()
        if (!name) throw Object.assign(new Error('name is required'), { status: 400 })
        const result = store.removeAgent(name)
        if (result.error) throw Object.assign(new Error(result.error), { status: 404 })
        return { agents: agentsView({ refresh: true }) }
      }),
    ],
    [
      '/api/outlive/tasks',
      post((body) => {
        const kind = body.kind === 'command' ? 'command' : 'agent'
        const result = store.saveTask({
          kind,
          task: body.task,
          command: body.command,
          agent: body.agent || body.engine,
          cwd: body.cwd,
          label: body.label,
        })
        if (result.error) throw Object.assign(new Error(result.error), { status: 400 })
        return { tasks: store.readTasks(), task: result.task }
      }),
    ],
    [
      '/api/outlive/tasks/delete',
      post((body) => {
        const id = String(body.id || '')
        if (!TASK_ID.test(id)) throw Object.assign(new Error('invalid task id'), { status: 400 })
        const result = store.deleteTask(id)
        if (result.error) throw Object.assign(new Error(result.error), { status: 404 })
        return { tasks: store.readTasks(), builtin: result.builtin || null }
      }),
    ],
    [
      '/api/outlive/tasks/restore',
      post((body) => {
        const key = String(body.key || '')
        const result = store.restoreBuiltin(key)
        if (result.error) throw Object.assign(new Error(result.error), { status: 404 })
        return { tasks: store.readTasks() }
      }),
    ],
    [
      '/api/outlive/preview',
      post((body) => {
        const kind = body.kind === 'command' ? 'command' : body.kind === 'restart' ? 'restart' : 'agent'
        if (kind === 'restart') {
          try {
            const plan = planRestart({ pid: process.pid })
            return { command: restartPlanText(plan), mode: plan.mode, unit: plan.unit, ports: plan.ports, host: plan.host }
          } catch (error) {
            throw Object.assign(new Error(String(error?.message || error)), { status: 500 })
          }
        }
        if (kind === 'command') return { command: String(body.command || '') }
        const resolved = catalog.resolve(body.agent || body.engine || 'auto')
        if (!resolved.agent) throw Object.assign(new Error(agentErrorText(resolved.error, resolved)), { status: 400 })
        const command = buildAgentCommand({
          bin: resolved.agent.bin,
          args: resolved.agent.args,
          taskFile: '<task file>',
          title: String(body.label || '').slice(0, 200) || 'outlive job',
        })
        return { command, agent: resolved.agent.name }
      }),
    ],
  ]

  ctx.inject(['connection'], (conn) => {
    for (const [path, route] of routes) {
      conn.effect(
        () =>
          conn.connection.fetch.register({
            path,
            methods: [route.method],
            // The carrier only turns a body-less request into a body-less `Request`
            // for `buffered`; `none` would stream an empty GET body and throw.
            requestBody: 'buffered',
            fetch: (request) => dispatch(route, request),
          }),
        `outlive: ${path}`,
      )
    }
  })

  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
        tick()
      } catch {
        // a ledger read failure must not take the host down
      }
    }, pollMs)
    timer.unref?.()
    const warm = setTimeout(() => {
      try {
        tick()
      } catch {
        // ignore
      }
    }, 1000)
    warm.unref?.()
    return () => {
      clearInterval(timer)
      clearTimeout(warm)
    }
  })

  const onAgent = (payload) => {
    const agent = payload?.agent ?? payload
    if (agent) adopt(agent)
  }
  ctx.on('agent/created', onAgent)

  return () => {
    sessions.clear()
    try {
      ctx.off?.('agent/created', onAgent)
    } catch {
      // the host owns disposal of listeners
    }
  }
}

function readLogTail(path, lines) {
  return readTail(path, lines)
}

export { RETENTION }
