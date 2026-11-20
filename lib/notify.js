/**
 * Completion notices. A notice is a user message in the originating session,
 * written in the language that session's panel was using when the job was
 * submitted. Tool-initiated jobs are always English.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const STATUS = {
  en: { completed: 'completed', failed: 'failed', cancelled: 'cancelled', running: 'running' },
  zh: { completed: '已完成', failed: '失败', cancelled: '已中止', running: '运行中' },
}

export function pickLang(value) {
  return value === 'zh' ? 'zh' : 'en'
}

export function formatDuration(startedAt, finishedAt = new Date().toISOString()) {
  const start = Date.parse(startedAt)
  const end = Date.parse(finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—'
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** Last `lines` lines of a file, reading at most the final 16 KiB. */
export function readTail(path, lines = 20) {
  try {
    const size = statSync(path).size
    if (!size) return ''
    const length = Math.min(size, 16384)
    const buffer = Buffer.alloc(length)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buffer, 0, length, size - length)
    } finally {
      closeSync(fd)
    }
    const text = buffer.toString('utf8')
    const all = text.split(/\r?\n/)
    if (all.length && all[all.length - 1] === '') all.pop()
    return all.slice(-Math.max(1, lines)).join('\n')
  } catch {
    return ''
  }
}

export function defaultLabel(job, lang = 'en') {
  if (job.kind === 'restart') return lang === 'zh' ? '重启 DSH Web' : 'Restart DSH Web'
  if (job.kind === 'agent') return job.agent || 'Agent'
  return lang === 'zh' ? '命令' : 'Command'
}

export function noticeText(job, { lang = 'en', lines = 20 } = {}) {
  const language = pickLang(lang)
  const status = STATUS[language][job.status] || job.status
  const exit = Number.isFinite(job.exitCode) ? job.exitCode : '—'
  const duration = formatDuration(job.startedAt, job.finishedAt || new Date().toISOString())
  const tail = readTail(job.logPath, lines)
  if (language === 'zh') {
    const head = `[Outlive] 任务 ${job.id}（${job.label || defaultLabel(job, 'zh')}）${status} · exit ${exit} · 用时 ${duration}`
    return [head, `日志：${job.logPath}`, tail ? `最后几行：\n${tail}` : '', '用 outlive_status 可读取更多日志。']
      .filter(Boolean)
      .join('\n')
  }
  const head = `[Outlive] Job ${job.id} (${job.label || defaultLabel(job, 'en')}) ${status} · exit ${exit} · ${duration}`
  return [head, `Log: ${job.logPath}`, tail ? `Last lines:\n${tail}` : '', 'Use outlive_status to read more.']
    .filter(Boolean)
    .join('\n')
}

export function userMessage(text, jobId) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'outlive', jobId },
  }
}
