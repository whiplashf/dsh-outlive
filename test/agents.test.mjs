import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAgentCommand, createAgents, findBinary, validateCustomAgent, shellQuote } from '../lib/agents.js'

function binDir(...names) {
  const dir = mkdtempSync(join(tmpdir(), 'outlive-bin-'))
  for (const name of names) {
    const path = join(dir, name)
    writeFileSync(path, '#!/bin/sh\necho 9.9.9\n')
    chmodSync(path, 0o755)
  }
  return dir
}

test('validateCustomAgent enforces name, absolute executable and {file}', () => {
  const dir = binDir('agent')
  const bin = join(dir, 'agent')
  assert.equal(validateCustomAgent({ name: '-bad', bin, args: '{file}' }).error, 'invalidName')
  assert.equal(validateCustomAgent({ name: 'mine', bin: 'agent', args: '{file}' }).error, 'binNotAbsolute')
  assert.equal(validateCustomAgent({ name: 'mine', bin: join(dir, 'nope'), args: '{file}' }).error, 'binNotExecutable')
  assert.equal(validateCustomAgent({ name: 'mine', bin, args: '--run' }).error, 'argsMissingFile')
  assert.deepEqual(validateCustomAgent({ name: 'mine', bin, args: '--run {file}' }), {
    ok: true,
    name: 'mine',
    bin,
    args: '--run {file}',
  })
})

test('buildAgentCommand reads the task file instead of interpolating it', () => {
  const command = buildAgentCommand({
    bin: '/opt/my agent/bin',
    args: 'run --title {title} -- {file}',
    taskFile: "/tmp/it's a task.txt",
    title: "hello 'world'",
  })
  assert.ok(command.startsWith("exec '/opt/my agent/bin' run --title 'hello '\\''world'\\'''"))
  assert.ok(command.includes('"$(cat \'/tmp/it\'\\\'\'s a task.txt\')"'))
  assert.ok(!command.includes('{file}'))
  assert.equal(shellQuote("a'b"), "'a'\\''b'")
})

test('findBinary searches PATH and joins relative-looking names', () => {
  const dir = binDir('opencode')
  assert.equal(findBinary('opencode', dir), join(dir, 'opencode'))
  assert.equal(findBinary('missing-agent', dir), null)
})

test('createAgents probes presets, marks unverified ones, and lets custom entries win', () => {
  const dir = binDir('opencode', 'gemini', 'mine')
  const customBin = join(dir, 'mine')
  const catalog = createAgents({
    pathEnv: dir,
    readCustom: () => [
      { name: 'opencode', bin: join(dir, 'opencode'), args: 'run {file}' },
      { name: 'mine', bin: customBin, args: '--do {file}' },
    ],
  })
  const agents = catalog.list()
  const opencode = agents.find((agent) => agent.name === 'opencode')
  assert.equal(opencode.source, 'custom')
  assert.deepEqual(opencode.args, 'run {file}')
  const gemini = agents.find((agent) => agent.name === 'gemini')
  assert.equal(gemini.source, 'preset')
  assert.equal(gemini.installed, true)
  assert.equal(catalog.usable(gemini), false, 'unverified preset has no argument template')
  assert.equal(catalog.resolve('auto').agent.name, 'opencode')
  assert.equal(catalog.resolve('mine').agent.name, 'mine')
  assert.equal(catalog.resolve('nope').error, 'unknown')
})
