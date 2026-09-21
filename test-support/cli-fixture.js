import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../bin/uapp', import.meta.url))
const template = fileURLToPath(new URL('../uappsdk/templates/manifest.json', import.meta.url))

export function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

export function executable(file, source) {
  write(file, `#!${process.execPath}\n${source}\n`)
  fs.chmodSync(file, 0o755)
}

export function fixture(t, type = 'webapp', manifest = {}) {
  // Spaces and non-ASCII characters exercise argument/path handling in every CLI test.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uapp 测试 ')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const app = path.join(root, 'Example App')
  const sdk = path.join(root, '.uappsdk')
  const bin = path.join(root, 'bin')
  const trace = path.join(root, 'trace.jsonl')
  fs.mkdirSync(bin)
  write(path.join(sdk, 'templates/manifest.json'), fs.readFileSync(template))
  const bootstrap = path.join(root, 'bootstrap.mjs')
  write(bootstrap, `import os from 'node:os'; os.homedir = () => ${JSON.stringify(root)};`)
  const data = { appid: '__UNI__TEST', name: 'Test App', vueVersion: 3, versionName: '1.0.0', versionCode: 100, uapp: { package: 'com.example.test' }, ...manifest }
  write(path.join(app, 'manifest.json'), JSON.stringify(data))
  write(path.join(app, 'package.json'), '{}')
  if (type === 'webapp') {
    write(path.join(app, 'pages.json'), '{}')
    fs.mkdirSync(path.join(app, 'pages'))
  } else if (type === 'android') {
    write(path.join(app, 'app/build.gradle'), 'namespace "old"\napplicationId "old"\nversionName "old"\nversionCode 1\n')
    for (const variant of ['main', 'debug']) {
      write(path.join(app, `app/src/${variant}/assets/data/dcloud_control.xml`), '<HBuilder version="1.0.0"><app appid="old" /></HBuilder>')
    }
  } else if (type === 'ios') {
    write(path.join(app, 'Main/AppDelegate.m'), '')
  }
  const record = `const fs = require('node:fs'); const path = require('node:path');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(UNI_|HX_|NODE_ENV$|NODE_PATH$|BROWSER$|DEBUG$|TEST_CUSTOM_VALUE$)/.test(key)));
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({args: process.argv.slice(2), env, cwd: process.cwd()}) + '\\n');`
  return {
    root, app, sdk, bin, trace, manifest: data, record,
    config(config) { write(path.join(sdk, 'config.json'), JSON.stringify(config)) },
    calls() { return fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse) : [] },
    run(args, options = {}) {
      const result = spawnSync(process.execPath, ['--import', bootstrap, entry, ...args], {
        cwd: app,
        encoding: 'utf8',
        timeout: 15000,
        ...options,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_UPDATE_NOTIFIER: '1', CI: '1', ...options.env }
      })
      assert.ifError(result.error)
      assert.equal(result.signal, null, `CLI terminated by ${result.signal}: ${result.stderr}`)
      return result
    }
  }
}

export function assertSuccess(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

export function assertFailure(result, message) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  if (message) assert.match(result.stdout + result.stderr, message)
}

export function compiler(f, source) {
  const hbx = path.join(f.root, 'HBuilderX.app')
  const base = Number(f.manifest.vueVersion) === 3 ? 'plugins/uniapp-cli-vite' : 'plugins/uniapp-cli'
  const script = path.join(hbx, base, Number(f.manifest.vueVersion) === 3 ? 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js' : 'bin/uniapp-cli.js')
  write(script, f.record + '\n' + source)
  f.config({ 'hbx.dir': hbx, node: process.execPath })
  return { hbx, script }
}
