import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, write, assertSuccess } from '../test-support/cli-fixture.js'
import { removeEmptyModuleDirectories, syncNativePlugins } from '../src/app-resources.js'

for (const platform of ['ios']) {
  test(`UTS ${platform} sync replaces managed sources, preserves manual plugins and removes stale plugins`, t => {
    const f = fixture(t, platform)
    const compiled = path.join(f.app, 'unpackage/resources/__UNI__TEST/www')
    const nested = path.join(compiled, 'uni_modules/demo/utssdk')
    const target = path.join(f.app, 'UTSPlugins/demo', `app-${platform}`)
    for (const os of ['android', 'ios']) write(path.join(nested, `app-${os}/src/index`), os)
    write(path.join(f.app, 'UTSPlugins/manual', `app-${platform}/src/index`), 'manual')
    syncNativePlugins(compiled, f.app, platform)
    assert.equal(fs.readFileSync(path.join(target, 'src/index'), 'utf8'), platform)
    assert.equal(fs.existsSync(path.join(f.app, 'UTSPlugins/demo', platform === 'ios' ? 'app-android' : 'app-ios')), false)
    write(path.join(target, 'src/stale'), 'old')
    syncNativePlugins(compiled, f.app, platform)
    assert.equal(fs.existsSync(path.join(target, 'src/stale')), false)
    fs.rmSync(nested, { recursive: true })
    syncNativePlugins(compiled, f.app, platform)
    assert.equal(fs.existsSync(target), false)
    assert.equal(fs.readFileSync(path.join(f.app, 'UTSPlugins/manual', `app-${platform}/src/index`), 'utf8'), 'manual')
  })
}

test('prepare separates CLI and official native exports while keeping web assets and compiler output intact', t => {
  const f = fixture(t, 'android')
  const compiled = path.join(f.app, 'unpackage/resources/__UNI__TEST/www')
  write(path.join(compiled, 'app-service.js'), 'web')
  write(path.join(compiled, 'uni_modules/demo/static/icon.png'), 'image')
  write(path.join(compiled, 'uni_modules/demo/utssdk/app-android/src/index.kt'), 'android')
  write(path.join(compiled, 'uni_modules/demo/utssdk/app-ios/src/index.swift'), 'ios')
  write(path.join(compiled, 'uni_modules/flat/app-android/src/index.kt'), 'flat')
  write(path.join(f.app, 'unpackage/resources/uni_modules/official/app-android/src/index.kt'), 'official')
  assertSuccess(f.run(['prepare', 'build:app', '--no-webapp']))
  const web = path.join(f.app, 'app/src/main/assets/apps/__UNI__TEST/www')
  assert.equal(fs.readFileSync(path.join(web, 'app-service.js'), 'utf8'), 'web')
  assert.equal(fs.readFileSync(path.join(web, 'uni_modules/demo/static/icon.png'), 'utf8'), 'image')
  assert.equal(fs.existsSync(path.join(web, 'uni_modules/demo/utssdk')), false)
  assert.equal(fs.existsSync(path.join(web, 'uni_modules/flat')), false)
  for (const [id, value] of [['demo', 'android'], ['flat', 'flat'], ['official', 'official']]) {
    assert.equal(fs.readFileSync(path.join(f.app, 'UTSPlugins', id, 'src/main/java/index.kt'), 'utf8'), value)
  }
  assert.equal(fs.readFileSync(path.join(compiled, 'uni_modules/demo/utssdk/app-ios/src/index.swift'), 'utf8'), 'ios')
})

test('empty module directories are removed without touching web files', t => {
  const f = fixture(t, 'android')
  const modules = path.join(f.app, 'www/uni_modules')
  fs.mkdirSync(path.join(modules, 'native/static/empty'), { recursive: true })
  write(path.join(modules, 'web/static/icon.png'), 'image')
  removeEmptyModuleDirectories(modules)
  assert.equal(fs.existsSync(path.join(modules, 'native')), false)
  assert.equal(fs.readFileSync(path.join(modules, 'web/static/icon.png'), 'utf8'), 'image')
  fs.unlinkSync(path.join(modules, 'web/static/icon.png'))
  removeEmptyModuleDirectories(modules)
  assert.equal(fs.existsSync(modules), false)
  removeEmptyModuleDirectories(modules)
})
