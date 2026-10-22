import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { readIOSSigningProject, findLatestIOSUpload, matchIOSDistributionCertificate, getIOSSigningInfo } from '../src/ios-signing.js'
import { fixture, write, assertSuccess } from '../test-support/cli-fixture.js'

const teamId = 'TEAM123456'
const bundleId = 'com.example.test'
let root, cert, development
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'uapp-signing-'))
  for (const [name, type] of [['release', 'Apple Distribution'], ['dev', 'Apple Development']]) {
    const file = path.join(root, name + '.pem')
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root, name + '.key'), '-out', file, '-days', '1', '-subj', `/CN=${type}: Example (${teamId})/OU=${teamId}`], { stdio: 'ignore' })
    if (name === 'release') cert = new X509Certificate(fs.readFileSync(file))
    else development = new X509Certificate(fs.readFileSync(file))
  }
})
after(() => fs.rmSync(root, { recursive: true, force: true }))
const sha = cert => cert.fingerprint.replace(/:/g, '')
const upload = (date, overrides = {}) => ({ teamID: teamId, destination: 'upload', uploadDestination: 'App Store', certificateSHA1: 'A'.repeat(40), uploadedBuildNumber: '123', uploadEvent: { state: 'success', date }, ...overrides })
function archive(t, name, distributions, app = bundleId) {
  const dir = path.join(root, name + '.xcarchive')
  write(path.join(dir, 'Info.plist'), JSON.stringify({ ApplicationProperties: { CFBundleIdentifier: app, SigningIdentity: 'Apple Development: example' }, Distributions: distributions }))
  return dir
}
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))

function projectData(settings = {}) {
  return { rootObject: 'project', objects: {
    project: { targets: ['app', 'extension'], buildConfigurationList: 'projectList' },
    projectList: { buildConfigurations: ['projectRelease'] },
    projectRelease: { name: 'Release', buildSettings: { DEVELOPMENT_TEAM: teamId } },
    app: { name: 'uapp-release', productType: 'com.apple.product-type.application', buildConfigurationList: 'appList' },
    appList: { buildConfigurations: ['debug', 'release'] },
    debug: { name: 'Debug', buildSettings: { DEVELOPMENT_TEAM: 'WRONG12345' } },
    release: { name: 'Release', buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: bundleId, ...settings } },
    extension: { name: 'extension', productType: 'com.apple.product-type.app-extension' }
  } }
}

test('reads Release target and inherited project team, ignoring Debug and extension settings', t => {
  const f = fixture(t, 'ios')
  write(path.join(f.app, 'Example.xcodeproj/project.pbxproj'), JSON.stringify(projectData()))
  const info = readIOSSigningProject(f.app, { run: (command, args, opts) => opts.input || fs.readFileSync(args.at(-1), 'utf8') })
  assert.deepEqual(info, { teamId, bundleId, archivePath: undefined })
})

test('resolves xcconfig variables through the selected release target', t => {
  const f = fixture(t, 'ios')
  write(path.join(f.app, 'Example.xcodeproj/project.pbxproj'), JSON.stringify(projectData({ DEVELOPMENT_TEAM: '$(APP_TEAM)' })))
  const info = readIOSSigningProject(f.app, { run: (command, args, opts) => {
    if (command === 'xcodebuild') {
      assert.equal(args[args.indexOf('-target') + 1], 'uapp-release')
      assert.ok(args.includes('-showBuildSettings'))
      return JSON.stringify([{ target: 'uapp-release', buildSettings: { DEVELOPMENT_TEAM: teamId, PRODUCT_BUNDLE_IDENTIFIER: bundleId } }])
    }
    return opts.input || fs.readFileSync(args.at(-1), 'utf8')
  } })
  assert.equal(info.teamId, teamId)
})

test('selects latest successful upload for exact team and bundle, not latest failed archive', t => {
  const archives = [
    archive(t, 'old', [upload('2026-01-01T00:00:00Z')]),
    archive(t, 'latest', [upload('2026-02-01T00:00:00Z', { uploadedBuildNumber: '124' }), upload('2026-03-01T00:00:00Z', { uploadEvent: { state: 'errors', date: '2026-03-01T00:00:00Z' } })]),
    archive(t, 'other-team', [upload('2026-04-01T00:00:00Z', { teamID: 'OTHER12345' })]),
    archive(t, 'other-bundle', [upload('2026-05-01T00:00:00Z')], 'com.other.app'),
    archive(t, 'export-only', [upload('2026-06-01T00:00:00Z', { destination: 'export' })])
  ]
  assert.equal(findLatestIOSUpload(archives, { teamId, bundleId }, readJSON).uploadedBuildNumber, '124')
})

test('does not fall back to an older certificate when latest successful upload has no fingerprint', t => {
  const dir = archive(t, 'missing-fingerprint', [upload('2026-01-01T00:00:00Z'), upload('2026-02-01T00:00:00Z', { certificateSHA1: '' })])
  assert.throws(() => findLatestIOSUpload([dir], { teamId, bundleId }, readJSON), /certificateSHA1/)
})

