/**
 * outlive's browser half: one panel that shows what the harness is *not*
 * running — the jobs that were handed to systemd, so they outlive this page.
 *
 * It reads two same-origin routes the host half registers
 * (`/__outlive/jobs`, `/__outlive/log`) and keeps no state of its own: the job
 * directory on disk is the truth, and a reload of this panel is just another
 * read of it.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-outlive',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'outlive-jobs'
    const POLL_MS = 3000
    const LOG_POLL_MS = 2000
    const LOG_TAIL = 300

    const STATUS = {
      running: { text: '运行中', color: '#3b82f6', dot: true },
      completed: { text: '完成', color: '#16a34a', dot: false },
      failed: { text: '失败', color: '#dc2626', dot: false },
      killed: { text: '已中止', color: '#d97706', dot: false },
    }

    const styles = {
      page: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' },
      head: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
      title: { fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em' },
      meta: { fontSize: 12, opacity: 0.62 },
      spacer: { flex: 1 },
      row: { display: 'flex', gap: 6 },
      btn: {
        border: '1px solid color-mix(in oklab, currentColor 18%, transparent)',
        background: 'transparent', color: 'inherit', borderRadius: 8,
        padding: '4px 10px', fontSize: 12, cursor: 'pointer',
      },
      btnOn: { background: 'color-mix(in oklab, currentColor 10%, transparent)', fontWeight: 600 },
      btnPrimary: {
        background: 'color-mix(in oklab, currentColor 12%, transparent)',
        borderColor: 'color-mix(in oklab, currentColor 34%, transparent)', fontWeight: 600,
      },
      btnGhost: { border: 'none', background: 'transparent', color: 'inherit', opacity: 0.55, fontSize: 12, cursor: 'pointer', padding: '4px 6px' },
      section: { display: 'flex', flexDirection: 'column', gap: 8 },
      sectionHead: { display: 'flex', alignItems: 'baseline', gap: 10 },
      sectionTitle: { fontSize: 13, fontWeight: 620 },
      chips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
      chip: {
        fontSize: 11, padding: '2px 9px', borderRadius: 999,
        border: '1px solid color-mix(in oklab, currentColor 20%, transparent)', opacity: 0.8,
      },
      chipOn: {
        opacity: 1, fontWeight: 600,
        borderColor: 'color-mix(in oklab, currentColor 48%, transparent)',
        background: 'color-mix(in oklab, currentColor 8%, transparent)',
      },
      taskItem: {
        display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10,
        padding: '8px 12px', fontSize: 13,
        borderTop: '1px solid color-mix(in oklab, currentColor 10%, transparent)',
      },
      taskMain: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
      textarea: {
        width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 62,
        padding: '8px 10px', borderRadius: 10, color: 'inherit', fontSize: 12.5, lineHeight: 1.5,
        border: '1px solid color-mix(in oklab, currentColor 16%, transparent)',
        background: 'color-mix(in oklab, currentColor 4%, transparent)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      input: {
        flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 8, color: 'inherit', fontSize: 12.5,
        border: '1px solid color-mix(in oklab, currentColor 16%, transparent)',
        background: 'color-mix(in oklab, currentColor 4%, transparent)',
      },
      list: {
        border: '1px solid color-mix(in oklab, currentColor 14%, transparent)',
        borderRadius: 12, overflow: 'hidden',
      },
      item: {
        display: 'grid', gridTemplateColumns: '86px 1fr auto auto', alignItems: 'center', gap: 10,
        padding: '9px 12px', cursor: 'pointer', fontSize: 13,
        borderTop: '1px solid color-mix(in oklab, currentColor 10%, transparent)',
      },
      itemFirst: { borderTop: 'none' },
      itemOn: { background: 'color-mix(in oklab, currentColor 7%, transparent)' },
      label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: { fontSize: 11, opacity: 0.72, fontVariantNumeric: 'tabular-nums' },
      engine: {
        fontSize: 11, padding: '1px 7px', borderRadius: 999,
        border: '1px solid color-mix(in oklab, currentColor 22%, transparent)', opacity: 0.85,
      },
      detail: {
        border: '1px solid color-mix(in oklab, currentColor 14%, transparent)',
        borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
      },
      kv: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, opacity: 0.75 },
      pre: {
        margin: 0, padding: 10, borderRadius: 8, maxHeight: '46vh', overflow: 'auto',
        background: 'color-mix(in oklab, currentColor 6%, transparent)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },
      empty: { padding: '28px 12px', textAlign: 'center', fontSize: 13, opacity: 0.6 },
      hint: { fontSize: 12, opacity: 0.55, lineHeight: 1.7 },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
    }

    function ago(iso) {
      const at = Date.parse(iso || '')
      if (!Number.isFinite(at)) return ''
      const s = Math.max(0, Math.round((Date.now() - at) / 1000))
      if (s < 60) return `${s}秒前`
      if (s < 3600) return `${Math.round(s / 60)}分钟前`
      if (s < 86400) return `${Math.round(s / 3600)}小时前`
      return `${Math.round(s / 86400)}天前`
    }

    function duration(job) {
      const from = Date.parse(job.startedAt || '')
      const to = job.finishedAt ? Date.parse(job.finishedAt) : Date.now()
      if (!Number.isFinite(from) || !Number.isFinite(to)) return ''
      const s = Math.max(0, Math.round((to - from) / 1000))
      if (s < 60) return `${s}s`
      if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
      return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
    }

    async function readJson(path, signal) {
      const res = await fetch(path, { signal, credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json()
    }

    function StatusPill({ status }) {
      const style = STATUS[status] || { text: status, color: 'currentColor' }
      return h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: style.color } },
        h('span', {
          style: {
            width: 7, height: 7, borderRadius: 999, background: style.color,
            opacity: style.dot ? 1 : 0.6,
            ...(style.dot ? { animation: 'outlive-pulse 1.6s ease-in-out infinite' } : {}),
          },
        }),
        style.text)
    }

    function LogView({ id, running }) {
      const [text, setText] = useState('')
      const [error, setError] = useState('')
      useEffect(() => {
        let alive = true
        let timer
        const load = async () => {
          try {
            const res = await fetch(`/__outlive/log?id=${encodeURIComponent(id)}&tail=${LOG_TAIL}`, {
              credentials: 'same-origin',
              headers: { accept: 'text/plain' },
            })
            const body = await res.text()
            if (!alive) return
            setError(res.ok ? '' : body)
            setText(res.ok ? body : '')
          } catch (err) {
            if (alive) setError(String(err && err.message ? err.message : err))
          }
          if (alive && running) timer = setTimeout(load, LOG_POLL_MS)
        }
        load()
        return () => { alive = false; clearTimeout(timer) }
      }, [id, running])
      if (error) return h('div', { style: styles.hint }, error)
      return h('pre', { style: styles.pre }, text || '（暂无输出）')
    }

    function describeDefault(engines, defaultEngine) {
      if (!engines || engines.length === 0) return '本机没检测到编码 agent'
      const pick = defaultEngine && defaultEngine.name
        ? engines.find((engine) => engine.name === defaultEngine.name)
        : engines[0]
      return pick ? `默认 ${pick.label}` : ''
    }

    async function postJson(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-outlive': '1' },
        body: JSON.stringify(body),
      })
      const value = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(value.error || `${res.status} ${res.statusText}`)
      return value
    }

    function describeEngines(engines, fallback) {
      if (!engines || engines.length === 0) return '没探到执行器'
      return engines.map((engine) => `${engine.name} ${engine.version || ''}`.trim()).join(' · ')
    }

    function OutlivePage() {
      const [data, setData] = useState({ engines: [], jobs: [] })
      const [tasks, setTasks] = useState([])
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [filter, setFilter] = useState('all')
      const [openId, setOpenId] = useState(null)
      const [detecting, setDetecting] = useState(false)
      const [command, setCommand] = useState('')
      const [label, setLabel] = useState('')
      const [posting, setPosting] = useState(false)
      const busy = useRef(false)

      const load = useCallback(async () => {
        if (busy.current) return
        busy.current = true
        try {
          const [jobs, saved] = await Promise.all([
            readJson('/__outlive/jobs'),
            readJson('/__outlive/tasks').catch(() => ({ tasks: [] })),
          ])
          setData(jobs)
          setTasks(saved.tasks || [])
          setError('')
        } catch (err) {
          setError(`读不到任务列表：${err && err.message ? err.message : err}`)
        } finally {
          busy.current = false
        }
      }, [])

      useEffect(() => {
        let alive = true
        let timer
        const tick = async () => {
          await load()
          if (alive) timer = setTimeout(tick, POLL_MS)
        }
        tick()
        return () => { alive = false; clearTimeout(timer) }
      }, [load])

      const detect = useCallback(async () => {
        setDetecting(true)
        setNotice('')
        try {
          const next = await readJson('/__outlive/engines?refresh=1')
          setData((prev) => ({ ...prev, engines: next.engines, defaultEngine: next.defaultEngine }))
          setNotice(`探到 ${(next.engines || []).length} 个执行器`)
        } catch (err) {
          setNotice(`检测失败：${err && err.message ? err.message : err}`)
        } finally {
          setDetecting(false)
        }
      }, [])

      const runTask = useCallback(async (task) => {
        setNotice('')
        try {
          const started = await postJson('/__outlive/run', {
            command: task.command,
            label: task.label,
            cwd: task.cwd || undefined,
            taskId: task.id,
          })
          setNotice(`已投递 ${started.id}`)
          await load()
        } catch (err) {
          setNotice(`投递失败：${err && err.message ? err.message : err}`)
        }
      }, [load])

      const forgetTask = useCallback(async (task) => {
        try {
          const next = await postJson('/__outlive/tasks/delete', { id: task.id })
          setTasks(next.tasks || [])
        } catch (err) {
          setNotice(`删除失败：${err && err.message ? err.message : err}`)
        }
      }, [])

      const submit = useCallback(async (alsoRun) => {
        const text = command.trim()
        if (!text) return
        setPosting(true)
        setNotice('')
        try {
          const saved = await postJson('/__outlive/tasks', { command: text, label: label.trim() })
          setTasks(saved.tasks || [])
          setCommand('')
          setLabel('')
          if (alsoRun) {
            const started = await postJson('/__outlive/run', {
              command: text,
              label: saved.task ? saved.task.label : undefined,
              taskId: saved.task ? saved.task.id : undefined,
            })
            setNotice(`已投递 ${started.id}`)
          } else {
            setNotice('已存为常用任务')
          }
          await load()
        } catch (err) {
          setNotice(`失败：${err && err.message ? err.message : err}`)
        } finally {
          setPosting(false)
        }
      }, [command, label, load])

      const jobs = data.jobs || []
      const running = useMemo(() => jobs.filter((job) => job.status === 'running').length, [jobs])
      const shown = useMemo(() => {
        if (filter === 'running') return jobs.filter((job) => job.status === 'running')
        if (filter === 'settled') return jobs.filter((job) => job.status !== 'running')
        return jobs
      }, [jobs, filter])
      const open = jobs.find((job) => job.id === openId) || null

      return h('div', { style: styles.page },
        h('style', null, '@keyframes outlive-pulse{0%,100%{opacity:.35}50%{opacity:1}}'),
        h('div', { style: styles.head },
          h('div', { style: styles.title }, '离场任务'),
          h('div', { style: styles.meta },
            `${jobs.length} 条 · 运行中 ${running}`,
            data.engines && data.engines.length ? ` · 默认 ${describeDefault(data.engines, data.defaultEngine)}` : ''),
          h('div', { style: styles.spacer }),
          h('div', { style: styles.row },
            ...[['all', '全部'], ['running', '运行中'], ['settled', '已完成']].map(([key, text]) =>
              h('button', {
                key,
                style: { ...styles.btn, ...(filter === key ? styles.btnOn : {}) },
                onClick: () => setFilter(key),
              }, text)),
            h('button', { style: styles.btn, onClick: () => void load(), title: '立刻刷新' }, '刷新')),
        ),

        // engines: what this machine can actually hand work to, rechecked on demand
        h('div', { style: styles.section },
          h('div', { style: styles.sectionHead },
            h('span', { style: styles.sectionTitle }, '执行器'),
            h('span', { style: styles.meta }, describeEngines(data.engines, '')),
            h('div', { style: styles.spacer }),
            h('button', {
              style: { ...styles.btn, ...(detecting ? styles.btnOn : {}) },
              onClick: () => void detect(),
              title: '重新探测本机装了哪些 agent CLI',
            }, detecting ? '检测中…' : '检测')),
          (data.engines || []).length === 0
            ? h('div', { style: styles.hint }, '没有探到 opencode / codex / claude。')
            : h('div', { style: styles.chips },
              (data.engines || []).map((engine) => h('span', {
                key: engine.name,
                style: {
                  ...styles.chip,
                  ...(data.defaultEngine && data.defaultEngine.name === engine.name ? styles.chipOn : {}),
                },
                title: engine.bin || '',
              }, `${engine.label || engine.name} ${engine.version || ''}`.trim())))),

        // saved tasks: the things worth running again
        h('div', { style: styles.section },
          h('div', { style: styles.sectionHead },
            h('span', { style: styles.sectionTitle }, '常用任务'),
            h('span', { style: styles.meta }, tasks.length ? `${tasks.length} 条` : '空'),
            h('div', { style: styles.spacer })),
          tasks.length === 0
            ? h('div', { style: styles.hint }, '还没有存过任务。在下面写一条命令，点「保存并运行」。')
            : h('div', { style: styles.list },
              tasks.map((task, index) => h('div', {
                key: task.id,
                style: { ...styles.taskItem, ...(index === 0 ? styles.itemFirst : {}) },
              },
              h('div', { style: styles.taskMain },
                h('div', { style: styles.label }, task.label),
                h('div', { style: { ...styles.badge, ...styles.code, opacity: 0.6 } }, task.command.length > 90 ? `${task.command.slice(0, 90)}…` : task.command)),
              h('div', { style: styles.row },
                h('button', { style: styles.btn, onClick: () => void runTask(task) }, '运行'),
                h('button', { style: styles.btnGhost, onClick: () => void forgetTask(task) }, '删除')))))),

        // create: one command, optionally remembered
        h('div', { style: styles.section },
          h('div', { style: styles.sectionHead }, h('span', { style: styles.sectionTitle }, '新建任务')),
          h('textarea', {
            style: styles.textarea,
            rows: 3,
            placeholder: '要跑的命令（bash 语义，在会话之外的 systemd unit 里执行）',
            value: command,
            onChange: (event) => setCommand(event.currentTarget.value),
          }),
          h('div', { style: styles.row },
            h('input', {
              style: styles.input,
              placeholder: '给它起个名字（可留空）',
              value: label,
              onChange: (event) => setLabel(event.currentTarget.value),
            }),
            h('button', {
              style: { ...styles.btn, ...styles.btnPrimary },
              disabled: posting || command.trim() === '',
              onClick: () => void submit(true),
            }, posting ? '投递中…' : '保存并运行'),
            h('button', {
              style: styles.btn,
              disabled: posting || command.trim() === '',
              onClick: () => void submit(false),
            }, '只保存'))),

        notice ? h('div', { style: styles.hint }, notice) : null,
        error ? h('div', { style: styles.hint }, error) : null,
        h('div', { style: styles.list },
          shown.length === 0
            ? h('div', { style: styles.empty }, jobs.length === 0 ? '还没有任务。' : '这个筛选下没有任务。')
            : shown.map((job, index) => h('div', {
              key: job.id,
              style: {
                ...styles.item,
                ...(index === 0 ? styles.itemFirst : {}),
                ...(job.id === openId ? styles.itemOn : {}),
              },
              onClick: () => setOpenId(job.id === openId ? null : job.id),
              title: `${job.id}\n${job.cwd || ''}`,
            },
            h(StatusPill, { status: job.status }),
            h('div', { style: styles.label }, job.label || job.id),
            h('span', { style: styles.engine }, job.engine || job.kind),
            h('span', { style: styles.badge }, `${duration(job)} · ${ago(job.startedAt)}`)))),
        open
          ? h('div', { style: styles.detail },
            h('div', { style: styles.kv },
              h('span', null, h('span', { style: styles.code }, open.id)),
              h('span', null, `退出码 ${open.exitCode === null ? '-' : open.exitCode}`),
              h('span', null, open.cwd || ''),
              h('span', null, open.finishedAt ? `结束于 ${ago(open.finishedAt)}` : '还在跑')),
            open.error ? h('div', { style: styles.hint }, open.error) : null,
            h(LogView, { id: open.id, running: open.status === 'running' }))
          : null,
        h('div', { style: styles.hint },
          '任务在 systemd 的独立 unit 里跑，关掉这个页面、重启 dsh 都不影响它。',
          h('br'),
          '想让我去投，直接在对话里说；输入 ',
          h('span', { style: styles.code }, '/'),
          ' 也能选到常用任务。'),
      )
    }

    function OutliveIcon({ size = 18, active = false }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block', opacity: active ? 1 : 0.82 },
      },
      h('path', { d: 'M14 4.5c3 1 5.5 3.5 5.5 6.5 0 4-3.5 7.5-7.5 7.5-3 0-5.5-2.5-6.5-5.5' }),
      h('path', { d: 'M9.5 14.5 4.5 19.5M4 15.5l4.5 4.5' }),
      h('circle', { cx: 14, cy: 10, r: 1.6 }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ ctx }),
        }, OutlivePage))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 24,
          label: () => '离场任务',
        }, OutliveIcon))

        // A '/' source of its own, so a saved task is reachable from the
        // composer the same way a skill is: type '/', pick a row, and the
        // command lands in the draft. Picking never runs anything by itself —
        // the draft is still the user's to send.
        const source = {
          trigger: '/',
          name: 'outlive',
          order: 30,
          async candidates(session, { query, signal }) {
            const data = await readJson('/__outlive/tasks', signal).catch(() => ({ tasks: [] }))
            const needle = String(query || '').trim().toLowerCase()
            return (data.tasks || [])
              .filter((task) => !needle
                || `${task.label} ${task.command}`.toLowerCase().includes(needle))
              .map((task) => ({
                name: task.label,
                description: task.command.length > 80 ? `${task.command.slice(0, 80)}…` : task.command,
                value: task.command,
              }))
          },
          onPick({ candidate }) {
            return { text: `用 outlive 跑这条命令（在会话之外的 systemd unit 里执行）：\n${candidate.value}` }
          },
        }

        const attach = (triggers) => {
          if (!triggers || typeof triggers.registerSource !== 'function') return
          try {
            ctx.effect(() => triggers.registerSource(source))
          } catch (err) {
            console.error('[outlive] 注册 / 触发源失败:', err)
          }
        }

        try {
          const ready = ctx.get('inputTriggers')
          if (ready) attach(ready)
          else if (typeof ctx.inject === 'function') {
            ctx.inject(['inputTriggers'], (scope) => attach(scope.get('inputTriggers')))
          }
        } catch (err) {
          console.error('[outlive] 拿不到 inputTriggers:', err)
        }
      },
    }
  },
})
