import fs from 'fs-extra'
import path from 'node:path'
import { syncAndroidPlugins } from './android-uts.js'

export function isNativePluginPath(relative) {
  return /^uni_modules\/[^/]+\/(?:utssdk(?:\/|$)|app-(?:android|ios|harmony)(?:\/|$))/.test(relative.split(path.sep).join('/'))
}

export function removeEmptyModuleDirectories(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyModuleDirectories(path.join(directory, entry.name))
  }
  if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory)
}

export function syncNativePlugins(compiledDir, appDir, platform) {
  const nativePlatform = `app-${platform}`
  const roots = [path.join(compiledDir, 'uni_modules')]
  // HBuilderX 离线导出将原生插件放在 resources/uni_modules，CLI 编译则放在 www 内。
  if (path.basename(compiledDir) === 'www') {
    roots.push(path.resolve(compiledDir, '../../uni_modules'))
  }

  const plugins = new Map()
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidates = [path.join(root, entry.name, 'utssdk', nativePlatform), path.join(root, entry.name, nativePlatform)]
      for (const source of candidates) {
        if (!fs.existsSync(source)) continue
        if (plugins.has(entry.name)) throw new Error(`重复的 UTS 插件产物：${entry.name}`)
        plugins.set(entry.name, source)
      }
    }
  }

  if (platform === 'android') return syncAndroidPlugins(plugins, appDir)

  const destination = path.join(appDir, 'UTSPlugins')
  const marker = '.uapp-generated'
  if (fs.existsSync(destination)) {
    for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const target = path.join(destination, entry.name, nativePlatform)
      if (!plugins.has(entry.name) && fs.existsSync(path.join(target, marker))) {
        fs.removeSync(target)
        if (fs.readdirSync(path.dirname(target)).length === 0) fs.removeSync(path.dirname(target))
      }
    }
  }

  for (const [id, source] of plugins) {
    const target = path.join(destination, id, nativePlatform)
    fs.removeSync(target)
    fs.copySync(source, target)
    fs.writeFileSync(path.join(target, marker), '')
  }
}