test('requires a successful App Store upload', () => {
  assert.throws(() => findLatestIOSUpload([], { teamId, bundleId }, readJSON), /成功上传 App Store/)
})

test('extracts RSA modulus and rejects development certificates and mismatched team/fingerprint', () => {
  const info = matchIOSDistributionCertificate(cert.raw, teamId, sha(cert))
  const expected = execFileSync('openssl', ['x509', '-in', path.join(root, 'release.pem'), '-noout', '-modulus'], { encoding: 'utf8' }).trim().replace('Modulus=', '')
  assert.equal(info.publicKey, expected)
  assert.equal(info.sha1, sha(cert))
  assert.equal(matchIOSDistributionCertificate(development.raw, teamId, sha(cert)), null)
  assert.throws(() => matchIOSDistributionCertificate(cert.raw, 'OTHER12345', sha(cert)), /团队或发行类型/)
  assert.throws(() => matchIOSDistributionCertificate(development.raw, teamId, sha(development)), /团队或发行类型/)
})

// Exercise real plist conversion (including CreationDate), CMS decoding, and CLI dispatch on macOS.
function nativeFixture(t, { withProfile = true } = {}) {
  const f = fixture(t, 'ios')
  write(path.join(f.app, 'Example.xcodeproj/project.pbxproj'), JSON.stringify(projectData()))
  const archiveFile = path.join(f.root, 'Library/Developer/Xcode/Archives/2026-10-22/App.xcarchive/Info.plist')
  write(archiveFile, JSON.stringify({ ApplicationProperties: { CFBundleIdentifier: bundleId }, Distributions: [upload('2026-10-22T09:09:18Z', { certificateSHA1: sha(cert) })] }))
  execFileSync('plutil', ['-convert', 'xml1', archiveFile])
  fs.writeFileSync(archiveFile, fs.readFileSync(archiveFile, 'utf8').replace('<dict>', '<dict><key>CreationDate</key><date>2026-10-22T09:07:11Z</date>'))
  if (withProfile) {
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>Entitlements</key><dict><key>application-identifier</key><string>${teamId}.${bundleId}</string><key>com.apple.developer.team-identifier</key><string>${teamId}</string><key>get-task-allow</key><false/><key>beta-reports-active</key><true/></dict><key>DeveloperCertificates</key><array><data>${cert.raw.toString('base64')}</data></array></dict></plist>`
    const input = path.join(f.root, 'profile.plist')
    write(input, xml)
    const profile = path.join(f.root, 'Library/Developer/Xcode/UserData/Provisioning Profiles/release.mobileprovision')
    fs.mkdirSync(path.dirname(profile), { recursive: true })
    execFileSync('openssl', ['cms', '-sign', '-nodetach', '-in', input, '-signer', path.join(root, 'release.pem'), '-inkey', path.join(root, 'release.key'), '-outform', 'DER', '-out', profile])
  }
  return f
}

test('cloud distribution certificate is found in profile and iOS info prints it', { skip: process.platform !== 'darwin' }, t => {
  const f = nativeFixture(t)
  const info = getIOSSigningInfo(f.app, { homeDir: f.root, run: (command, args, opts) => {
    assert.notEqual(command, 'security', 'profile certificate should not require keychain access')
    return execFileSync(command, args, opts)
  } })
  assert.equal(info.sha1, sha(cert))
  const result = f.run(['info'])
  assertSuccess(result)
  assert.ok(result.stdout.includes(info.publicKey))
  assert.ok(result.stdout.includes(info.sha1))
  assert.ok(result.stdout.includes('TEAM_ID: ' + teamId))
  assert.ok(!result.stdout.includes('JWT Token'))
  assert.ok(!result.stdout.includes('jwt/config.json'))
  const jwt = f.run(['info', 'jwt'])
  assertSuccess(jwt)
  assert.ok(jwt.stdout.includes('JWT Token'))
  assert.ok(!jwt.stdout.includes('iOS 发行证书'))
  assert.ok(!jwt.stdout.includes('- appid'))
})

test('missing upload certificate reports verified SHA-1 without substituting another certificate', { skip: process.platform !== 'darwin' }, t => {
  const f = nativeFixture(t, { withProfile: false })
  assert.throws(() => getIOSSigningInfo(f.app, { homeDir: f.root, run: (command, args, opts) => command === 'security' ? development.toString() : execFileSync(command, args, opts) }), error => error.message.includes(sha(cert)) && error.message.includes('无法提取公钥'))
})

test('non-iOS info does not query iOS signing', t => {
  const f = fixture(t, 'webapp')
  const result = f.run(['info'])
  assertSuccess(result)
  assert.ok(!result.stdout.includes('iOS 发行证书'))
})
