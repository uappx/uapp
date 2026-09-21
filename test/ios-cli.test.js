import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fixture, write, executable, assertSuccess, assertFailure } from '../test-support/cli-fixture.js'

// Run the actual CLI, with native build tools replaced by fixture executables.
for (const podMode of [false, true]) {
  test(`CLI selects ${podMode ? 'CocoaPods' : 'legacy XcodeGen'} from config-file presence`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uapp-cli-ios-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const app = path.join(root, 'app')
    const bin = path.join(root, 'bin')
    fs.mkdirSync(path.join(app, 'Main'), { recursive: true })
    fs.mkdirSync(path.join(app, 'config'))
    fs.mkdirSync(path.join(app, 'Legacy.xcodeproj'))
    fs.mkdirSync(path.join(root, '.uappsdk/templates'), { recursive: true })
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(root, '.uappsdk/templates/manifest.json'), '{}')
    fs.writeFileSync(path.join(app, 'Main/AppDelegate.m'), '')
    fs.writeFileSync(path.join(app, 'manifest.json'), JSON.stringify({ appid: '__UNI__TEST', name: 'test', vueVersion: 3, versionName: '1.0.0', versionCode: 1, uapp: { package: 'com.example.test' } }))
    const exportOptions = podMode ? 'Main/Resources/export.plist' : 'config/export.plist'
    write(path.join(app, exportOptions), '')
    if (podMode) {
      fs.writeFileSync(path.join(app, 'uniapp_config.rb'), '# config marker')
      fs.writeFileSync(path.join(app, 'Podfile'), '')
      // Deliberately no project.yml in Pod mode.
    } else {
      fs.writeFileSync(path.join(app, 'project.yml'), 'name: Legacy\n')
    }
    const trace = path.join(root, 'trace.jsonl')
    for (const command of ['ruby', 'pod', 'xcodegen', 'xcodebuild']) {
      fs.writeFileSync(path.join(bin, command), `#!${process.execPath}\n
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({command: ${JSON.stringify(command)}, args}) + '\\n');
if (${JSON.stringify(command)} === 'ruby') process.stdout.write(JSON.stringify({project:'Legacy.xcodeproj',workspace:'Legacy.xcworkspace'}));
if (${JSON.stringify(command)} === 'pod') fs.mkdirSync('Legacy.xcworkspace', {recursive:true});
if (args.includes('-exportArchive')) { fs.mkdirSync('out', {recursive:true}); fs.writeFileSync('out/HBuilder.ipa', 'fixture'); }
`, { mode: 0o755 })
    }
    const bootstrap = path.join(root, 'bootstrap.mjs')
    fs.writeFileSync(bootstrap, `import os from 'node:os'; os.homedir = () => ${JSON.stringify(root)};`)
    const entry = fileURLToPath(new URL('../bin/uapp', import.meta.url))
    execFileSync(process.execPath, ['--import', bootstrap, entry, 'run', 'build:app', '--no-prepare', '--no-copy'], {
      cwd: app,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_UPDATE_NOTIFIER: '1', CI: '1' },
      encoding: 'utf8'
    })
    const calls = fs.readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(calls.map(c => c.command), podMode ? ['ruby', 'pod', 'xcodebuild', 'xcodebuild'] : ['xcodegen', 'xcodebuild', 'xcodebuild'])
    const archive = calls.find(c => c.command === 'xcodebuild')
    assert.equal(archive.args[0], podMode ? '-workspace' : '-project')
    const exported = calls.find(c => c.args.includes('-exportArchive'))
    assert.equal(exported.args[exported.args.indexOf('-exportOptionsPlist') + 1], exportOptions)
    assert.ok(fs.existsSync(path.join(app, 'out/HBuilder.ipa')))
  })
}

for (const failure of ['xcodegen', 'missing-ipa']) {
  test(`legacy iOS ${failure} failure preserves the previous base`, t => {
    const f = fixture(t, 'ios')
    write(path.join(f.app, 'project.yml'), 'name: Example\n')
    executable(path.join(f.bin, 'xcodegen'), f.record + (failure === 'xcodegen' ? '\nprocess.exit(7)' : ''))
    executable(path.join(f.bin, 'xcodebuild'), f.record)
    const previous = path.join(f.app, 'unpackage/debug/ios_debug.ipa')
    write(previous, 'previous base')
    assertFailure(f.run(['run', 'build:app', '--no-prepare']), failure === 'xcodegen' ? /xcodegen/ : /构建产物/)
    assert.equal(f.calls().length, failure === 'xcodegen' ? 1 : 3)
    assert.equal(fs.readFileSync(previous, 'utf8'), 'previous base')
  })
}

test('CocoaPods CLI publishes the configured IPA instead of the legacy default', t => {
  const f = fixture(t, 'ios')
  const config = { project: 'Example.xcodeproj', workspace: 'Example.xcworkspace', export_path: 'custom output', ipa_name: 'Custom App.ipa' }
  fs.mkdirSync(path.join(f.app, config.project))
  write(path.join(f.app, 'uniapp_config.rb'), '# config marker')
  write(path.join(f.app, 'Podfile'), '')
  write(path.join(f.app, 'Main/Resources/export.plist'), '')
  write(path.join(f.app, 'out/HBuilder.ipa'), 'stale legacy artifact')
  executable(path.join(f.bin, 'ruby'), f.record + `\nprocess.stdout.write(${JSON.stringify(JSON.stringify(config))})`)
  executable(path.join(f.bin, 'pod'), f.record + `\nfs.mkdirSync(${JSON.stringify(config.workspace)})`)
  executable(path.join(f.bin, 'xcodebuild'), f.record + `\nif (process.argv.includes('-exportArchive')) { fs.mkdirSync('custom output'); fs.writeFileSync('custom output/Custom App.ipa', 'configured artifact'); }`)
  assertSuccess(f.run(['run', 'build:app', '--no-prepare']))
  assert.equal(fs.readFileSync(path.join(f.app, 'unpackage/debug/ios_debug.ipa'), 'utf8'), 'configured artifact')
  assert.equal(f.calls().length, 4)
})

test('CocoaPods prepare applies platform metadata and preserves user Ruby configuration', t => {
  const f = fixture(t, 'ios', { uapp: { package: 'com.common.app', versionName: '2.0.0', 'ios.package': 'com.ios.app', 'ios.versionName': '3.0.0@dev', 'ios.versionCode': 300, 'ios.appkey': 'ios-key' } })
  const config = path.join(f.app, 'uniapp_config.rb')
  const original = "UAPP_BUILD_CONFIG = { scheme: 'My Scheme' }\nUNIAPP_PLIST_VALUES = { custom: 'keep' }\n"
  write(config, original)
  write(path.join(f.app, 'unpackage/resources/__UNI__TEST/www/index.html'), 'app')
  assertSuccess(f.run(['prepare', 'build:app', '--no-webapp']))
  const metadata = JSON.parse(execFileSync('ruby', ['-rjson', '-e', 'load ARGV[0]; puts JSON.generate(UAPP_APP_CONFIG)', config], { encoding: 'utf8' }))
  assert.equal(metadata.bundle_id, 'com.ios.app')
  assert.equal(metadata.version_name, '3.0.0')
  assert.equal(metadata.version_code, '300')
  assert.equal(metadata.appkey, 'ios-key')
  assert.ok(fs.readFileSync(config, 'utf8').endsWith(original))
  assert.equal(fs.readFileSync(path.join(f.app, 'Main/Pandora/apps/__UNI__TEST/www/index.html'), 'utf8'), 'app')
})
