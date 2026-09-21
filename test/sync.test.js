import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import sync from '../src/sync.js'
import { write } from '../test-support/cli-fixture.js'

function directories(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uapp-sync-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { source: path.join(root, 'source'), target: path.join(root, 'target') }
}

for (const remove of [false, true]) {
  test(`sync mirrors nested files with delete=${remove}`, t => {
    const { source, target } = directories(t)
    write(path.join(source, 'nested/file'), 'new content')
    write(path.join(target, 'extra/file'), 'extra')
    write(path.join(target, 'nested/file'), 'old')
    sync(source, target, { delete: remove })
    assert.equal(fs.readFileSync(path.join(target, 'nested/file'), 'utf8'), 'new content')
    assert.equal(fs.existsSync(path.join(target, 'extra/file')), !remove)
    assert.equal(fs.readFileSync(path.join(source, 'nested/file'), 'utf8'), 'new content')
  })
}

test('sync copies newer same-size files and changed-size files, but leaves unchanged files alone', t => {
  const { source, target } = directories(t)
  for (const name of ['newer', 'different-size', 'unchanged']) {
    write(path.join(source, name), name === 'different-size' ? 'longer' : 'new')
    write(path.join(target, name), name === 'unchanged' ? 'new' : 'old')
    fs.utimesSync(path.join(source, name), 1000, name === 'newer' ? 3000 : 1000)
    fs.utimesSync(path.join(target, name), 2000, 2000)
  }
  sync(source, target)
  assert.equal(fs.readFileSync(path.join(target, 'newer'), 'utf8'), 'new')
  assert.equal(fs.readFileSync(path.join(target, 'different-size'), 'utf8'), 'longer')
  assert.equal(fs.statSync(path.join(target, 'unchanged')).mtimeMs, 2000000)
})

for (const sourceIsDirectory of [false, true]) {
  for (const remove of [false, true]) {
    test(`sync ${sourceIsDirectory ? 'directory to file' : 'file to directory'} with delete=${remove}`, t => {
      const { source, target } = directories(t)
      write(sourceIsDirectory ? path.join(source, 'file') : source, 'source content')
      write(sourceIsDirectory ? target : path.join(target, 'file'), 'target content')
      // The public sync API exits on errors; use a child so tests cannot be terminated.
      const module = new URL('../src/sync.js', import.meta.url).href
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import sync from ${JSON.stringify(module)}; sync(${JSON.stringify(source)}, ${JSON.stringify(target)}, {delete:${remove}})`], { encoding: 'utf8', timeout: 5000 })
      assert.ifError(result.error)
      assert.equal(result.status, remove ? 0 : 2, result.stderr)
      if (remove) assert.equal(fs.readFileSync(sourceIsDirectory ? path.join(target, 'file') : target, 'utf8'), 'source content')
      else assert.equal(fs.readFileSync(sourceIsDirectory ? target : path.join(target, 'file'), 'utf8'), 'target content')
    })
  }
}

test('sync missing-source deletion remains opt-in', t => {
  const { source, target } = directories(t)
  write(target, 'keep')
  sync(source, target, { delete: false })
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep')
  sync(source, target, { delete: true })
  assert.equal(fs.existsSync(target), false)
})
