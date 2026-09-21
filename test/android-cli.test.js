import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, write, executable, assertSuccess, assertFailure } from '../test-support/cli-fixture.js'

const outputs = { assembleDebug: 'apk/debug/app-debug.apk', assembleRelease: 'apk/release/app-release.apk', bundleRelease: 'bundle/release/app-release.aab' }

function gradle(f, body = '') {
  executable(path.join(f.app, 'gradlew'), f.record + '\n' + body)
}

for (const [release, task] of [[null, 'assembleDebug'], ['apk', 'assembleRelease'], ['aab', 'bundleRelease']]) {
  test(`Android ${release || 'debug'} builds the expected artifact and only debug publishes a base`, t => {
    const f = fixture(t, 'android')
    const destination = path.join(f.app, 'unpackage/debug/android_debug.apk')
    write(destination, 'previous base')
    gradle(f, `const file = path.join('app/build/outputs', ${JSON.stringify(outputs)}[process.argv[2]]); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, 'new artifact');`)
    assertSuccess(f.run(['run', 'build:app', '--no-prepare', ...(release ? ['-r', release] : [])]))
    assert.deepEqual(f.calls().map(call => call.args), [[task, '-s']])
    assert.equal(fs.readFileSync(path.join(f.app, 'app/build/outputs', outputs[task]), 'utf8'), 'new artifact')
    assert.equal(fs.readFileSync(destination, 'utf8'), release ? 'previous base' : 'new artifact')
  })
}

test('Android --no-copy preserves the installed debug base', t => {
  const f = fixture(t, 'android')
  const destination = path.join(f.app, 'unpackage/debug/android_debug.apk')
  write(destination, 'previous base')
  gradle(f, `fs.mkdirSync('app/build/outputs/apk/debug', {recursive:true}); fs.writeFileSync('app/build/outputs/apk/debug/app-debug.apk', 'new artifact');`)
  assertSuccess(f.run(['run', 'build:app', '--no-prepare', '--no-copy']))
  assert.equal(fs.readFileSync(destination, 'utf8'), 'previous base')
})

for (const mode of ['failed', 'missing', 'directory', 'missing-no-copy', 'missing-release']) {
  test(`Android ${mode} artifact does not report success or delete the previous base`, t => {
    const f = fixture(t, 'android')
    const destination = path.join(f.app, 'unpackage/debug/android_debug.apk')
    write(destination, 'previous base')
    if (mode === 'failed') write(path.join(f.app, 'app/build/outputs/apk/debug/app-debug.apk'), 'stale artifact')
    gradle(f, mode === 'failed' ? 'process.exit(7)' : mode === 'directory' ? "fs.mkdirSync('app/build/outputs/apk/debug/app-debug.apk', {recursive:true})" : '')
    const args = mode === 'missing-no-copy' ? ['--no-copy'] : mode === 'missing-release' ? ['-r', 'apk'] : []
    const result = f.run(['run', 'build:app', '--no-prepare', ...args])
    assertFailure(result)
    assert.doesNotMatch(result.stdout, /编译成功/)
    assert.equal(fs.readFileSync(destination, 'utf8'), 'previous base')
  })
}

for (const [name, overrides, version, code] of [
  ['root fallback', {}, '1.0.0', 100],
  ['common uapp overrides', { versionName: '2.0.0@dev', versionCode: 200 }, '2.0.0', 200],
  ['platform overrides common', { versionName: '2.0.0', versionCode: 200, 'android.versionName': '3.0.0@beta', 'android.versionCode': 300 }, '3.0.0', 300],
  ['explicit zero versionCode', { versionCode: 0 }, '1.0.0', 0]
]) {
  test(`prepare uses ${name}, replaces resources and is idempotent`, t => {
    const f = fixture(t, 'android', { uapp: { package: 'com.example.changed', ...overrides } })
    write(path.join(f.app, 'unpackage/resources/__UNI__TEST/www/nested/index.html'), 'new app')
    const embedded = path.join(f.app, 'app/src/main/assets/apps')
    write(path.join(embedded, 'old-app/www/stale.js'), 'stale')
    const args = ['prepare', 'build:app', '--no-webapp']
    assertSuccess(f.run(args))
    const gradleFile = path.join(f.app, 'app/build.gradle')
    const first = fs.readFileSync(gradleFile, 'utf8')
    assert.ok(first.includes(`versionName "${version}"`), first)
    assert.ok(first.includes(`versionCode ${code}\n`), first)
    assert.ok(first.includes('applicationId "com.example.changed"'))
    assert.equal(fs.existsSync(path.join(embedded, 'old-app')), false)
    assert.equal(fs.readFileSync(path.join(embedded, '__UNI__TEST/www/nested/index.html'), 'utf8'), 'new app')
    assert.match(fs.readFileSync(path.join(f.app, 'app/src/main/java/com/example/changed/wxapi/WXEntryActivity.java'), 'utf8'), /package com\.example\.changed\.wxapi;/)
    assertSuccess(f.run(args))
    assert.equal(fs.readFileSync(gradleFile, 'utf8'), first)
    assert.equal(fs.readFileSync(path.join(embedded, '__UNI__TEST/www/nested/index.html'), 'utf8'), 'new app')
  })
}

test('prepare with missing resources fails before changing metadata or embedded apps', t => {
  const f = fixture(t, 'android')
  const oldApp = path.join(f.app, 'app/src/main/assets/apps/old/www/index.html')
  write(oldApp, 'previous app')
  const gradleFile = path.join(f.app, 'app/build.gradle')
  const before = fs.readFileSync(gradleFile, 'utf8')
  assertFailure(f.run(['prepare', 'build:app', '--no-webapp']), /找不到本地App打包资源/)
  assert.equal(fs.readFileSync(oldApp, 'utf8'), 'previous app')
  assert.equal(fs.readFileSync(gradleFile, 'utf8'), before)
})
