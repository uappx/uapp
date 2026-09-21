import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, write, executable, compiler, assertSuccess, assertFailure } from '../test-support/cli-fixture.js'

const emitResources = `fs.mkdirSync(path.join(process.env.UNI_OUTPUT_DIR, 'nested'), {recursive:true});
fs.writeFileSync(path.join(process.env.UNI_OUTPUT_DIR, 'manifest.json'), '{"appid":"__UNI__TEST"}');
fs.writeFileSync(path.join(process.env.UNI_OUTPUT_DIR, 'nested/中文 file.js'), 'app content');`

// Read ZIP central-directory entries and stored file bytes using only Node built-ins.
// This checks the actual archive, including paths, rather than just its existence.
function readStoredZip(file) {
  const zip = fs.readFileSync(file)
  const end = zip.length - 22
  assert.equal(zip.readUInt32LE(end), 0x06054b50)
  const entries = {}
  let offset = zip.readUInt32LE(end + 16)
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50)
    assert.equal(zip.readUInt16LE(offset + 10), 0, 'WGT resources should be stored without compression')
    const size = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString()
    const local = zip.readUInt32LE(offset + 42)
    assert.equal(zip.readUInt32LE(local), 0x04034b50)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    entries[name] = zip.subarray(start, start + size).toString()
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

for (const vueVersion of [2, 3]) {
  for (const target of ['dev:h5', 'build:h5', 'build:app-custom']) {
    test(`Vue ${vueVersion} ${target} passes compiler arguments and environment`, t => {
      const f = fixture(t, 'webapp', { vueVersion })
      write(path.join(f.app, 'package.json'), JSON.stringify({ 'uni-app': { scripts: { 'app-custom': { env: { UNI_PLATFORM: 'app' } } } } }))
      const { hbx, script } = compiler(f, emitResources)
      assertSuccess(f.run(['run', target]))
      const [call] = f.calls()
      const buildName = target.split(':')[1]
      assert.deepEqual(call.args, vueVersion === 3 ? [target.startsWith('build:') ? 'build' : '', '-p', buildName] : [])
      assert.equal(call.env.UNI_PLATFORM, buildName === 'app-custom' ? 'app' : 'h5')
      assert.equal(call.env.NODE_ENV, target.startsWith('dev:') ? 'development' : 'production')
      assert.equal(call.env.UNI_INPUT_DIR, f.app)
      const relative = buildName === 'app-custom' ? 'unpackage/resources/__UNI__TEST/www' : `unpackage/dist/${target.startsWith('dev:') ? 'dev' : 'build'}/h5`
      assert.equal(call.env.UNI_OUTPUT_DIR, path.join(f.app, relative))
      assert.equal(fs.readFileSync(path.join(call.env.UNI_OUTPUT_DIR, 'nested/中文 file.js'), 'utf8'), 'app content')
      assert.equal(call.cwd, fs.realpathSync(vueVersion === 3 ? f.app : path.join(hbx, 'plugins/uniapp-cli')))
      assert.ok(fs.existsSync(script))
    })
  }
}

test('Web build --out and -r package the actual output as a WGT without an enclosing directory', t => {
  const f = fixture(t)
  compiler(f, emitResources)
  const out = path.join(f.root, 'custom output')
  assertSuccess(f.run(['run', 'build:app', '--out', out, '-r', 'custom.wgt']))
  assert.equal(f.calls()[0].env.UNI_OUTPUT_DIR, out)
  assert.deepEqual(readStoredZip(path.join(f.app, 'unpackage/release/custom.wgt')), {
    'manifest.json': '{"appid":"__UNI__TEST"}',
    'nested/中文 file.js': 'app content'
  })
})

for (const [name, source] of [
  ['nonzero exit', 'process.exit(7)'],
  ['compiler error on stderr', 'process.stderr.write("failed with errors")'],
  ['missing platform on stderr', 'process.stderr.write("Missing platform")'],
  ['signal', 'process.kill(process.pid, "SIGTERM")']
]) {
  test(`Web ${name} fails and preserves a previous WGT`, t => {
    const f = fixture(t)
    compiler(f, source)
    const previous = path.join(f.app, 'unpackage/release/app.wgt')
    write(previous, 'previous archive')
    const result = f.run(['run', 'build:app', '-r', 'app.wgt'])
    assertFailure(result)
    assert.doesNotMatch(result.stdout, /打包成功/)
    assert.equal(fs.readFileSync(previous, 'utf8'), 'previous archive')
  })
}

test('Web compiler launch failure is reported without an unhandled error event', t => {
  const f = fixture(t)
  const { hbx } = compiler(f, '')
  const invalidNode = path.join(f.root, 'not executable')
  write(invalidNode, 'not an executable')
  f.config({ 'hbx.dir': hbx, node: invalidNode })
  const result = f.run(['run', 'build:h5'])
  assertFailure(result, /EACCES|ENOEXEC|spawn/)
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/)
})

test('native build stops before preparation and Gradle when the web compiler fails', t => {
  const f = fixture(t, 'android')
  compiler(f, 'process.exit(7)')
  executable(path.join(f.app, 'gradlew'), 'throw new Error("Gradle must not run")')
  const previous = path.join(f.app, 'app/src/main/assets/apps/old/www/index.html')
  write(previous, 'previous app')
  const result = f.run(['run', 'build:app'])
  assertFailure(result)
  assert.doesNotMatch(result.stderr, /Gradle must not run/)
  assert.equal(f.calls().length, 1)
  assert.equal(fs.readFileSync(previous, 'utf8'), 'previous app')
})

test('src-layout projects build from src/manifest.json', t => {
  const f = fixture(t)
  const source = path.join(f.app, 'src')
  fs.mkdirSync(source)
  for (const file of ['manifest.json', 'package.json', 'pages.json', 'pages']) fs.renameSync(path.join(f.app, file), path.join(source, file))
  compiler(f, emitResources)
  assertSuccess(f.run(['run', 'build:h5']))
  assert.equal(f.calls()[0].env.UNI_INPUT_DIR, source)
})

for (const missing of ['installation', 'node', 'compiler']) {
  test(`Web build fails explicitly when ${missing} is missing`, t => {
    const f = fixture(t)
    const { hbx, script } = compiler(f, '')
    if (missing === 'installation') f.config({ 'hbx.dir': path.join(f.root, 'missing') })
    if (missing === 'node') f.config({ 'hbx.dir': hbx, node: path.join(f.root, 'missing-node') })
    if (missing === 'compiler') fs.unlinkSync(script)
    assertFailure(f.run(['run', 'build:h5']), /找不到|需要安装插件/)
    assert.deepEqual(f.calls(), [])
  })
}
