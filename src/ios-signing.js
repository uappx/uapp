import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import chalk from 'chalk'

const commandOptions = {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 30000,
  maxBuffer: 16 * 1024 * 1024
}

const fingerprint = value => String(value || '').replace(/:/g, '').toUpperCase()
const entries = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []

function readPlist(file, run) {
  // plutil cannot convert plist dates/data directly to JSON (archive CreationDate is a date).
  const xml = run('plutil', ['-convert', 'xml1', '-o', '-', file], commandOptions)
    .replace(/<(date|data)>([\s\S]*?)<\/\1>/g, '<string>$2</string>')

  return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { ...commandOptions, input: xml }))
}

// Read the selected app target, rather than collecting teams from Pods/extensions.
export function readIOSSigningProject(appDir, { run = execFileSync } = {}) {
  let supplied = {}
  const rubyConfig = path.join(appDir, 'uniapp_config.rb')

  if (fs.existsSync(rubyConfig)) {
    supplied = JSON.parse(run('ruby', [
      '-rjson', '-e',
      'load ARGV.fetch(0); puts JSON.generate(defined?(UAPP_BUILD_CONFIG) ? UAPP_BUILD_CONFIG : {})',
      rubyConfig
    ], { ...commandOptions, cwd: appDir }))
  }

  const projects = entries(appDir).filter(e => e.isDirectory() && e.name.endsWith('.xcodeproj'))
  const project = supplied.project || (projects.length === 1 ? projects[0].name : '')
  if (!project) throw new Error('无法确定 iOS 工程，请在 uniapp_config.rb 的 UAPP_BUILD_CONFIG 中指定 project')

  const { objects, rootObject } = readPlist(path.resolve(appDir, project, 'project.pbxproj'), run)
  const root = objects[rootObject]
  const targets = (root.targets || [])
    .map(id => objects[id])
    .filter(t => t?.productType === 'com.apple.product-type.application')
  const target = supplied.release_target
    ? targets.find(t => t.name === supplied.release_target)
    : targets.length === 1 ? targets[0] : targets.find(t => t.name === 'uapp-release')
  if (!target) throw new Error('无法确定 iOS 发布 target，请在 UAPP_BUILD_CONFIG 中指定 release_target')

  const releaseSettings = object => {
    const list = objects[object.buildConfigurationList]
    const config = list?.buildConfigurations.map(id => objects[id]).find(c => c.name === 'Release')
    if (!config) throw new Error('iOS 工程缺少 Release 构建配置')
    return config.buildSettings || {}
  }
  let settings = { ...releaseSettings(root), ...releaseSettings(target) }

  // Resolve xcconfig/inherited build settings only when the project does not contain literal values.
  if (![settings.DEVELOPMENT_TEAM, settings.PRODUCT_BUNDLE_IDENTIFIER].every(v => typeof v === 'string' && v && !v.includes('$'))) {
    const resolved = JSON.parse(run('xcodebuild', [
      '-project', path.resolve(appDir, project),
      '-target', target.name, '-configuration', 'Release', '-showBuildSettings', '-json'
    ], { ...commandOptions, cwd: appDir }))
    settings = resolved.find(item => item.target === target.name)?.buildSettings || {}
  }

  const { DEVELOPMENT_TEAM: teamId, PRODUCT_BUNDLE_IDENTIFIER: bundleId } = settings
  if (!/^[A-Z0-9]{10}$/.test(teamId || '') || !bundleId || bundleId.includes('$')) {
    throw new Error('当前 iOS 工程的 Release 配置缺少有效的 DEVELOPMENT_TEAM 或 PRODUCT_BUNDLE_IDENTIFIER')
  }

  return { teamId, bundleId, archivePath: supplied.archive_path && path.resolve(appDir, supplied.archive_path) }
}

function findArchives(dir, depth = 2) {
  return entries(dir).filter(e => e.isDirectory()).flatMap(e => {
    const file = path.join(dir, e.name)
    return e.name.endsWith('.xcarchive') ? [file] : depth > 0 ? findArchives(file, depth - 1) : []
  })
}

