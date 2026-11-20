import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await readFile(path.join(here, '..', 'client.js'), 'utf8')

// The panel is a browser module: `window.__ModuleLoader__.load({ factory })`. This
// harness evaluates it with a minimal React and locale implementation so the whole
// component tree renders in Node, which catches missing dictionary keys, undefined
// props and render-time exceptions without a browser.
function createReact() {
  const flags = { dirty: false }
  let hooks = null
  const reinit = () => {
    hooks = { index: 0, cells: [], effects: [], dirty: false }
  }
  let slot = 0
  const cell = (make) => {
    const index = hooks.index++
    if (!(index in hooks.cells)) hooks.cells[index] = make()
    return hooks.cells[index]
  }
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }
    },
    useState(initial) {
      const state = cell(() => ({ value: typeof initial === 'function' ? initial() : initial }))
      return [
        state.value,
        (next) => {
          state.value = typeof next === 'function' ? next(state.value) : next
          flags.dirty = true
        },
      ]
    },
    useRef(initial) {
      return cell(() => ({ current: initial })).value
    },
    useEffect(fn) {
      const index = hooks.index++
      hooks.effects[index] = fn
    },
    useCallback(fn) {
      hooks.index += 1
      return fn
    },
    useMemo(fn) {
      hooks.index += 1
      return fn()
    },
    __begin: () => {
      reinit()
      return hooks
    },
    __hooks: () => hooks,
    __flags: () => flags,
    __slot: () => slot++,
  }
  return React
}

function createLoader(React) {
  let capture = null
  const window = {
    __ModuleLoader__: {
      load(definition) {
        capture = definition
      },
    },
  }
  const run = new Function('window', 'require', source)
  run(window, (id) => {
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })
  assert.ok(capture, 'client.js must register a module')
  return capture
}

const STATE = {
  version: '1.0.0',
  stateDir: '/tmp/outlive-state',
  pollMs: 3000,
  defaultCwd: '/home/dev/dsh-outlive',
  retention: 200,
  agents: {
    default: 'opencode',
    list: [
      { name: 'opencode', label: 'OpenCode', bin: '/usr/local/bin/opencode', version: '1.2.3', installed: true, ready: true, verified: true, source: 'preset', args: 'run --auto {file}' },
      { name: 'gemini', label: 'Gemini CLI', bin: '/usr/local/bin/gemini', version: '0.9.0', installed: true, ready: false, verified: false, source: 'preset', args: '' },
    ],
  },
  jobs: [
    {
      id: '0123456789ab',
      kind: 'restart',
      label: 'Restart DSH Web',
      status: 'completed',
      startedAt: Date.now() - 600000,
      finishedAt: Date.now() - 540000,
      exitCode: 0,
      agent: null,
    },
    {
      id: 'ba9876543210',
      kind: 'agent',
      label: 'Refactor the runner',
      status: 'running',
      startedAt: Date.now() - 60000,
      exitCode: null,
      agent: 'opencode',
    },
  ],
  tasks: [
    { id: 'builtin-restart-dsh', kind: 'restart', label: 'Restart DSH Web', builtin: true, command: 'restart-dsh' },
    { id: '111122223333', kind: 'command', label: 'Rebuild the site', command: 'npm run build', cwd: '/tmp/site' },
  ],
  builtins: { available: ['restart-dsh'], removed: [] },
}

function createFetch(calls) {
  return async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined })
    const body = url.startsWith('/__outlive/state')
      ? STATE
      : url.startsWith('/__outlive/log')
        ? { log: 'line one\nline two' }
        : url.startsWith('/__outlive/preview')
          ? { command: 'systemctl --user restart dsh-web.service', mode: 'unit', unit: 'dsh-web.service', ports: [13080], host: '127.0.0.1' }
          : url.startsWith('/__outlive/fs')
            ? { path: '/usr/local/bin', entries: [{ name: 'opencode', path: '/usr/local/bin/opencode', dir: false, executable: true }], places: [{ label: 'Home', path: '/home/dev' }] }
            : {}
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }
}

async function settle() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

