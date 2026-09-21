import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, write, assertSuccess, assertFailure } from '../test-support/cli-fixture.js'

test('config set/get/list/delete work outside a project and create the SDK directory on first write', t => {
  const f = fixture(t)
  fs.rmSync(f.sdk, { recursive: true })
  const file = path.join(f.sdk, 'config.json')
  const run = args => f.run(['config', ...args], { cwd: f.root })
  const empty = run([])
  assertSuccess(empty)
  assert.deepEqual(JSON.parse(empty.stdout), {})
  assert.equal(fs.existsSync(f.sdk), false)
  assertSuccess(run(['set', 'hbx.dir', f.app]))
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { 'hbx.dir': f.app })
  const before = fs.readFileSync(file, 'utf8')
  const get = run(['get', 'hbx.dir'])
  assertSuccess(get)
  assert.equal(get.stdout, f.app + '\n')
  const list = run(['list'])
  assertSuccess(list)
  assert.deepEqual(JSON.parse(list.stdout), { 'hbx.dir': f.app })
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  assertSuccess(run(['delete', 'hbx.dir']))
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {})
  assertFailure(run(['get', 'hbx.dir']), /未配置 hbx.dir/)
  assertSuccess(run(['delete', 'hbx.dir']))
})

test('legacy config writes still work, but a key alone reads without deleting', t => {
  const f = fixture(t)
  assertSuccess(f.run(['config', 'node', process.execPath]))
  const get = f.run(['config', 'node'])
  assertSuccess(get)
  assert.equal(get.stdout, process.execPath + '\n')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.sdk, 'config.json'), 'utf8')), { node: process.execPath })
})

test('writes preserve other settings without persisting automatically detected defaults', t => {
  const f = fixture(t)
  f.config({ node: process.execPath, legacy: 'preserve' })
  assertSuccess(f.run(['config', 'set', 'hbx.dir', f.app]))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.sdk, 'config.json'), 'utf8')), { node: process.execPath, legacy: 'preserve', 'hbx.dir': f.app })
  assertSuccess(f.run(['config', 'delete', 'hbx.dir']))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.sdk, 'config.json'), 'utf8')), { node: process.execPath, legacy: 'preserve' })
})

test('get and delete of unset keys do not create a configuration file', t => {
  const f = fixture(t)
  assertFailure(f.run(['config', 'get', 'hbx.dir']), /未配置/)
  assertSuccess(f.run(['config', 'delete', 'hbx.dir']))
  assert.equal(fs.existsSync(path.join(f.sdk, 'config.json')), false)
})

for (const [key, value] of [
  ['hbx.dir', '../Tool App'],
  ['wx.dir', '~/Tool App'],
  ['node', '../Tool App/node']
]) {
  test(`config normalizes ${key} paths with spaces and validates their type`, t => {
    const f = fixture(t)
    write(path.join(f.root, 'Tool App/node'), '')
    assertSuccess(f.run(['config', 'set', key, value]))
    const expected = path.join(f.root, 'Tool App', key === 'node' ? 'node' : '')
    const get = f.run(['config', 'get', key])
    assertSuccess(get)
    assert.equal(get.stdout.trim(), expected)
  })
}

for (const args of [
  ['set'], ['set', 'node'], ['get'], ['delete'], ['list', 'extra'],
  ['get', 'node', 'extra'], ['delete', 'node', 'extra'], ['set', 'node', 'value', 'extra'],
  ['get', 'node', '--extra'], ['set', 'node', 'value', '--copy'],
  ['get', 'node', '--release', 'apk'], ['set', 'node=value'], ['node', 'value', 'extra'],
  ['unknown'], ['set', 'typo', 'value'], ['get', 'typo'], ['delete', 'typo'],
  ['set', '__proto__', 'value'], ['set', 'constructor', 'value'],
  ['set', 'node', ''], ['set', 'node', '   ']
]) {
  test(`invalid config arguments ${JSON.stringify(args)} fail without modifying the file`, t => {
    const f = fixture(t)
    f.config({ node: process.execPath })
    const file = path.join(f.sdk, 'config.json')
    const before = fs.readFileSync(file, 'utf8')
    assertFailure(f.run(['config', ...args]), /用法|未知配置项|不能为空/)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
  })
}

for (const key of ['adb.path', 'harmony.devTools.path', 'uniappx.kotlin.compiler.memory']) {
  test(`config rejects unsupported key ${key} for all operations without modifying saved settings`, t => {
    const f = fixture(t)
    f.config({ node: process.execPath })
    const file = path.join(f.sdk, 'config.json')
    const before = fs.readFileSync(file, 'utf8')
    for (const args of [['set', key, f.app], ['get', key], ['delete', key], [key, f.app]]) {
      assertFailure(f.run(['config', ...args]), /未知配置项|用法/)
      assert.equal(fs.readFileSync(file, 'utf8'), before)
    }
  })
}

for (const [key, target, message] of [
  ['hbx.dir', 'file', /必须指向目录/],
  ['node', 'directory', /必须指向文件/],
  ['wx.dir', 'missing', /路径不存在/]
]) {
  test(`config rejects ${target} for ${key} without writing`, t => {
    const f = fixture(t)
    const value = path.join(f.root, target)
    if (target === 'file') write(value, '')
    if (target === 'directory') fs.mkdirSync(value)
    assertFailure(f.run(['config', 'set', key, value]), message)
    assert.equal(fs.existsSync(path.join(f.sdk, 'config.json')), false)
  })
}

for (const content of ['{broken', 'null', '[]', '"string"', '1']) {
  test(`invalid configuration ${content} fails read and write without overwriting it`, t => {
    const f = fixture(t)
    const file = path.join(f.sdk, 'config.json')
    write(file, content)
    for (const args of [['list'], ['set', 'node', process.execPath]]) {
      assertFailure(f.run(['config', ...args]), /配置文件/)
      assert.equal(fs.readFileSync(file, 'utf8'), content)
    }
  })
}