export function findLatestIOSUpload(archives, project, read = file => readPlist(file, execFileSync)) {
  let latest

  for (const archive of new Set(archives)) {
    const file = path.join(archive, 'Info.plist')
    if (!fs.existsSync(file)) continue

    const info = read(file)
    if (info.ApplicationProperties?.CFBundleIdentifier !== project.bundleId) continue

    for (const distribution of info.Distributions || []) {
      if (
        distribution.teamID !== project.teamId ||
        distribution.uploadDestination !== 'App Store' ||
        distribution.destination !== 'upload' ||
        distribution.uploadEvent?.state !== 'success'
      ) continue

      const time = Date.parse(distribution.uploadEvent.date)
      if (!Number.isFinite(time)) throw new Error(`上传记录时间无效: ${file}`)
      if (!latest || time > latest.time) latest = { archive, ...distribution, time }
    }
  }

  if (!latest) throw new Error([
    '未找到当前应用成功上传 App Store 的本地归档记录。',
    '',
    `  TEAM_ID:   ${project.teamId}`,
    `  Bundle ID: ${project.bundleId}`,
    '',
    '请先完成上传，再查询发行证书：',
    '',
    '  1. 打开工程',
    '     用 Xcode 打开当前 iOS 工程；有 .xcworkspace 时优先打开它。',
    '     选择发布 scheme，以及真机或通用 iOS 设备目标。',
    '',
    '  2. 核对签名',
    '     在 Signing & Capabilities 中确认 Team 和 Bundle ID 与上方一致。',
    '',
    '  3. 创建归档',
    '     执行 Product > Archive，等待归档完成。',
    '',
    '  4. 上传 App Store Connect',
    '     打开 Window > Organizer > Archives，选中归档并点击 Distribute App。',
    '     选择 App Store Connect 上传流程，完成 Upload 并确认上传成功。',
    '',
    '  5. 重新查询',
    '     回到当前 iOS 工程目录，运行 uapp info。',
    '',
    '提示：上传成功即可，无需等待审核或正式上架；仅完成 Archive 还不够。',
    '',
    '已在其他电脑上传？',
    '  可在那台电脑运行命令，或将包含成功上传记录的 .xcarchive 恢复到：',
    '  ~/Library/Developer/Xcode/Archives',
    '  同时准备对应的 App Store 描述文件或发行证书。'
  ].join('\n'))

  latest.sha1 = fingerprint(latest.certificateSHA1)
  if (!/^[A-F0-9]{40}$/.test(latest.sha1)) throw new Error('最新成功上传记录缺少有效的 certificateSHA1，无法确认发行证书')

  return latest
}

export function matchIOSDistributionCertificate(data, teamId, sha1) {
  const cert = new X509Certificate(data)
  if (fingerprint(cert.fingerprint) !== sha1) return null

  const subject = Object.fromEntries(cert.subject.split('\n').map(line => {
    const i = line.indexOf('=')
    return [line.slice(0, i), line.slice(i + 1)]
  }))
  if (subject.OU !== teamId || !/^(Apple Distribution|iPhone Distribution): /.test(subject.CN || '')) {
    throw new Error('上传记录对应证书的团队或发行类型不匹配')
  }

  const jwk = cert.publicKey.export({ format: 'jwk' })
  if (jwk.kty !== 'RSA') throw new Error('发行证书不是 RSA 公钥，无法输出十六进制模数')

  return {
    certificateName: subject.CN,
    publicKey: Buffer.from(jwk.n, 'base64url').toString('hex').toUpperCase(),
    sha1
  }
}