// A tiny renderer: function components are mounted by position so their hooks keep
// state across the passes a state update triggers, and effects run after each pass.
function createRenderer(React) {
  const instances = new Map()
  const flags = React.__flags()
  return async function mount(root) {
    const out = { text: [], names: new Set(), dirty: false }
    for (let pass = 0; pass < 8; pass += 1) {
      flags.dirty = false
      out.text = []
      out.names = new Set()
      const pending = []
      const visit = (node, path) => {
        if (node === null || node === undefined || node === false || node === true) return
        if (typeof node === 'string' || typeof node === 'number') {
          out.text.push(String(node))
          return
        }
        if (Array.isArray(node)) {
          node.forEach((child, index) => visit(child, `${path}[${index}]`))
          return
        }
        if (typeof node !== 'object') return
        const { type, props, children } = node
        if (type === 'style') return
        if (typeof type === 'function') {
          const key = `${path}#${type.name || 'anon'}`
          if (!instances.has(key)) instances.set(key, { cells: [] })
          const instance = instances.get(key)
          const hooks = React.__begin()
          hooks.cells = instance.cells
          const rendered = type(props)
          instance.cells = hooks.cells
          for (const effect of hooks.effects) if (typeof effect === 'function') pending.push(effect)
          visit(rendered, `${path}>${type.name || 'anon'}`)
          return
        }
        out.names.add(String(type))
        if (props && typeof props === 'object') {
          for (const [key, value] of Object.entries(props)) {
            if (key === 'children') continue
            if (typeof value === 'string') out.text.push(value)
          }
        }
        children.forEach((child, index) => visit(child, `${path}/${index}`))
      }
      visit(root, 'root')
      for (const effect of pending) effect()
      await settle()
      if (!flags.dirty) break
    }
    return { out }
  }
}

const KEY_LIKE = /^[a-z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)+$/

test('client bundle registers the panel, the sidebar entry and the trigger source', async () => {
  const React = createReact()
  const definition = createLoader(React)
  assert.equal(definition.id, '@whiplashf/dsh-outlive')
  assert.deepEqual(definition.factory.length >= 1, true)

  const locales = []
  const slots = []
  const effects = []
  const sources = []
  const module = definition.factory((id) => {
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })
  const ctx = {
    locale: {
      register: (ns, dicts) => {
        locales.push({ ns, dicts })
        return () => {}
      },
      bind: (ns) => (key, vars) => {
        const active = ctx.locale.getSnapshot().active
        const text = (active === 'zh' ? locales[0].dicts.zh : locales[0].dicts.en)[key]
        if (text === undefined) return key
        return vars ? text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : text
      },
      getSnapshot: () => ({ active: 'en' }),
    },
    slots: {
      inject: (name, fn) => fn(),
      register: (spec, component) => slots.push({ spec, component }),
    },
    get: (name) =>
      name === 'inputTriggers'
        ? {
            registerSource: (spec) => {
              sources.push(spec)
              return () => {}
            },
          }
        : undefined,
    inject: () => {},
    effect: (fn) => {
      const disposer = fn()
      effects.push(typeof disposer === 'function' ? disposer : () => {})
    },
  }
  module.apply(ctx)

  assert.equal(locales.length, 1)
  const en = locales[0].dicts.en
  const zh = locales[0].dicts.zh
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en and zh must define the same keys')
  assert.ok(en['panel.title'] && zh['panel.title'])

  const main = slots.find((entry) => entry.spec.name === 'main')
  assert.ok(main, 'the main slot must be registered')
  assert.equal(main.spec.locale, '@whiplashf/dsh-outlive')
  const sidebar = slots.find((entry) => entry.spec.name === 'sidebar.panellist')
  assert.ok(sidebar, 'the sidebar entry must be registered')
  assert.equal(sidebar.spec.id, 'outlive-panel')
  assert.equal(sources.length, 1)
  assert.equal(sources[0].trigger, '/')

  const fetched = []
  globalThis.fetch = createFetch(fetched)
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  try {
    const mount = createRenderer(React)
    const { out } = await mount(React.createElement(main.component, { t: ctx.locale.bind('@whiplashf/dsh-outlive') }))

    const flat = out.text.join('\n')
    assert.match(flat, /Outlive/)
    assert.match(flat, /Restart DSH Web/)
    assert.match(flat, /Refactor the runner/)
    assert.match(flat, /Rebuild the site/)
    assert.match(flat, /1 running/)
    assert.match(flat, /Unit mode/, 'the restart card shows the detected plan')
    assert.match(flat, /Gemini CLI/, 'the agents card lists detected agents')
    assert.match(flat, /Needs arguments|需补参数/, 'an agent without arguments is flagged')
    const leaked = out.text.filter((text) => KEY_LIKE.test(text) && !/^(https?|usr|home|tmp|__outlive)/.test(text))
    assert.deepEqual(leaked, [], `unresolved locale keys: ${leaked.join(', ')}`)
    assert.ok(fetched.some((call) => call.url === '/__outlive/state'), 'the panel loads its snapshot')
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
    delete globalThis.fetch
  }
})
