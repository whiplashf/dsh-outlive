import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { noticeText, pickLang, userMessage, formatDuration } from '../lib/notify.js'

function job(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'outlive-notify-'))
  writeFileSync(join(dir, 'out.log'), 'line one\nline two\nline three\n')
  return {
    id: '0123456789ab',
    kind: 'agent',
    status: 'completed',
    agent: 'codex',
    label: 'Fix the parser',
    exitCode: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:02:03.000Z',
    logPath: join(dir, 'out.log'),
    ...overrides,
  }
}

test('pickLang only trusts zh and en', () => {
  assert.equal(pickLang('zh'), 'zh')
  assert.equal(pickLang('en'), 'en')
  assert.equal(pickLang('auto'), 'en')
  assert.equal(pickLang(undefined), 'en')
})

test('noticeText reports status, exit, duration and a log tail in English', () => {
  const text = noticeText(job(), { lang: 'en', lines: 2 })
  assert.match(text, /^\[Outlive\] Job 0123456789ab \(Fix the parser\) completed/)
  assert.match(text, /exit 0/)
  assert.match(text, /2m 3s/)
  assert.match(text, /Log: /)
  assert.match(text, /line two\nline three/)
  assert.match(text, /outlive_status/)
})

test('noticeText switches to Chinese for a zh job', () => {
  const text = noticeText(job({ kind: 'command', agent: null, label: null, status: 'cancelled', exitCode: 143 }), { lang: 'zh' })
  assert.match(text, /^\[Outlive\] 任务 0123456789ab（命令）已中止/)
  assert.match(text, /exit 143/)
  assert.match(text, /日志/)
})

test('userMessage builds a conversation message with a source marker', () => {
  const message = userMessage('hello', '0123456789ab')
  assert.equal(message.role, 'user')
  assert.equal(message.content[0].text, 'hello')
  assert.deepEqual(message.source, { kind: 'outlive', jobId: '0123456789ab' })
  assert.match(message.id, /^[0-9a-f-]{36}$/)
})

test('formatDuration has stable units', () => {
  assert.equal(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:05Z'), '5s')
  assert.equal(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z'), '5m')
  assert.equal(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T02:30:00Z'), '2h 30m')
})