export function getIOSSigningInfo(appDir, { run = execFileSync, homeDir = os.homedir() } = {}) {
  const project = readIOSSigningProject(appDir, { run })
  const archives = [
    ...findArchives(path.join(homeDir, 'Library/Developer/Xcode/Archives')),
    ...findArchives(path.join(appDir, 'out')),
    ...(project.archivePath ? [project.archivePath] : [])
  ]
  const upload = findLatestIOSUpload(archives, project, file => readPlist(file, run))

  const profileDirs = [
    path.join(homeDir, 'Library/Developer/Xcode/UserData/Provisioning Profiles'),
    path.join(homeDir, 'Library/MobileDevice/Provisioning Profiles')
  ]
  const profiles = profileDirs.flatMap(dir => entries(dir)
    .filter(e => e.isFile() && e.name.endsWith('.mobileprovision'))
    .map(e => path.join(dir, e.name)))
  const apps = path.join(upload.archive, 'Products/Applications')
  profiles.push(...entries(apps)
    .filter(e => e.isDirectory() && e.name.endsWith('.app'))
    .map(e => path.join(apps, e.name, 'embedded.mobileprovision'))
    .filter(file => fs.existsSync(file)))

  const failures = []
  for (const profile of profiles) {
    try {
      const xml = run('openssl', ['cms', '-verify', '-noverify', '-inform', 'DER', '-in', profile], commandOptions)
      const extract = (key, format) => run('plutil', ['-extract', key, format, '-o', '-', '-'], { ...commandOptions, input: xml })
      const entitlements = JSON.parse(extract('Entitlements', 'json'))
      if (
        entitlements['com.apple.developer.team-identifier'] !== project.teamId ||
        entitlements['application-identifier'] !== `${project.teamId}.${project.bundleId}` ||
        entitlements['get-task-allow'] !== false ||
        entitlements['beta-reports-active'] !== true
      ) continue

      const certificates = extract('DeveloperCertificates', 'xml1')
      for (const match of certificates.matchAll(/<data>([\s\S]*?)<\/data>/g)) {
        const data = Buffer.from(match[1].replace(/\s/g, ''), 'base64')
        const cert = matchIOSDistributionCertificate(data, project.teamId, upload.sha1)
        if (cert) return { ...project, ...cert, upload, source: profile }
      }
    } catch (error) {
      failures.push(`${profile}: ${error.message}`)
    }
  }

  // Cloud-managed distribution certificates may exist only in a provisioning profile.
  // A keychain certificate is accepted only when it matches the actual upload fingerprint.
  try {
    const pem = run('security', ['find-certificate', '-a', '-p'], commandOptions)
    for (const match of pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)) {
      const cert = matchIOSDistributionCertificate(match[0], project.teamId, upload.sha1)
      if (cert) return { ...project, ...cert, upload, source: '登录钥匙串' }
    }
  } catch (error) {
    failures.push(`钥匙串: ${error.message}`)
  }

  throw new Error([
    '已找到成功上传记录，但未找到匹配的发行证书，无法提取公钥。',
    '',
    '已确认的证书 SHA-1 指纹：',
    upload.sha1,
    '',
    '请下载该版本的 App Store 描述文件，或将对应发行证书导入钥匙串。',
    '完成后重新运行 uapp info。',
    ...(failures.length ? ['', '读取失败详情：', ...failures.map(message => '  ' + message)] : [])
  ].join('\n'))
}

export function printIOSSigningInfo(appDir, options) {
  console.log('------ iOS 发行证书 ------')
  console.log()

  try {
    const info = getIOSSigningInfo(appDir, options)
    const uploadTime = new Date(info.upload.uploadEvent.date).toLocaleString('zh-CN', { hour12: false, timeZoneName: 'short' })

    console.log([
      chalk.green('已核实：证书与最新成功上传 App Store 的记录一致'),
      '',
      'TEAM_ID: ' + info.teamId,
      'Bundle ID: ' + info.bundleId,
      '证书名称: ' + info.certificateName,
      '',
      '上传构建号: ' + info.upload.uploadedBuildNumber,
      '上传时间:   ' + uploadTime,
      '',
      chalk.bold('公钥（RSA 十六进制，可直接复制）'),
      info.publicKey,
      '',
      chalk.bold('证书 SHA-1 指纹（无冒号，可直接复制）'),
      info.sha1,
      '',
      '归档路径: ' + info.upload.archive,
      '证书来源: ' + info.source
    ].join('\n'))
  } catch (error) {
    console.log(chalk.yellow('暂未获取完整的发行证书信息'))
    console.log()
    console.log(error.message)
  }

  console.log()
}
