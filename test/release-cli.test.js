import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, assertFailure } from '../test-support/cli-fixture.js'

const cases = [
  ['webapp', ['run', 'build:app', '--release'], /必须指定发布格式或输出文件/],
  ['webapp', ['run', 'build:app', '--release', 'demo'], /必须包含扩展名/],
  ['webapp', ['run', 'build:app', '--release', 'demo.ipa'], /不支持的发布格式/],
  ['webapp', ['run', 'build:app', '--release', 'wgt', 'dist/demo.wgt'], /仅接受一个参数/],
  ['webapp', ['run', 'build:app', '--release', 'apk'], /仅支持 wgt/],
  ['webapp', ['run', 'build:app', '--release', 'demo.apk'], /仅支持 wgt/],
  ['webapp', ['run', 'build:h5', '--release', 'wgt'], /仅支持 build:app/],
  ['webapp', ['run', 'build:app', '--out', 'dist', '--release', 'wgt'], /已移除/],
  ['webapp', ['run', 'build:app', '-o', 'dist', '--release', 'wgt'], /已移除/],
  ['android', ['run', 'build:app', '--release', 'wgt'], /仅支持 apk、aab/],
  ['android', ['run', 'build:app', '--release', 'demo.wgt'], /仅支持 apk、aab/],
  ['android', ['run', 'build:app', '--release'], /必须指定发布格式或输出文件/],
  ['android', ['run', 'build:app', '--release', 'demo'], /必须包含扩展名/],
  ['android', ['run', 'build:app', '--release', 'demo.ipa'], /不支持的发布格式/],
  ['android', ['run', 'build:app', '--release', 'apk', 'dist/demo.apk'], /仅接受一个参数/]
]

for (const [type, args, message] of cases) {
  test(`${type} rejects ${args.join(' ')}`, t => {
    const f = fixture(t, type)
    const result = f.run(args)
    assertFailure(result, message)
    assert.deepEqual(f.calls(), [])
  })
}
