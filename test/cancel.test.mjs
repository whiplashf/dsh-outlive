import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../index.js'

const JOB = 'a1b2c3d4e5f6'

function makeCtx() {
  const tools = new Map()
  const routes = new Map()
  const disposers = []
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool) } },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on() {},
    off() {},
    inject(deps, callback) {
      if (!deps.includes('connection')) return
      callback({
        effect(fn) {
          const dispose = fn()
          if (typeof dispose === 'function') disposers.push(dispose)
          return dispose
        },
        connection: {
          fetch: {
            register(route) {
              routes.set(route.path, route)
              return Promise.resolve(async () => {
                routes.delete(route.path)
              })
            },
          },
        },
      })
    },
  }
  return { ctx, tools, routes, dispose: () => { for (const fn of disposers) fn() } }
}

async function invoke(routes, path, { method = 'GET', headers = {}, body } = {}) {
  const route = routes.get(path)
  assert.ok(route, `route ${path} is registered`)
  const request = new Request(`http://harness.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const response = await route.fetch(request)
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

/** Write a running job record the way the plugin would have left it. */
function seedJob(stateDir, { unit, ageMs = 10_000 } = {}) {
  const dir = join(stateDir, 'jobs', JOB)
  mkdirSync(dir, { recursive: true })
  const job = {
    version: 1,
    id: JOB,
    kind: 'command',
    label: 'seeded',
    command: 'sleep 300',
    cwd: '/tmp',
    status: 'running',
    exitCode: null,
    finishedAt: null,
    killed: false,
    error: null,
    sessionId: null,
    lang: 'en',
    notify: { state: 'none', attempts: 0 },
    runtimeMaxSec: 600,
    startedAt: new Date(Date.now() - ageMs).toISOString(),
    dir,
    logPath: join(dir, 'out.log'),
  }
  if (unit) job.unit = unit
  writeFileSync(join(dir, 'job.json'), JSON.stringify(job, null, 2))
  return job
}

function readJob(stateDir) {
  return JSON.parse(readFileSync(join(stateDir, 'jobs', JOB, 'job.json'), 'utf8'))
}

/** Put a scripted `systemctl` first on PATH and record the calls it receives. */
function stubSystemctl({ exit = 0, stdout = '', stderr = '' }) {
  const dir = mkdtempSync(join(tmpdir(), 'outlive-stub-'))
  const calls = join(dir, 'calls')
  const stdoutFile = join(dir, 'stdout')
  writeFileSync(stdoutFile, stdout)
  writeFileSync(
    join(dir, 'systemctl'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\ncat ${JSON.stringify(stdoutFile)}\nprintf '%s' ${JSON.stringify(stderr)} >&2\nexit ${exit}\n`,
  )
  chmodSync(join(dir, 'systemctl'), 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${dir}:${previous ?? ''}`
  return {
    calls: () => (readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean)),
    restore() {
      if (previous === undefined) delete process.env.PATH
      else process.env.PATH = previous
    },
  }
}

function fixture() {
  const stateDir = mkdtempSync(join(tmpdir(), 'outlive-cancel-'))
  const { ctx, tools, routes, dispose } = makeCtx()
  const cleanup = plugin.apply(ctx, { stateDir, pollMs: 60000 })
  return { stateDir, tools, routes, stop: () => { cleanup?.(); dispose() } }
}

const post = { 'x-outlive': '1', 'content-type': 'application/json' }

test('cancel stops the job unit and settles the ledger as cancelled', async () => {
  const api = fixture()
  // Seeded jobs predate the unit field; cancellation must still address the unit.
  seedJob(api.stateDir)
  const systemctl = stubSystemctl({ exit: 0 })
  try {
    const response = await invoke(api.routes, '/api/outlive/cancel', { method: 'POST', headers: post, body: { id: JOB } })
    assert.equal(response.status, 200)
    assert.equal(response.body.job.status, 'cancelled')
    assert.deepEqual(systemctl.calls(), [`--user stop outlive-${JOB}`])
    assert.equal(readJob(api.stateDir).status, 'cancelled')
    assert.equal(readJob(api.stateDir).killed, true)
  } finally {
    systemctl.restore()
    api.stop()
  }
})

test('cancel reports a failed stop instead of pretending the job was cancelled', async () => {
  const api = fixture()
  seedJob(api.stateDir)
  const systemctl = stubSystemctl({
    exit: 5,
    stderr: `Failed to stop outlive-${JOB}.service: Unit outlive-${JOB}.service not loaded.`,
  })
  try {
    const response = await invoke(api.routes, '/api/outlive/cancel', { method: 'POST', headers: post, body: { id: JOB } })
    assert.equal(response.status, 409)
    assert.match(JSON.stringify(response.body), /not loaded/)
    assert.equal(readJob(api.stateDir).status, 'running')
  } finally {
    systemctl.restore()
    api.stop()
  }
})

test('status settles a job whose unit is gone, even without a stored unit name', async () => {
  const api = fixture()
  seedJob(api.stateDir)
  const systemctl = stubSystemctl({
    exit: 0,
    stdout: 'ActiveState=inactive\nExecMainStatus=9\nResult=signal\nMainPID=0\nLoadState=loaded\n',
  })
  try {
    const tool = api.tools.get('outlive_status')
    const result = await tool.execute({ id: JOB })
    const text = typeof result === 'string' ? result : JSON.stringify(result)
    assert.match(text, /failed/)
    assert.equal(readJob(api.stateDir).status, 'failed')
    assert.equal(readJob(api.stateDir).exitCode, 9)
    assert.deepEqual(systemctl.calls(), [`--user show outlive-${JOB} --property=ActiveState,ExecMainStatus,Result,MainPID,LoadState`])
  } finally {
    systemctl.restore()
    api.stop()
  }
})
