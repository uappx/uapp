import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, write, assertSuccess, assertFailure } from '../test-support/cli-fixture.js'

function runtime(f, source = '') {
  const hbx = path.join(f.root, 'HBuilderX.app')
  const plugin = path.join(hbx, 'plugins/hbuilderx-for-uniapp-test')
  const lib = path.join(hbx, 'plugins/hbuilderx-for-uniapp-test-lib')
  const compiler = path.join(hbx, 'plugins/uniapp-cli-vite')
  write(path.join(plugin, 'src/template/env.js'), 'module.exports = {}')
  write(path.join(plugin, 'src/template/jest.config.js'), 'module.exports = {}')
  write(path.join(lib, 'node_modules/jest/bin/jest.js'), f.record + '\n' + source)
  write(path.join(lib, 'node_modules/babel-jest/index.js'), '')
  write(path.join(compiler, 'node_modules/@babel/plugin-transform-modules-commonjs/index.js'), '')
  for (const file of ['environment.js', 'teardown.js']) write(path.join(compiler, 'node_modules/@dcloudio/uni-automator/dist', file), '')
  write(path.join(hbx, 'plugins/about/package.json'), '{"version":"4.87.1"}')
  f.config({ 'hbx.dir': hbx, node: process.execPath, 'harmony.devTools.path': '/fixture/harmony' })
  return { hbx, plugin, lib, compiler }
}

for (const [name, platform, uniPlatform, browser, launcher] of [
  ['web-chrome', 'h5-chrome', 'h5', 'chromium'],
  ['web-firefox', 'h5-firefox', 'h5', 'firefox'],
  ['web-safari', 'h5-safari', 'h5', 'webkit'],
  ['mp-weixin', 'mp-weixin', 'mp-weixin'],
  ['app-android', 'android', 'app-plus', null, 'android_base.apk'],
  ['app-ios-simulator', 'ios', 'app-plus', null, 'Pandora_simulator.app'],
  ['app-ios', 'ios', 'app-plus', null, 'iPhone_base.ipa'],
  ['app-harmony', 'harmony', 'app-harmony', null, '/fixture/harmony']
]) {
  test(`run test:${name} selects the correct browser/device runtime and report directory`, t => {
    const f = fixture(t)
    const { hbx, lib, compiler } = runtime(f)
    assertSuccess(f.run(['run', `test:${name}`, '--device-id=device-123', '--port', '9527', '--debug']))
    const [call] = f.calls()
    assert.equal(call.cwd, f.app)
    assert.equal(call.env.UNI_PLATFORM, uniPlatform)
    assert.equal(call.env.UNI_AUTOMATOR_PORT, '9527')
    assert.equal(call.env.HX_Version, '4.87')
    assert.equal(call.env.DEBUG, 'automator:*')
    assert.equal(call.env.BROWSER, browser || undefined)
    assert.equal(call.env.UNI_OS_NAME, launcher ? platform : undefined)
    assert.equal(call.env.UNI_AUTOMATOR_DEVICE_ID, launcher ? 'device-123' : undefined)
    assert.ok(call.args.includes(`--env=${path.join(compiler, 'node_modules/@dcloudio/uni-automator/dist/environment.js')}`))
    const transform = JSON.parse(call.args[call.args.indexOf('--transform') + 1])
    assert.equal(transform['^.+\\.js$'][0], path.join(lib, 'node_modules/babel-jest/index.js'))
    assert.equal(transform['^.+\\.js$'][1].plugins[0], path.join(compiler, 'node_modules/@babel/plugin-transform-modules-commonjs/index.js'))
    const output = call.args.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length)
    assert.equal(path.dirname(output), path.join(f.app, '.hbuilderx/test-report', platform))
    assert.match(path.basename(output), /^device-123-\d{14}\.json$/)
    assert.ok(fs.existsSync(path.join(f.app, 'jest.config.js')))
    if (launcher) {
      const config = JSON.parse(fs.readFileSync(path.join(f.app, 'env.js'), 'utf8').replace(/^module.exports = /, ''))
      assert.equal(config['app-plus'][platform].id, 'device-123')
      assert.equal(config['app-plus'][platform].executablePath, platform === 'harmony' ? launcher : path.join(hbx, 'plugins/launcher/base', launcher))
    }
  })
}

for (const alias of ['device_id', 'device-id', 'deviceId']) {
  test(`--${alias} updates only the requested device and preserves custom runtime and Jest configuration`, t => {
    const f = fixture(t)
    runtime(f)
    const config = { 'is-custom-runtime': true, 'app-plus': { android: { id: 'old', executablePath: '/custom/base.apk' }, ios: { id: 'keep-ios' } }, UNI_TEST_CUSTOM_ENV: { TEST_CUSTOM_VALUE: 'value with spaces' } }
    write(path.join(f.app, 'env.js'), 'module.exports = ' + JSON.stringify(config))
    const jest = 'module.exports = { transform: {}, moduleNameMapper: { "custom": "mapping" } }'
    write(path.join(f.app, 'jest.config.js'), jest)
    write(path.join(f.app, 'tests/example.test.js'), '')
    assertSuccess(f.run(['run', 'test:app-android', `--${alias}`, 'new-device', '--testcaseFile=tests/example.test.js']))
    const [call] = f.calls()
    assert.equal(call.env.UNI_AUTOMATOR_DEVICE_ID, 'new-device')
    assert.equal(call.env.TEST_CUSTOM_VALUE, 'value with spaces')
    assert.ok(call.args.includes('tests/example.test.js'))
    assert.ok(!call.args.includes('--transform'))
    assert.ok(!call.args.includes('--moduleNameMapper'))
    assert.equal(fs.readFileSync(path.join(f.app, 'jest.config.js'), 'utf8'), jest)
    config['app-plus'].android.id = 'new-device'
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.app, 'env.js'), 'utf8').replace(/^module.exports = /, '')), config)
  })
}

for (const [name, body] of [['exit code', 'process.exit(7)'], ['signal', 'process.kill(process.pid, "SIGTERM")']]) {
  test(`Jest ${name} is reported as a test failure`, t => {
    const f = fixture(t)
    runtime(f, body)
    const result = f.run(['run', 'test:web-chrome'])
    assertFailure(result)
    if (name === 'exit code') assert.equal(result.status, 7)
  })
}

test('missing test file fails without launching Jest', t => {
  const f = fixture(t)
  runtime(f)
  assertFailure(f.run(['run', 'test:web-chrome', '--testcaseFile', 'missing.test.js']), /测试用例文件不存在/)
  assert.deepEqual(f.calls(), [])
})

test('missing automator dependency fails with an actionable message before launching Jest', t => {
  const f = fixture(t)
  const { compiler } = runtime(f)
  fs.unlinkSync(path.join(compiler, 'node_modules/@dcloudio/uni-automator/dist/environment.js'))
  assertFailure(f.run(['run', 'test:web-chrome']), /编译器插件安装完整/)
  assert.deepEqual(f.calls(), [])
})

test('browser tests leave existing env.js byte-for-byte unchanged', t => {
  const f = fixture(t)
  runtime(f)
  const original = '// Keep comments and custom values\nmodule.exports = { UNI_TEST_CUSTOM_ENV: { TEST_CUSTOM_VALUE: "custom" } }\n'
  write(path.join(f.app, 'env.js'), original)
  assertSuccess(f.run(['run', 'test:web-chrome']))
  assert.equal(fs.readFileSync(path.join(f.app, 'env.js'), 'utf8'), original)
  assert.equal(f.calls()[0].env.TEST_CUSTOM_VALUE, 'custom')
})
