import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const configName = 'uniapp_config.rb'
const beginMarker = '# BEGIN UAPP_APP_CONFIG (managed by uapp prepare)'
const endMarker = '# END UAPP_APP_CONFIG'

export function hasIOSPodConfig(appDir) {
  return fs.existsSync(path.join(appDir, configName))
}

export function updateIOSPodConfig(appDir, manifest, sdkHomeDir) {
  const uapp = manifest.uapp || {}
  const weixin = manifest['app-plus']?.distribute?.sdkConfigs?.oauth?.weixin || {}
  const controlFile = [
    path.join(appDir, 'SDKs/SDK/control.xml'),
    path.join(sdkHomeDir, 'ios/SDK/control.xml')
  ].find(file => fs.existsSync(file))
  const control = controlFile ? fs.readFileSync(controlFile, 'utf8') : ''
  const sdkVersion = control.match(/<HBuilder\b[^>]*\bversion=["']([^"']+)["']/)?.[1] || '1.0.0'
  const metadata = {
    bundle_id: String(uapp.package ?? ''),
    app_name: String(uapp.name ?? manifest.name ?? ''),
    version_name: String(uapp.versionName ?? manifest.versionName ?? '').split('@')[0],
    version_code: String(uapp.versionCode ?? manifest.versionCode ?? ''),
    appid: String(manifest.appid ?? ''),
    appkey: String(uapp.appkey ?? ''),
    wechat_appid: String(weixin.appid ?? ''),
    wechat_appsecret: String(weixin.appsecret ?? ''),
    universal_links: String(weixin.UniversalLinks ?? ''),
    sdk_version: sdkVersion
  }
  // A quoted Ruby heredoc keeps JSON strings literal, including Ruby #{...}.
  const block = `${beginMarker}\nrequire 'json'\nUAPP_APP_CONFIG = JSON.parse(<<~'UAPP_APP_JSON').freeze\n${JSON.stringify(metadata, null, 2)}\nUAPP_APP_JSON\n${endMarker}`
  const file = path.join(appDir, configName)
  let content = fs.readFileSync(file, 'utf8')
  const begins = [...content.matchAll(/^# BEGIN UAPP_APP_CONFIG \(managed by uapp prepare\)\r?$/gm)]
  const ends = [...content.matchAll(/^# END UAPP_APP_CONFIG\r?$/gm)]
  if (begins.length === 0 && ends.length === 0) {
    if (/^\s*UAPP_APP_CONFIG\s*=/m.test(content)) {
      throw new Error('uniapp_config.rb 中的 UAPP_APP_CONFIG 缺少 uapp 管理标记，无法安全更新')
    }
    content = `${block}\n\n${content}`
  } else if (begins.length !== 1 || ends.length !== 1 || ends[0].index < begins[0].index) {
    throw new Error('uniapp_config.rb 中的 UAPP_APP_CONFIG 管理标记不完整或重复')
  } else {
    content = content.slice(0, begins[0].index) + block + content.slice(ends[0].index + ends[0][0].length)
  }
  fs.writeFileSync(file, content)
}

export function readIOSPodBuildConfig(appDir, { run = execFileSync } = {}) {
  const json = run('ruby', [
    '-rjson', '-e',
    'load ARGV.fetch(0); puts JSON.generate(defined?(UAPP_BUILD_CONFIG) ? UAPP_BUILD_CONFIG : {})',
    path.join(appDir, configName)
  ], { cwd: appDir, encoding: 'utf8' })
  const supplied = JSON.parse(json)
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw new Error('UAPP_BUILD_CONFIG 必须是 Ruby Hash')
  }
  let project = supplied.project
  if (!project) {
    const projects = fs.readdirSync(appDir).filter(name => name.endsWith('.xcodeproj') && fs.statSync(path.join(appDir, name)).isDirectory())
    if (projects.length !== 1) throw new Error('请在 uniapp_config.rb 的 UAPP_BUILD_CONFIG 中指定 project')
    project = projects[0]
  }
  const config = {
    project,
    workspace: supplied.workspace || project.replace(/\.xcodeproj$/, '.xcworkspace'),
    scheme: supplied.scheme || supplied.debug_target || 'HBuilder',
    archive_path: supplied.archive_path || 'out/uapp_debug.xcarchive',
    export_path: supplied.export_path || 'out',
    export_options: supplied.export_options || 'Main/Resources/export.plist',
    ipa_name: supplied.ipa_name || 'HBuilder.ipa'
  }
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`无效的 iOS 构建配置: ${key}`)
  }
  for (const file of ['Podfile', config.project, config.export_options]) {
    if (!fs.existsSync(path.resolve(appDir, file))) throw new Error(`Pod 构建所需文件不存在: ${file}`)
  }
  return config
}

export function buildIOSWithPods(appDir, { run = execFileSync } = {}) {
  const config = readIOSPodBuildConfig(appDir, { run })
  const options = { cwd: appDir, stdio: 'inherit' }
  run('pod', ['install', '--no-repo-update'], options)
  if (!fs.existsSync(path.resolve(appDir, config.workspace))) {
    throw new Error(`pod install 后未找到 workspace: ${config.workspace}`)
  }
  run('xcodebuild', [
    '-workspace', config.workspace, '-destination', 'generic/platform=iOS',
    '-scheme', config.scheme, '-archivePath', config.archive_path, 'archive'
  ], options)
  run('xcodebuild', [
    '-exportArchive', '-archivePath', config.archive_path,
    '-exportPath', config.export_path, '-exportOptionsPlist', config.export_options
  ], options)
  const ipa = path.resolve(appDir, config.export_path, config.ipa_name)
  if (!fs.existsSync(ipa)) throw new Error(`导出成功但未找到配置的 IPA: ${ipa}`)
  return ipa
}
