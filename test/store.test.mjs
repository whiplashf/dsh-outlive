import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, resolveStateDir, taskKey } from '../lib/store.js'

function freshStore() {
  return createStore({ stateDir: mkdtempSync(join(tmpdir(), 'outlive-store-')) })
}

test('resolveStateDir: OUTLIVE_HOME, configured, XDG, home fallback', () => {
  assert.equal(
    resolveStateDir({ env: { OUTLIVE_HOME: '/tmp/one' }, home: '/home/u', configured: '/tmp/two' }),
    '/tmp/one',
  )
  assert.equal(resolveStateDir({ env: {}, home: '/home/u', configured: '/tmp/two' }), '/tmp/two')
  assert.equal(
    resolveStateDir({ env: { XDG_STATE_HOME: '/var/state' }, home: '/home/u' }),
    '/var/state/outlive',
  )
  assert.equal(resolveStateDir({ env: {}, home: '/home/u' }), '/home/u/.local/state/outlive')
})

test('createJob writes a running record with safe defaults', () => {
  const store = freshStore()
  const job = store.createJob({ kind: 'command', command: 'true' })
  assert.match(job.id, /^[0-9a-f]{12}$/)
  assert.equal(job.status, 'running')
  assert.equal(job.notify.state, 'none')
  assert.equal(job.runtimeMaxSec, 7200)
  assert.ok(existsSync(join(job.dir, 'job.json')))
  assert.ok(!store.removeJob(job.id).ok, 'running jobs cannot be removed')
})

test('settle maps the exit marker to completed, failed and cancelled', () => {
  const store = freshStore()
  const completed = store.createJob({ kind: 'command', command: 'true' })
  writeFileSync(join(completed.dir, 'exit'), '0 1700000000000\n')
  const done = store.settle(store.readJob(completed.id))
  assert.equal(done.status, 'completed')
  assert.equal(done.exitCode, 0)

  const failed = store.createJob({ kind: 'command', command: 'false' })
  writeFileSync(join(failed.dir, 'exit'), '2 1700000000000\n')
  assert.equal(store.settle(store.readJob(failed.id)).status, 'failed')

  const cancelled = store.createJob({ kind: 'command', command: 'sleep 10' })
  writeFileSync(join(cancelled.dir, 'exit'), '143 1700000000000\n')
  store.patchJob(cancelled.id, { killed: true })
  const stopped = store.settle(store.readJob(cancelled.id))
  assert.equal(stopped.status, 'cancelled')
  assert.equal(stopped.exitCode, 143)
})

test('settle fails a job whose unit vanished without an exit marker', () => {
  const store = freshStore()
  const job = store.createJob({ kind: 'command', command: 'true' })
  const settled = store.settle(job, { unit: { activeState: 'inactive', execMainStatus: 1, result: 'exit-code' } })
  assert.equal(settled.status, 'failed')
  assert.match(settled.error, /inactive/)
})

test('prune keeps the newest settled jobs and never touches running ones', () => {
  const store = freshStore()
  const running = store.createJob({ kind: 'command', command: 'sleep 1', startedAt: '2020-01-01T00:00:00.000Z' })
  for (let index = 0; index < 5; index += 1) {
    const job = store.createJob({
      kind: 'command',
      command: `true ${index}`,
      startedAt: new Date(Date.UTC(2021, 0, 1, 0, index)).toISOString(),
    })
    writeFileSync(join(job.dir, 'exit'), '0 1700000000000\n')
    store.settle(store.readJob(job.id))
  }
  const result = store.prune({ keep: 2 })
  assert.equal(result.removed, 3)
  assert.equal(store.listJobs().length, 3)
  assert.equal(store.readJob(running.id).status, 'running')
})

test('built-in restart task can be removed and restored', () => {
  const store = freshStore()
  store.ensureBuiltins()
  assert.ok(store.readTasks().some((task) => task.id === 'builtin-restart-dsh'))
  const removed = store.deleteTask('builtin-restart-dsh')
  assert.equal(removed.builtin, 'restart-dsh')
  assert.ok(!store.readTasks().some((task) => task.id === 'builtin-restart-dsh'))
  store.ensureBuiltins()
  assert.ok(!store.readTasks().some((task) => task.id === 'builtin-restart-dsh'), 'removal is sticky')
  assert.ok(store.restoreBuiltin('restart-dsh').ok)
  assert.ok(store.readTasks().some((task) => task.id === 'builtin-restart-dsh'))
})

test('saved tasks dedupe by content and keep the newest first', () => {
  const store = freshStore()
  const first = store.saveTask({ kind: 'agent', task: 'do the thing', agent: 'codex', cwd: '/tmp' })
  assert.ok(first.task.id)
  store.saveTask({ kind: 'agent', task: 'other' })
  store.saveTask({ kind: 'agent', task: 'do the thing', agent: 'codex', cwd: '/tmp' })
  const tasks = store.readTasks().filter((task) => !task.builtin)
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].id, first.task.id)
  assert.equal(tasks[0].id, taskKey({ kind: 'agent', command: 'do the thing', agent: 'codex', cwd: '/tmp' }))
})

test('clearSettled removes only finished jobs', () => {
  const store = freshStore()
  const running = store.createJob({ kind: 'command', command: 'sleep 1' })
  const done = store.createJob({ kind: 'command', command: 'true' })
  writeFileSync(join(done.dir, 'exit'), '0 1700000000000\n')
  store.settle(store.readJob(done.id))
  assert.deepEqual(store.clearSettled(), { removed: 1 })
  assert.ok(store.readJob(running.id))
  assert.equal(store.readJob(done.id), null)
})
