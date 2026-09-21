import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, executable, assertSuccess, assertFailure } from '../test-support/cli-fixture.js'

for (const args of [['run'], ['run', 'build:'], ['run', 'invalid:h5'], ['run', 'test:unknown']]) {
  test(`invalid arguments ${args.join(' ')} produce a useful error`, t => {
    const f = fixture(t)
    const result = f.run(args)
    assertFailure(result, /命令无效|不支持测试平台/)
    assert.doesNotMatch(result.stderr, /TypeError|at file:/)
    assert.deepEqual(f.calls(), [])
  })
}

for (const args of [['run'], ['run', 'build:h5'], ['prepare', 'dev:app'], ['run', 'build:app', '-r', 'app.wgt']]) {
  test(`Android rejects ${args.join(' ')} before starting a build`, t => {
    const f = fixture(t, 'android')
    assertFailure(f.run(args), /命令无效/)
    assert.deepEqual(f.calls(), [])
  })
}

for (const missing of ['manifest', 'uapp']) {
  test(`native commands fail explicitly when ${missing} is missing`, t => {
    const f = fixture(t, 'android', missing === 'uapp' ? { uapp: null } : {})
    if (missing === 'manifest') fs.unlinkSync(path.join(f.app, 'manifest.json'))
    assertFailure(f.run(['prepare', 'build:app', '--no-webapp']), missing === 'manifest' ? /指定 manifest.json/ : /缺少 uapp 节点/)
    assert.deepEqual(f.calls(), [])
  })
}

for (const command of ['hbx', 'wx']) {
  for (const outcome of ['success', 'failure', 'signal', 'missing-executable', 'missing-installation']) {
    test(`${command} propagates ${outcome} to its caller`, t => {
      const f = fixture(t)
      const install = path.join(f.root, 'Tool App')
      f.config({ [command === 'hbx' ? 'hbx.dir' : 'wx.dir']: install })
      if (outcome !== 'missing-installation') fs.mkdirSync(install)
      if (!outcome.startsWith('missing')) {
        const file = path.join(install, process.platform === 'darwin' ? 'Contents/MacOS/cli' : 'cli')
        executable(file, f.record + (outcome === 'failure' ? '\nprocess.exit(7)' : outcome === 'signal' ? '\nprocess.kill(process.pid, "SIGTERM")' : ''))
      }
      const result = f.run([command, 'open', '--project', '项目 with spaces'])
      if (outcome === 'success') assertSuccess(result)
      else assertFailure(result)
      if (outcome === 'failure') assert.equal(result.status, 7)
      if (!outcome.startsWith('missing')) assert.deepEqual(f.calls()[0].args, ['open', '--project', '项目 with spaces'])
    })
  }
}
