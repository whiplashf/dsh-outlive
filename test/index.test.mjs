import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import * as plugin from '../index.js'

function makeCtx() {
  const tools = new Map()
  const routes = new Map()
  let dispose = null
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool) } },
    effect(fn) { dispose = fn(); return dispose },
    on() {},
    off() {},
    inject(deps, callback) {
      if (!deps.includes('webServer')) return
      callback({
        effect(fn) { fn() },
        webServer: { register(route) { routes.set(route.path, route.handler) } },
      })
    },
  }
  return { ctx, tools, routes, dispose: () => dispose?.() }
}

function invoke(handler, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = new Readable({ read() {} })
    req.method = method
    req.url = url
    req.headers = headers
    let statusCode = 0
    const responseHeaders = {}
    const res = {
      writableEnded: false,
      get statusCode() { return statusCode },
      set statusCode(value) { statusCode = value },
      setHeader(key, value) { responseHeaders[key.toLowerCase()] = value },
      end(payload) {
        this.writableEnded = true
        resolve({ status: statusCode, headers: responseHeaders, body: payload ? JSON.parse(payload) : null })
      },
    }
    handler(req, res)
    if (body !== undefined) req.push(JSON.stringify(body))
    req.push(null)
  })
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
    const state = await invoke(api.routes.get('/__outlive/state'))
    assert.equal(state.status, 200)
    assert.equal(state.body.stateDir, api.stateDir)
    assert.equal(state.body.version, '1.0.0')
    assert.ok(state.body.agents.list.length >= 3)
    assert.ok(state.body.tasks.some((task) => task.id === 'builtin-restart-dsh'))
  } finally {
    api.stop()
  }
})

test('panel POST routes require the x-outlive header', async () => {
  const api = fixture()
  try {
    const denied = await invoke(api.routes.get('/__outlive/run'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: {} })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.error, 'forbidden')
    const badType = await invoke(api.routes.get('/__outlive/run'), { method: 'POST', headers: { 'x-outlive': '1' }, body: {} })
    assert.equal(badType.status, 415)
  } finally {
    api.stop()
  }
})

test('file browser rejects relative paths through the API', async () => {
  const api = fixture()
  try {
    const result = await invoke(api.routes.get('/__outlive/fs'), { url: '/__outlive/fs?path=relative' })
    assert.equal(result.status, 404)
    assert.equal(result.body.error, 'invalidPath')
  } finally {
    api.stop()
  }
})

test('saved tasks round-trip and the built-in can be removed and restored', async () => {
  const api = fixture()
  try {
    const saved = await invoke(api.routes.get('/__outlive/tasks'), {
      method: 'POST',
      headers: post(),
      body: { kind: 'agent', task: 'review the diff', agent: 'auto', label: 'Review' },
    })
    assert.equal(saved.status, 200)
    assert.ok(saved.body.task.id)

    const removed = await invoke(api.routes.get('/__outlive/tasks/delete'), {
      method: 'POST',
      headers: post(),
      body: { id: 'builtin-restart-dsh' },
    })
    assert.equal(removed.status, 200)
    const afterRemove = await invoke(api.routes.get('/__outlive/state'))
    assert.deepEqual(afterRemove.body.builtins.removed, ['restart-dsh'])

    const restored = await invoke(api.routes.get('/__outlive/tasks/restore'), {
      method: 'POST',
      headers: post(),
      body: { key: 'restart-dsh' },
    })
    assert.equal(restored.status, 200)
    const afterRestore = await invoke(api.routes.get('/__outlive/state'))
    assert.deepEqual(afterRestore.body.builtins.removed, [])
    assert.ok(afterRestore.body.tasks.some((task) => task.id === 'builtin-restart-dsh'))
    assert.ok(afterRestore.body.tasks.some((task) => task.label === 'Review'))
  } finally {
    api.stop()
  }
})

test('run rejects an unknown agent and a missing working directory', async () => {
  const api = fixture()
  try {
    const unknown = await invoke(api.routes.get('/__outlive/run'), {
      method: 'POST',
      headers: post(),
      body: { kind: 'agent', task: 'do it', agent: 'definitely-missing', label: 'x' },
    })
    assert.equal(unknown.status, 200)
    assert.equal(unknown.body.error, 'unknown')

    const badCwd = await invoke(api.routes.get('/__outlive/run'), {
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
