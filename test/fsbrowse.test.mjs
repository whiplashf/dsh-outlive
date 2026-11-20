import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browse, places } from '../lib/fsbrowse.js'

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'outlive-fs-'))
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'plain.txt'), 'hello')
  writeFileSync(join(root, '.hidden'), 'x')
  writeFileSync(join(root, 'tool.sh'), '#!/bin/sh\n')
  chmodSync(join(root, 'tool.sh'), 0o755)
  return root
}

test('browse lists directories first and hides dot files by default', () => {
  const root = tree()
  const result = browse({ path: root })
  assert.equal(result.error, undefined)
  assert.equal(result.path, root)
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ['sub', 'plain.txt', 'tool.sh'],
  )
  assert.equal(result.entries[0].dir, true)
  assert.equal(result.entries.find((entry) => entry.name === 'tool.sh').executable, true)
  assert.ok(result.places.some((place) => place.path === root) === false)
  assert.ok(result.places.some((place) => place.label === 'Filesystem root'))
})

test('browse can show hidden entries, restrict to executables, and report truncation', () => {
  const root = tree()
  const hidden = browse({ path: root, showHidden: true })
  assert.ok(hidden.entries.some((entry) => entry.name === '.hidden'))
  const executables = browse({ path: root, executablesOnly: true })
  assert.deepEqual(executables.entries.map((entry) => entry.name), ['sub', 'tool.sh'])
  const limited = browse({ path: root, limit: 1 })
  assert.equal(limited.entries.length, 1)
  assert.equal(limited.truncated, true)
})

test('browse rejects relative and non-directory paths', () => {
  const root = tree()
  assert.equal(browse({ path: 'relative/dir' }).error, 'invalidPath')
  assert.equal(browse({ path: join(root, 'nope') }).error, 'notFound')
  assert.equal(browse({ path: join(root, 'plain.txt') }).error, 'notDirectory')
})

test('places always starts at home and ends at the filesystem root', () => {
  const list = places()
  assert.ok(list.length >= 2)
  assert.equal(list[0].label, 'Home')
  assert.equal(list.at(-1).path, '/')
})
