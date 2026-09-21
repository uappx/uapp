import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { hasIOSPodConfig, updateIOSPodConfig, readIOSPodBuildConfig, buildIOSWithPods } from '../src/ios-pods.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uapp-ios-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'Example App.xcodeproj'))
  fs.mkdirSync(path.join(root, 'config'))
  fs.mkdirSync(path.join(root, 'Main/Resources'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Main/Resources/export.plist'), '')
  fs.writeFileSync(path.join(root, 'Podfile'), '')
  return root
}

test('metadata round-trips Ruby metacharacters and preserves editable build/module settings', t => {
  const root = fixture(t)
  const original = "UAPP_BUILD_CONFIG = { project: 'Example App.xcodeproj' }\nUNIAPP_PLIST_VALUES = {}\n"
  fs.writeFileSync(path.join(root, 'uniapp_config.rb'), original)
  fs.mkdirSync(path.join(root, 'SDKs/SDK'), { recursive: true })
  fs.writeFileSync(path.join(root, 'SDKs/SDK/control.xml'), '<HBuilder debug="true" version="1.9.9.99">')
  const manifest = {
    appid: '__UNI__EXAMPLE',
    uapp: { package: 'com.example.app', name: '中文 "名字" \' \\ #{raise "injected"}\n# END UAPP_APP_CONFIG\n第二行', versionName: '2.4.0@dev', versionCode: 240001, appkey: 'key&<value>' },
    'app-plus': { distribute: { sdkConfigs: { oauth: { weixin: { appid: 'wx123', appsecret: 'secret\'\\#{1+1}', UniversalLinks: 'https://example.test/a?b=1&c=2' } } } } }
  }
  updateIOSPodConfig(root, manifest, root)
  const file = path.join(root, 'uniapp_config.rb')
  const read = () => JSON.parse(execFileSync('ruby', ['-rjson', '-e', 'load ARGV[0]; puts JSON.generate(UAPP_APP_CONFIG)', file], { encoding: 'utf8' }))
  const metadata = read()
  assert.equal(metadata.app_name, manifest.uapp.name)
  assert.equal(metadata.wechat_appsecret, manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appsecret)
  assert.equal(metadata.version_name, '2.4.0')
  assert.equal(metadata.version_code, '240001')
  assert.equal(metadata.sdk_version, '1.9.9.99')
  assert.ok(fs.readFileSync(file, 'utf8').endsWith(original))
  const first = fs.readFileSync(file, 'utf8')
  updateIOSPodConfig(root, manifest, root)
  assert.equal(fs.readFileSync(file, 'utf8'), first)
  manifest.uapp.name = '已更新'
  updateIOSPodConfig(root, manifest, root)
  assert.equal(read().app_name, '已更新')
  assert.equal((fs.readFileSync(file, 'utf8').match(/^UAPP_APP_CONFIG =/gm) || []).length, 1)
})

test('missing config selects legacy mode; malformed managed blocks are not overwritten', t => {
  const root = fixture(t)
  assert.equal(hasIOSPodConfig(root), false)
  const file = path.join(root, 'uniapp_config.rb')
  const invalid = '# BEGIN UAPP_APP_CONFIG (managed by uapp prepare)\nuser_custom_setting = true\n'
  fs.writeFileSync(file, invalid)
  assert.equal(hasIOSPodConfig(root), true)
  assert.throws(() => updateIOSPodConfig(root, {}, root), /管理标记/)
  assert.equal(fs.readFileSync(file, 'utf8'), invalid)
})

test('Pod build uses configured workspace, scheme and export paths as literal arguments', t => {
  const root = fixture(t)
  const config = { project: 'Example App.xcodeproj', workspace: 'Example App.xcworkspace', scheme: 'Custom Scheme', archive_path: 'out/My Archive.xcarchive', export_path: 'out/My Export', export_options: 'config/export.plist', ipa_name: 'My App.ipa' }
  fs.writeFileSync(path.join(root, config.export_options), '')
  const calls = []
  const run = (command, args, options) => {
    calls.push({ command, args, options })
    if (command === 'ruby') return JSON.stringify(config)
    if (command === 'pod') fs.mkdirSync(path.join(root, config.workspace))
    if (args.includes('-exportArchive')) {
      fs.mkdirSync(path.join(root, config.export_path), { recursive: true })
      fs.writeFileSync(path.join(root, config.export_path, config.ipa_name), 'ipa')
    }
  }
  assert.equal(buildIOSWithPods(root, { run }), path.join(root, config.export_path, config.ipa_name))
  assert.deepEqual(calls.map(c => c.command), ['ruby', 'pod', 'xcodebuild', 'xcodebuild'])
  assert.deepEqual(calls[1].args, ['install', '--no-repo-update'])
  assert.deepEqual(calls[2].args, ['-workspace', config.workspace, '-destination', 'generic/platform=iOS', '-scheme', config.scheme, '-archivePath', config.archive_path, 'archive'])
  assert.deepEqual(calls[3].args, ['-exportArchive', '-archivePath', config.archive_path, '-exportPath', config.export_path, '-exportOptionsPlist', config.export_options])
  assert.ok(calls.every(c => c.options.cwd === root))
})

test('Pod failure aborts before archive/export and does not fall back to XcodeGen', t => {
  const root = fixture(t)
  const calls = []
  assert.throws(() => buildIOSWithPods(root, { run(command) {
    calls.push(command)
    if (command === 'ruby') return '{}'
    throw new Error('pod failed')
  } }), /pod failed/)
  assert.deepEqual(calls, ['ruby', 'pod'])
})

test('auto-detection requires a single host project and validates missing inputs early', t => {
  const root = fixture(t)
  const config = readIOSPodBuildConfig(root, { run: () => '{}' })
  assert.equal(config.workspace, 'Example App.xcworkspace')
  assert.equal(config.export_options, 'Main/Resources/export.plist')
  assert.throws(() => readIOSPodBuildConfig(root, { run: () => 'null' }), /Ruby Hash/)
  fs.mkdirSync(path.join(root, 'Other.xcodeproj'))
  assert.throws(() => readIOSPodBuildConfig(root, { run: () => '{}' }), /指定 project/)
  assert.throws(() => readIOSPodBuildConfig(root, { run: () => JSON.stringify({ project: 'Missing.xcodeproj' }) }), /所需文件不存在/)
})

for (const stage of ['workspace', 'archive', 'export', 'ipa']) {
  test(`Pod build stops at ${stage} failure`, t => {
    const root = fixture(t)
    const calls = []
    assert.throws(() => buildIOSWithPods(root, { run(command, args) {
      calls.push(command === 'xcodebuild' ? args.includes('-exportArchive') ? 'export' : 'archive' : command)
      if (command === 'ruby') return '{}'
      if (command === 'pod' && stage !== 'workspace') fs.mkdirSync(path.join(root, 'Example App.xcworkspace'))
      if (command === 'xcodebuild' && calls.at(-1) === stage) throw new Error(`${stage} failed`)
    } }), stage === 'workspace' ? /workspace/ : stage === 'ipa' ? /IPA/ : new RegExp(`${stage} failed`))
    assert.deepEqual(calls, ['ruby', 'pod', ...(stage === 'workspace' ? [] : ['archive']), ...(['export', 'ipa'].includes(stage) ? ['export'] : [])])
  })
}

for (const invalid of [
  '# END UAPP_APP_CONFIG\n',
  '# END UAPP_APP_CONFIG\n# BEGIN UAPP_APP_CONFIG (managed by uapp prepare)\n',
  '# BEGIN UAPP_APP_CONFIG (managed by uapp prepare)\n# BEGIN UAPP_APP_CONFIG (managed by uapp prepare)\n# END UAPP_APP_CONFIG\n',
  'UAPP_APP_CONFIG = { app_name: "user maintained" }\n'
]) {
  test(`invalid or unmanaged Ruby metadata is preserved: ${JSON.stringify(invalid)}`, t => {
    const root = fixture(t)
    const file = path.join(root, 'uniapp_config.rb')
    fs.writeFileSync(file, invalid)
    assert.throws(() => updateIOSPodConfig(root, {}, root), /管理标记/)
    assert.equal(fs.readFileSync(file, 'utf8'), invalid)
  })
}

test('Pod config validates all required inputs before invoking pod install', t => {
  for (const missing of ['Podfile', 'Example App.xcodeproj', 'Main/Resources/export.plist']) {
    const root = fixture(t)
    fs.rmSync(path.join(root, missing), { recursive: true })
    const calls = []
    assert.throws(() => buildIOSWithPods(root, { run(command) {
      calls.push(command)
      return JSON.stringify({ project: 'Example App.xcodeproj' })
    } }), /所需文件不存在/)
    assert.deepEqual(calls, ['ruby'])
  }
})

test('Pod metadata reads global SDK version when no local SDK exists and otherwise uses a safe default', t => {
  const root = fixture(t)
  const file = path.join(root, 'uniapp_config.rb')
  fs.writeFileSync(file, '# user settings\r\nUAPP_BUILD_CONFIG = {}\r\n')
  const read = () => JSON.parse(execFileSync('ruby', ['-rjson', '-e', 'load ARGV[0]; puts JSON.generate(UAPP_APP_CONFIG)', file], { encoding: 'utf8' }))
  updateIOSPodConfig(root, { name: 'Root name', versionName: '1.2.3@dev', versionCode: 0 }, root)
  assert.equal(read().sdk_version, '1.0.0')
  assert.equal(read().app_name, 'Root name')
  assert.equal(read().version_code, '0')
  fs.mkdirSync(path.join(root, 'ios/SDK'), { recursive: true })
  fs.writeFileSync(path.join(root, 'ios/SDK/control.xml'), "<HBuilder version='4.0.0' debug='true'>")
  updateIOSPodConfig(root, {}, root)
  assert.equal(read().sdk_version, '4.0.0')
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('# user settings\r\nUAPP_BUILD_CONFIG = {}\r\n'))
})
