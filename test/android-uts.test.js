import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, write } from '../test-support/cli-fixture.js'
import { syncAndroidPlugins } from '../src/android-uts.js'

test('multiple plugins get official module layout and references; removal preserves custom modules and files', t => {
  const f = fixture(t, 'android')
  write(path.join(f.app, 'settings.gradle'), "include ':app', ':manual'\n")
  const plugins = new Map()
  for (const id of ['uts-one', 'uts-two']) {
    const source = path.join(f.root, id)
    write(path.join(source, 'src/index.kt'), 'package uts.sdk.modules.example')
    write(path.join(source, 'assets/info.txt'), id)
    write(path.join(source, 'res/values/strings.xml'), '<resources />')
    write(path.join(source, 'libs/test.aar'), 'sdk')
    write(path.join(source, 'AndroidManifest.xml'), '<manifest package="com.example.plugin"><uses-permission android:name="permission" /></manifest>')
    write(path.join(source, 'config.json'), JSON.stringify({ minSdkVersion: 26, dependencies: ['example:lib:1'], abis: ['arm64-v8a'] }))
    plugins.set(id, source)
  }
  syncAndroidPlugins(plugins, f.app)
  const first = fs.readFileSync(path.join(f.app, 'settings.gradle'), 'utf8')
  write(path.join(f.app, 'UTSPlugins/uts-one/src/main/java/Manual.kt'), 'manual')
  fs.appendFileSync(path.join(f.app, 'UTSPlugins/uts-one/build.gradle'), '// user customization\n')
  syncAndroidPlugins(plugins, f.app)
  assert.equal(fs.readFileSync(path.join(f.app, 'settings.gradle'), 'utf8'), first)
  for (const id of plugins.keys()) {
    assert.ok(first.includes(`include ':${id}'`))
    assert.ok(fs.readFileSync(path.join(f.app, 'app/build.gradle'), 'utf8').includes(`implementation project(':${id}')`))
    assert.equal(fs.readFileSync(path.join(f.app, 'UTSPlugins', id, 'src/main/assets/info.txt'), 'utf8'), id)
    assert.ok(fs.existsSync(path.join(f.app, 'UTSPlugins', id, 'libs/test.aar')))
    assert.doesNotMatch(fs.readFileSync(path.join(f.app, 'UTSPlugins', id, 'src/main/AndroidManifest.xml'), 'utf8'), /package=/)
    assert.match(fs.readFileSync(path.join(f.app, 'UTSPlugins', id, 'uapp-uts.gradle'), 'utf8'), /com.example.plugin/)
  }
  plugins.delete('uts-one')
  syncAndroidPlugins(plugins, f.app)
  assert.doesNotMatch(fs.readFileSync(path.join(f.app, 'settings.gradle'), 'utf8'), /:uts-one/)
  assert.doesNotMatch(fs.readFileSync(path.join(f.app, 'app/build.gradle'), 'utf8'), /uts-one/)
  assert.equal(fs.readFileSync(path.join(f.app, 'UTSPlugins/uts-one/src/main/java/Manual.kt'), 'utf8'), 'manual')
  assert.equal(fs.existsSync(path.join(f.app, 'UTSPlugins/uts-one/src/main/java/index.kt')), false)
  assert.match(fs.readFileSync(path.join(f.app, 'UTSPlugins/uts-one/build.gradle'), 'utf8'), /user customization/)
  assert.match(fs.readFileSync(path.join(f.app, 'settings.gradle'), 'utf8'), /:manual/)
  syncAndroidPlugins(new Map(), f.app)
  assert.doesNotMatch(fs.readFileSync(path.join(f.app, 'settings.gradle'), 'utf8'), /BEGIN UAPP/)
})

test('manual source collision fails without overwriting any plugin', t => {
  const f = fixture(t, 'android')
  const source = path.join(f.root, 'plugin')
  write(path.join(source, 'src/index.kt'), 'generated')
  write(path.join(f.app, 'UTSPlugins/uts-demo/src/main/java/index.kt'), 'manual')
  assert.throws(() => syncAndroidPlugins(new Map([['uts-demo', source]]), f.app), /手工文件/)
  assert.equal(fs.readFileSync(path.join(f.app, 'UTSPlugins/uts-demo/src/main/java/index.kt'), 'utf8'), 'manual')
})

for (const version of ['8.12.3', '9.1.1']) {
  test(`generated Kotlin plugin setup matches AGP ${version}`, t => {
    const f = fixture(t, 'android')
    write(path.join(f.app, 'build.gradle'), `plugins { id 'com.android.application' version '${version}' apply false }`)
    const source = path.join(f.root, 'uts-demo')
    write(path.join(source, 'src/index.kt'), 'package example')
    syncAndroidPlugins(new Map([['uts-demo', source]]), f.app)
    const build = fs.readFileSync(path.join(f.app, 'UTSPlugins/uts-demo/build.gradle'), 'utf8')
    assert.equal(build.includes("id 'org.jetbrains.kotlin.android'"), version.startsWith('8.'))
    const generated = fs.readFileSync(path.join(f.app, 'UTSPlugins/uts-demo/uapp-uts.gradle'), 'utf8')
    assert.equal(generated.includes('compilerOptions'), version.startsWith('8.'))
    assert.doesNotMatch(generated, /kotlinOptions|compileSdkVersion|minSdkVersion/)
  })
}

test('legacy modules move with custom files and Gradle mappings remain stable', t => {
  const f = fixture(t, 'android')
  const source = path.join(f.root, 'plugin')
  write(path.join(source, 'src/index.kt'), 'generated')
  write(path.join(f.app, '.uapp/uts-android.json'), JSON.stringify({ 'uts-demo': ['src/main/java/index.kt'] }))
  write(path.join(f.app, 'uts-demo/src/main/java/index.kt'), 'old')
  write(path.join(f.app, 'uts-demo/src/main/java/Manual.kt'), 'manual')
  write(path.join(f.app, 'uts-demo/build.gradle'), '// custom config\n')
  const plugins = new Map([['uts-demo', source]])
  syncAndroidPlugins(plugins, f.app)
  syncAndroidPlugins(plugins, f.app)
  assert.equal(fs.existsSync(path.join(f.app, 'uts-demo')), false)
  assert.equal(fs.existsSync(path.join(f.app, '.uapp/uts-android.json')), false)
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.app, 'UTSPlugins/uts-android.json'), 'utf8'))['uts-demo'].includes('src/main/java/index.kt'))
  assert.equal(fs.readFileSync(path.join(f.app, 'UTSPlugins/uts-demo/src/main/java/Manual.kt'), 'utf8'), 'manual')
  assert.match(fs.readFileSync(path.join(f.app, 'UTSPlugins/uts-demo/build.gradle'), 'utf8'), /custom config/)
  assert.ok(fs.readFileSync(path.join(f.app, 'settings.gradle'), 'utf8').includes("project(':uts-demo').projectDir = file('UTSPlugins/uts-demo')"))
  assert.ok(fs.readFileSync(path.join(f.app, 'app/build.gradle'), 'utf8').includes("rootProject.file('UTSPlugins/uts-demo/libs')"))
})
