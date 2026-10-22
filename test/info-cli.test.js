import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { fixture, write, executable, assertSuccess, assertFailure } from '../test-support/cli-fixture.js'

for (const platform of ['ios', 'android', 'webapp']) {
  for (const args of [['key'], ['other'], ['jwt', 'extra'], ['--release', 'apk'], ['--extra']]) {
    test(`${platform} rejects info ${args.join(' ')}`, t => {
      const f = fixture(t, platform)
      const result = f.run(['info', ...args])
      assertFailure(result, /不支持的 info 参数/)
      assert.ok(!result.stdout.includes('JWT Token'))
      assert.ok(!result.stdout.includes('- appid'))
      assert.equal(f.calls().length, 0)
    })
  }
}

for (const platform of ['android', 'webapp']) {
  test(`${platform} rejects info jwt before reading JWT configuration`, t => {
    const f = fixture(t, platform)
    const result = f.run(['info', 'jwt'])
    assertFailure(result, /仅支持 iOS 工程/)
    assert.ok(!result.stdout.includes('JWT Token'))
    assert.ok(!result.stdout.includes('jwt/config.json'))
    assert.ok(!result.stdout.includes('- appid'))
    assert.equal(f.calls().length, 0)
  })
}

test('iOS info jwt generates a valid token without basic or signing information', t => {
  const f = fixture(t, 'ios')
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  write(path.join(f.app, 'jwt/config.json'), JSON.stringify({ team_id: 'TEAM123456', client_id: 'com.example.login', key_id: 'TESTKEY123' }))
  write(path.join(f.app, 'jwt/key.txt'), privateKey.export({ format: 'pem', type: 'pkcs8' }))
  const result = f.run(['info', 'jwt'])
  assertSuccess(result)
  const token = result.stdout.split(/\r?\n/).find(line => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(line))
  assert.ok(token)
  const claims = jwt.verify(token, publicKey, { algorithms: ['ES256'], issuer: 'TEAM123456', audience: 'https://appleid.apple.com' })
  assert.equal(claims.sub, 'com.example.login')
  assert.ok(!result.stdout.includes('- appid'))
  assert.ok(!result.stdout.includes('iOS 发行证书'))
  assert.ok(!result.stdout.includes('dev.dcloud.net.cn'))
})

test('Android info still prints basic information and signing fingerprints', t => {
  const f = fixture(t, 'android')
  write(path.join(f.app, 'app/app.keystore'), 'test fixture')
  executable(path.join(f.app, 'gradlew'), f.record + '\nconsole.log("Variant: release\\nMD5: AA:BB:CC:DD\\nSHA1: 11:22:33:44\\n----------")')
  const result = f.run(['info'])
  assertSuccess(result)
  assert.ok(result.stdout.includes('- appid'))
  assert.ok(result.stdout.includes('AABBCCDD'))
  assert.ok(result.stdout.includes('11:22:33:44'))
  assert.ok(!result.stdout.includes('JWT Token'))
  assert.deepEqual(f.calls().map(call => call.args), [['app:signingReport']])
})

test('web info remains unsupported and does not query native signing', t => {
  const f = fixture(t, 'webapp')
  const result = f.run(['info'])
  assert.ok(result.stdout.includes('webapp 不支持命令 uapp info'))
  assert.ok(!result.stdout.includes('- appid'))
  assert.ok(!result.stdout.includes('uapp info jwt'))
  assert.ok(!result.stdout.includes('JWT Token'))
})
