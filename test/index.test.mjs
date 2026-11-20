import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../index.js'

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

/** Invoke one panel route the way the authenticated `/api` carrier does. */
async function invoke(routes, path, { method = 'GET', headers = {}, body, query } = {}) {
  const route = routes.get(path)
  assert.ok(route, `route ${path} is registered`)
  const search = query ? `?${query}` : ''
  const request = new Request(`http://harness.test${path}${search}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const response = await route.fetch(request)
  const text = await response.text()
  return { status: response.status, headers: Object.fromEntries(response.headers), body: text ? JSON.parse(text) : null }
}

function fixture() {
  const stateDir = mkdtempSync(join(tmpdir(), 'outlive-api-'))
  const { ctx, tools, routes, dispose } = makeCtx()
  const cleanup = plugin.apply(ctx, { stateDir, pollMs: 60000 })
  return { stateDir, tools, routes, stop: () => { cleanup?.(); dispose() } }
}

const post = (headers = {}) => ({ 'x-outlive': '1', 'content-type': 'application/json', ...headers })

test('plugin exports the expected name and tools', async () => {
  const api = fixture()
  try {
    assert.equal(plugin.name, 'outlive')
    assert.deepEqual([...api.tools.keys()].sort(), [
      'outlive_agent',
      'outlive_agents',
      'outlive_cancel',
      'outlive_engines',
      'outlive_list',
      'outlive_run',
      'outlive_status',
    ])
    const state = await invoke(api.routes, '/api/outlive/state')
    assert.equal(state.status, 200)
    assert.equal(state.body.stateDir, api.stateDir)
    assert.equal(state.body.version, '1.0.0')
    assert.ok(state.body.agents.list.length >= 3)
    assert.deepEqual(state.body.tasks, [], 'a fresh state dir has no saved tasks')
  } finally {
    api.stop()
  }
})

test('the panel payload keeps the command of a job', async () => {
  const api = fixture()
  try {
    const dir = join(api.stateDir, 'jobs', 'aaaaaaaabbbb')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'job.json'),
      JSON.stringify({
        id: 'aaaaaaaabbbb',
        kind: 'command',
        status: 'completed',
        label: 'restart',
        command: 'systemctl --user restart dsh-web.service',
        startedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    )
    const state = await invoke(api.routes, '/api/outlive/state')
    assert.equal(state.status, 200)
    const job = state.body.jobs.find((entry) => entry.id === 'aaaaaaaabbbb')
    assert.ok(job, 'the seeded job is listed')
    assert.equal(job.command, 'systemctl --user restart dsh-web.service')
    assert.equal(job.kind, 'command')
  } finally {
    api.stop()
  }
})

test('panel POST routes require the x-outlive header', async () => {
  const api = fixture()
  try {
    const denied = await invoke(api.routes, '/api/outlive/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: {} })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.error, 'forbidden')
    const badType = await invoke(api.routes, '/api/outlive/run', { method: 'POST', headers: { 'x-outlive': '1' }, body: {} })
    assert.equal(badType.status, 415)
  } finally {
    api.stop()
  }
})

test('file browser rejects relative paths through the API', async () => {
  const api = fixture()
  try {
    const result = await invoke(api.routes, '/api/outlive/fs', { query: 'path=relative' })
    assert.equal(result.status, 404)
    assert.equal(result.body.error, 'invalidPath')
  } finally {
    api.stop()
  }
})

test('saved tasks round-trip and can be deleted', async () => {
  const api = fixture()
  try {
    const saved = await invoke(api.routes, '/api/outlive/tasks', {
      method: 'POST',
      headers: post(),
      body: { kind: 'agent', task: 'review the diff', agent: 'auto', label: 'Review' },
    })
    assert.equal(saved.status, 200)
    assert.ok(saved.body.task.id)

    const removed = await invoke(api.routes, '/api/outlive/tasks/delete', {
      method: 'POST',
      headers: post(),
      body: { id: saved.body.task.id },
    })
    assert.equal(removed.status, 200)
    const afterRemove = await invoke(api.routes, '/api/outlive/state')
    assert.ok(!afterRemove.body.tasks.some((task) => task.label === 'Review'))
    assert.equal(afterRemove.body.builtins, undefined)
  } finally {
    api.stop()
  }
})

test('run rejects an unknown agent and a missing working directory', async () => {
  const api = fixture()
  try {
    const unknown = await invoke(api.routes, '/api/outlive/run', {
      method: 'POST',
      headers: post(),
      body: { kind: 'agent', task: 'do it', agent: 'definitely-missing', label: 'x' },
    })
    assert.equal(unknown.status, 200)
    assert.equal(unknown.body.error, 'unknown')

    const badCwd = await invoke(api.routes, '/api/outlive/run', {
      method: 'POST',
      headers: post(),
      body: { kind: 'command', command: 'true', cwd: '/definitely/missing', label: 'x' },
    })
    assert.equal(badCwd.status, 200)
    assert.match(String(badCwd.body.error), /working directory/)
    assert.equal(badCwd.body.job.status, 'failed')
  } finally {
    api.stop()
  }
})
