import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acceptedEnv,
  startUnit,
  unitFor,
  unitValue,
  writeCommandScript,
  writeRunScript,
} from '../lib/dispatch.js'

function jobDir() {
  const dir = mkdtempSync(join(tmpdir(), 'outlive-run-'))
  writeCommandScript(dir, 'echo out\nexit 3\n')
  writeRunScript({
    dir,
    commandPath: join(dir, 'command.sh'),
    cwd: dir,
    logPath: join(dir, 'out.log'),
    exitPath: join(dir, 'exit'),
  })
  return dir
}

test('unitFor and unitValue keep systemd names and paths safe', () => {
  assert.equal(unitFor('0123456789ab'), 'outlive-0123456789ab')
  assert.equal(unitValue('/tmp/plain'), '/tmp/plain')
  assert.equal(unitValue('/tmp/with space'), '"/tmp/with space"')
  assert.equal(unitValue('/tmp/a"b'), '"/tmp/a\\"b"')
})

test('acceptedEnv forwards a narrow allowlist and drops multiline values', () => {
  const env = acceptedEnv({
    HOME: '/home/u',
    PATH: '/usr/bin',
    ANTHROPIC_API_KEY: 'secret',
    SOME_TOKEN: 'nope',
    BAD: 'x\ny',
    http_proxy: 'http://proxy',
  })
  assert.equal(env.HOME, '/home/u')
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.ANTHROPIC_API_KEY, 'secret')
  assert.equal(env.http_proxy, 'http://proxy')
  assert.ok(!('SOME_TOKEN' in env))
  assert.ok(!('BAD' in env))
})

test('run.sh records the exit code and log even when the command fails', () => {
  const dir = jobDir()
  const run = spawnSync('/usr/bin/env', ['bash', join(dir, 'run.sh')], { encoding: 'utf8' })
  assert.equal(run.status, 3)
  assert.match(readFileSync(join(dir, 'out.log'), 'utf8'), /out/)
  const [code, at] = readFileSync(join(dir, 'exit'), 'utf8').trim().split(/\s+/)
  assert.equal(code, '3')
  assert.ok(Number(at) > 0)
})

test('run.sh reports a missing working directory as 127', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outlive-run-'))
  writeCommandScript(dir, 'echo should-not-run\n')
  writeRunScript({
    dir,
    commandPath: join(dir, 'command.sh'),
    cwd: join(dir, 'missing'),
    logPath: join(dir, 'out.log'),
    exitPath: join(dir, 'exit'),
  })
  const run = spawnSync('/usr/bin/env', ['bash', join(dir, 'run.sh')], { encoding: 'utf8' })
  assert.equal(run.status, 127)
  assert.equal(readFileSync(join(dir, 'exit'), 'utf8').trim().split(/\s+/)[0], '127')
  assert.match(readFileSync(join(dir, 'out.log'), 'utf8'), /missing/)
})

test('startUnit rejects a unit name it did not generate', () => {
  const result = startUnit({ unit: 'not-outlive', scriptPath: '/tmp/x.sh' })
  assert.equal(result.error, 'invalidUnit')
})

test('writeCommandScript writes a bash body with set -u', () => {
  const dir = mkdirSync(join(mkdtempSync(join(tmpdir(), 'outlive-cmd-')), 'job'), { recursive: true })
  const path = writeCommandScript(dir, 'echo hi\n')
  assert.match(readFileSync(path, 'utf8'), /^#!\/usr\/bin\/env bash\nset -u\necho hi/)
})
