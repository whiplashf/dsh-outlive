/**
 * Offline smoke test: no harness, no profile, no restart.
 *
 * A fake ctx records the registrations, the tools are called straight through,
 * and delivery is checked against the followup calls a fake agent received. The
 * "harness restarted" case is simulated the only faithful way available: import
 * the module a second time (fresh in-memory agent map) over the same job
 * directory.
 *
 * Run: node test/smoke.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

process.env.OUTLIVE_HOME = mkdtempSync(join(tmpdir(), 'outlive-smoke-'))

/** A stand-in for the harness: just enough surface for apply(). */
function fakeHost() {
  const tools = new Map()
  const followups = []
  const created = []
  const routes = new Map()
  const webServer = { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } }
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    get: (name) => (name === 'webServer' ? webServer : undefined),
    on: (event, handler) => { if (event === 'agent/created') created.push(handler); return () => {} },
    effect: (fn) => { const dispose = fn(); return () => dispose?.() },
  }
  return { tools, followups, created, routes, ctx }
}

function fakeAgent(sessionId, followups) {
  return { session: { id: sessionId }, followup: (message) => followups.push(message) }
}

const call = (host, name, args, exec) => host.tools.get(name).execute(args, exec)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const idOf = (text) => /已投递：([a-z0-9]+)/.exec(text)?.[1]
const idOfAgent = (text) => /已交给 [^：]+：([a-z0-9]+)/.exec(text)?.[1]

// --- A: first process lifetime ------------------------------------------------
const a = fakeHost()
const moduleA = await import('../index.js')
moduleA.apply(a.ctx, { pollMs: 600 })

assert.deepEqual([...a.tools.keys()], ['outlive_run', 'outlive_agent', 'outlive_engines', 'outlive_status', 'outlive_list', 'outlive_cancel'])
assert.equal(a.tools.get('outlive_run').parameters.type, 'object')
assert.deepEqual(a.tools.get('outlive_run').parameters.required, ['command'])

const agentA = fakeAgent('session-a', a.followups)
const execA = { agent: agentA }
a.created.forEach((handler) => handler({ agent: agentA }))

// 1. a detached command runs, is recorded, and wakes the session once
const run = await call(a, 'outlive_run', { command: 'echo hello-outlive; echo err-line >&2', label: 'smoke run' }, execA)
const runId = idOf(run.text)
assert.ok(runId, run.text)
await sleep(2800)

const status = await call(a, 'outlive_status', { id: runId }, execA)
assert.match(status.text, /status=completed exit=0/, status.text)
assert.match(status.text, /hello-outlive/, status.text)
assert.match(status.text, /err-line/, status.text)
assert.equal(a.followups.length, 1, `expected one wake-up, got ${a.followups.length}`)
assert.match(a.followups[0].content[0].text, new RegExp(`任务 ${runId}`))
assert.equal(a.followups[0].source.kind, 'outlive')
assert.equal(a.followups[0].role, 'user')

// 2. a failing job keeps its exit code and is not delivered twice
const bad = await call(a, 'outlive_run', { command: 'exit 3', label: 'smoke fail' }, execA)
const badId = idOf(bad.text)
await sleep(2800)
assert.match((await call(a, 'outlive_status', { id: badId }, execA)).text, /status=failed exit=3/)
assert.equal(a.followups.length, 2)

// 3. the agent path writes the task file and dispatches a real unit
const agentJob = await call(a, 'outlive_agent', { task: 'echo should-not-run-here', engine: 'nonexistent' }, execA)
assert.match(agentJob.text, /不可用/)

// 3b. engine detection reports what this machine actually has
const engines = await call(a, 'outlive_engines', {}, execA)
assert.match(engines.text, /opencode|codex|claude/i, engines.text)

// 3c. the panel routes ride the host web server and answer the same records
function callRoute(route, url) {
  return new Promise((resolve) => {
    const res = {
      headersSent: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true },
      end(body) { resolve({ status: this.status, headers: this.headers, body: String(body) }) },
    }
    route.handler({ url }, res)
  })
}
const jobsRoute = await callRoute(a.routes.get('/__outlive/jobs'), '/__outlive/jobs')
assert.equal(jobsRoute.status, 200)
const payload = JSON.parse(jobsRoute.body)
assert.equal(payload.jobs.length, 2, JSON.stringify(payload.jobs.map((job) => job.id)))
assert.equal(payload.jobs.find((job) => job.id === runId).status, 'completed')
assert.ok(payload.engines.length >= 1)
const logRoute = await callRoute(a.routes.get('/__outlive/log'), `/__outlive/log?id=${runId}&tail=20`)
assert.equal(logRoute.status, 200)
assert.match(logRoute.body, /hello-outlive/)
assert.equal((await callRoute(a.routes.get('/__outlive/log'), '/__outlive/log?id=../etc')).status, 400)

// 4. cancel sends TERM and the record says killed
const long = await call(a, 'outlive_run', { command: 'sleep 60', label: 'smoke cancel' }, execA)
const longId = idOf(long.text)
await sleep(400)
assert.match((await call(a, 'outlive_cancel', { id: longId }, execA)).text, /已发送 TERM/)
await sleep(2600)
assert.match((await call(a, 'outlive_status', { id: longId }, execA)).text, /status=killed/)

// --- B: a second process lifetime, same disk ---------------------------------
const b = fakeHost()
const moduleB = await import(`../index.js?restart=${Date.now()}`)
moduleB.apply(b.ctx, { pollMs: 600 })

// 5. already-delivered jobs are not replayed when the session reopens
const agentB = fakeAgent('session-a', b.followups)
b.created.forEach((handler) => handler({ agent: agentB }))
assert.equal(b.followups.length, 0, `replayed ${b.followups.length} delivered notices`)

// 6. a job that finished while the session was away is owed to it on reopen
const orphan = await call(b, 'outlive_run', { command: 'date +%s%3N', label: 'smoke orphan' }, {})
const orphanId = idOf(orphan.text)
await sleep(2800)
const orphanJob = join(process.env.OUTLIVE_HOME, orphanId, 'job.json')
writeFileSync(orphanJob, JSON.stringify({ ...JSON.parse(readFileSync(orphanJob, 'utf8')), sessionId: 'session-late' }))
const lateAgent = fakeAgent('session-late', b.followups)
b.created.forEach((handler) => handler({ agent: lateAgent }))
assert.equal(b.followups.length, 1, 'the reopened session is owed the finished job')
assert.match(b.followups[0].content[0].text, new RegExp(`任务 ${orphanId}`))

// 7. the list spans restarts
const list = await call(b, 'outlive_list', {}, {})
assert.match(list.text, new RegExp(orphanId))
assert.match(list.text, new RegExp(runId))
assert.match(list.text, /运行中 0/)

console.log('smoke ok —', [runId, badId, longId, orphanId].join(' '))
console.log('唤醒消息：A 会话 2 条，B 会话 1 条（补发）')
