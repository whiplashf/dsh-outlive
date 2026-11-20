import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  httpHost,
  planRestart,
  portsFromSs,
  restartPlanText,
  serviceUnitsInCgroup,
  writeEnvironmentFile,
  writeRestartScript,
} from '../lib/restart.js'

function procIo(cgroup, argv) {
  return {
    readFile(path) {
      if (path.endsWith('/cgroup')) return cgroup
      if (path.endsWith('/cmdline')) return argv.join('\0')
      if (path.endsWith('/environ')) return 'HOME=/home/dev\0PATH=/usr/bin\0'
      throw new Error(`unexpected read: ${path}`)
    },
    readlink() {
      return '/home/dev/workspace'
    },
  }
}

test('serviceUnitsInCgroup returns the deepest unit first', () => {
  assert.deepEqual(
    serviceUnitsInCgroup('0::/user.slice/user-1001.slice/user@1001.service/dsh-web.service\n'),
    ['dsh-web.service', 'user@1001.service'],
  )
})

test('httpHost normalises wildcard binds and rejects junk', () => {
  assert.equal(httpHost(['dsh', 'web', '--host', '0.0.0.0']), '127.0.0.1')
  assert.equal(httpHost(['dsh', 'web', '--host=::']), '127.0.0.1')
  assert.equal(httpHost(['dsh', 'web', '--host', '10.0.0.5']), '10.0.0.5')
  assert.equal(httpHost(['dsh', 'web', '--host', 'bad host']), '127.0.0.1')
  assert.equal(httpHost(['dsh', 'web']), '127.0.0.1')
})

test('portsFromSs picks only the ports owned by the pid', () => {
  const output = [
    'LISTEN 0 4096 127.0.0.1:13080 0.0.0.0:* users:(("node",pid=42,fd=22))',
    'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))',
    'LISTEN 0 4096 [::1]:13080 [::]:* users:(("node",pid=42,fd=21))',
  ].join('\n')
  assert.deepEqual(portsFromSs(output, 42), [13080])
})

test('planRestart chooses unit mode only for a persistent unit that owns the pid', () => {
  const argv = ['/usr/local/nodejs/bin/dsh', 'web', '--host', '127.0.0.1', '--port', '13080']
  const io = procIo('0::/user.slice/user-1001.slice/user@1001.service/dsh-web.service\n', argv)
  const plan = planRestart({ pid: 42, io, show: () => ({ loadState: 'loaded', transient: false, mainPid: 42 }), ports: () => [] })
  assert.equal(plan.mode, 'unit')
  assert.equal(plan.unit, 'dsh-web.service')
  assert.deepEqual(plan.ports, [13080])
  assert.equal(plan.cwd, '/home/dev/workspace')
  assert.equal(plan.argv[0], '/usr/local/nodejs/bin/dsh')
})

test('planRestart falls back to process mode without a persistent unit', () => {
  const argv = ['/usr/bin/dsh', 'web', '--port', '8080']
  const io = procIo('0::/user.slice/user-1001.slice/user@1001.service/init.scope\n', argv)
  const plan = planRestart({ pid: 7, io, show: () => null, ports: () => [9000] })
  assert.equal(plan.mode, 'process')
  assert.equal(plan.unit, null)
  assert.deepEqual(plan.ports, [8080, 9000])
})

test('restartPlanText describes both plans', () => {
  assert.equal(restartPlanText({ mode: 'unit', unit: 'dsh-web.service' }), 'systemctl --user restart dsh-web.service')
  const text = restartPlanText({ mode: 'process', pid: 42, argv: ['/bin/dsh', 'web', '--port', '1'] })
  assert.match(text, /kill -TERM 42/)
  assert.match(text, /start \/bin\/dsh web --port 1/)
})

test('writeEnvironmentFile keeps only valid keys and is 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outlive-env-'))
  const path = join(dir, 'restart.env')
  writeEnvironmentFile(path, { HOME: '/home/u', QUOTED: 'a"b', BAD: 'x\ny', 'bad-key': 'x' })
  const text = readFileSync(path, 'utf8')
  assert.match(text, /^HOME="\/home\/u"$/m)
  assert.match(text, /^QUOTED="a\\"b"$/m)
  assert.ok(!text.includes('BAD='))
  assert.ok(!text.includes('bad-key'))
  assert.equal(statSync(path).mode & 0o777, 0o600)
})

test('writeRestartScript restarts the unit and checks the port', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outlive-script-'))
  const script = writeRestartScript({
    dir,
    plan: { mode: 'unit', unit: 'dsh-web.service', pid: 42, cwd: '/tmp', argv: ['/bin/dsh'], ports: [13080], host: '127.0.0.1' },
    unit: 'dsh-web.service',
    logPath: join(dir, 'out.log'),
    exitPath: join(dir, 'exit'),
    envPath: join(dir, 'restart.env'),
  })
  const text = readFileSync(script, 'utf8')
  assert.match(text, /systemctl --user restart 'dsh-web\.service'/)
  assert.ok(text.includes('/dev/tcp/127.0.0.1/$port'))
  assert.ok(!text.includes('kill -TERM'))
})

test('writeRestartScript kills and relaunches in process mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outlive-script-'))
  const script = writeRestartScript({
    dir,
    plan: { mode: 'process', unit: null, pid: 42, cwd: '/tmp/a b', argv: ['/bin/dsh', 'web', '--port', '8080'], ports: [8080], host: '127.0.0.1' },
    unit: 'outlive-dsh-abc',
    logPath: join(dir, 'out.log'),
    exitPath: join(dir, 'exit'),
    envPath: join(dir, 'restart.env'),
  })
  const text = readFileSync(script, 'utf8')
  assert.match(text, /kill -TERM 42/)
  assert.match(text, /systemd-run --user --collect/)
  assert.match(text, /--property=WorkingDirectory="\/tmp\/a b"/)
  assert.match(text, /--property=EnvironmentFile="/)
  assert.match(text, /-- '\/bin\/dsh' 'web' '--port' '8080'/)
})
