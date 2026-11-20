/**
 * Read-only filesystem listing for the agent and working-directory pickers.
 *
 * The route is exposed to an authenticated DSH user, so it lists what that
 * process can read and nothing more. It never writes, never follows a path
 * outside itself, and caps the number of entries so a large directory cannot
 * stall the panel.
 */
import { accessSync, constants, lstatSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { EXTRA_BIN_DIRS } from './agents.js'

export const LIST_LIMIT = 1000

export function places() {
  const seen = new Set()
  const out = []
  const add = (label, path) => {
    if (!path || seen.has(path)) return
    seen.add(path)
    out.push({ label, path })
  }
  add('Home', homedir())
  add('Workspace', process.cwd())
  for (const dir of EXTRA_BIN_DIRS.slice(0, 5)) add(basename(dir), dir)
  add('Filesystem root', '/')
  return out
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * @param query - `{ path, showHidden, executablesOnly, limit }`.
 * @returns a listing or `{ error, detail }`.
 */
export function browse(query = {}) {
  const requested = String(query.path || '').trim() || homedir()
  if (!isAbsolute(requested)) return { error: 'invalidPath', detail: 'path must be absolute' }
  const path = resolve(requested)
  const showHidden = query.showHidden === true || query.showHidden === '1'
  const executablesOnly = query.executablesOnly === true || query.executablesOnly === '1'
  const limit = Math.min(LIST_LIMIT, Math.max(1, Number(query.limit) || LIST_LIMIT))

  let stats
  try {
    stats = statSync(path)
  } catch (error) {
    return { error: error?.code === 'EACCES' ? 'denied' : 'notFound', detail: path }
  }
  if (!stats.isDirectory()) return { error: 'notDirectory', detail: path }

  let names
  try {
    names = readdirSync(path)
  } catch (error) {
    return { error: error?.code === 'EACCES' ? 'denied' : 'notFound', detail: path }
  }

  const entries = []
  for (const name of names) {
    if (!showHidden && name.startsWith('.')) continue
    const full = resolve(path, name)
    let link = false
    let dir = false
    let size = 0
    let mtime = null
    let executable = false
    try {
      link = lstatSync(full).isSymbolicLink()
      const target = statSync(full)
      dir = target.isDirectory()
      size = target.size
      mtime = target.mtime.toISOString()
      executable = !dir && isExecutable(full)
    } catch {
      // broken symlink or a race: list it, but mark it as a link only
      link = true
    }
    if (executablesOnly && !dir && !executable) continue
    entries.push({ name, path: full, dir, link, executable, size, mtime })
    if (entries.length >= limit) break
  }

  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  return {
    path,
    name: basename(path) || path,
    parent: path === '/' ? null : dirname(path),
    entries,
    truncated: entries.length >= limit,
    places: places(),
  }
}

export { isExecutable }
