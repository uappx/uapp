/**
 * Author: Yin Qisen <yinqisen@gmail.com>
 * Github: https://github.com/uappx
 *
 * Copyright(c) 2022 - 2026, uapp.dev
 */

import _ from 'lodash'
import nopt from 'nopt'
import updateNotifier from 'update-notifier'
import fs from 'fs'
import ora from 'ora'
import yazl from 'yazl'
import os from 'os'
import path from 'path'
import { execSync, spawnSync, spawn } from 'child_process'
import tiged from '@uappx/tiged'
import chalk from 'chalk'
import sync from './sync.js'
import { hasIOSPodConfig, updateIOSPodConfig, buildIOSWithPods } from './ios-pods.js'
import { readConfig, configCommand } from './config.js'
import stripJsonComments from './stripJsonComments.js'
import fsExtra from 'fs-extra'
const { emptyDirSync, removeSync, pathExistsSync } = fsExtra
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import readline from 'readline/promises'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = require('../package.json')

function normalizeVersionName(versionName) {
  if (versionName === undefined || versionName === null) return versionName
  return String(versionName).split('@')[0]
}

const knownOpts = {
  version: Boolean,
  help: Boolean,
  typescript: Boolean,
  alpha: Boolean,
  vue2: Boolean,
  copy: Boolean,
  open: Boolean,
  webapp: Boolean,
  prepare: Boolean,
  out: path,
  release: String
}

const shortHands = {
  r: '--release',
  o: '--out',
  v: '--version',
  h: '--help'
}

let $G = {
  args: {},
  appDir: process.cwd(),
  sdkHomeDir: path.join(os.homedir(), '.uappsdk'),
  localLinkManifest: path.join(process.cwd(), 'manifest.json'),
  manifest: {},
  webAppDir: '',
  projectType: 'unknown',
  config: {}
}

export default function (inputArgs) {
  checkForUpdates()
  let args = $G.args = nopt(knownOpts, shortHands, inputArgs)

  if (args.version) {
    console.log('uapp 当前版本: ' + pkg.version)
    return
  }

  if (args.copy === undefined) {
    args.copy = true
  }

  if (args.webapp === undefined) {
    args.webapp = true
  }

  if (args.prepare === undefined) {
    args.prepare = true
  }

  // command: uapp help
  const cmd = args.argv.remain[0] || 'help'
  if (!cmd || cmd === 'help' || args.help) {
    printHelp()
    return
  }

  if (cmd === 'privacy') {
    ;(async () => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      try {
        console.log(chalk.yellow('提示: uapp 不承诺协议内容的专业合法性，如您对此有要求，请咨询专业律师起草，并自行替换'))
        const companyFullName = await rl.question('输入公司全名: ')
        const companyShortName = await rl.question('输入公司简称: ')
        const appName = await rl.question('输入APP名字: ')
        const contactUs = await rl.question('输入联系方式: ')

        let regTplFile = path.resolve('./reg.tpl.md')
        let privacyTplFile = path.resolve('./privacy.tpl.md')
        if (!fs.existsSync(regTplFile)) {
          regTplFile = path.resolve(__dirname, '../uappsdk/templates/privacy/reg.tpl.md')
        }

        if (!fs.existsSync(privacyTplFile)) {
          privacyTplFile = path.resolve(__dirname, '../uappsdk/templates/privacy/privacy.tpl.md')
        }

        ;[regTplFile, privacyTplFile].map(file => {
          let content = fs.readFileSync(file, 'utf8')
          content = content.replace(/\$COMPANY_FULL\$/g, companyFullName)
          content = content.replace(/\$COMPANY_SHORT\$/g, companyShortName)
          content = content.replace(/\$APPNAME\$/g, appName)
          content = content.replace(/\$CONTACT_US\$/g, contactUs)

          let newFile = file.replace('.tpl.md', '.md').split('/').pop()
          newFile = path.resolve('./' + newFile)
          fs.writeFileSync(newFile, content)
          console.log(chalk.green(newFile))
        })
      } catch (err) {
        console.log(`Error: `, err)
      } finally {
        rl.close()
      }
    })()
    return
  }

  let configFile = path.join($G.sdkHomeDir, 'config.json')
  if (cmd === 'config') {
    return configCommand(args.argv.original.slice(args.argv.original.indexOf(cmd) + 1), configFile)
  }
  $G.config = readConfig(configFile)

  if (!$G.config['hbx.dir'] && process.platform === 'darwin') {
    $G.config['hbx.dir'] = '/Applications/HBuilderX.app'
  }

  if (!$G.config['wx.dir']) {
    let settingFile = ''
    let defaultPath = ''

    if (process.platform === 'darwin') {
      settingFile = path.join(os.homedir(), 'Library/Application Support/HBuilder X/user/settings.json')
      defaultPath = '/Applications/wechatwebdevtools.app'
    } else if (process.platform === 'win32') {
      settingFile = path.join(os.homedir(), 'AppData/Roaming/HBuilder X/user/settings.json')
      defaultPath = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具'
    }

    try {
      $G.config['wx.dir'] = JSON.parse(fs.readFileSync(settingFile, 'utf8'))['weApp.devTools.path'] || defaultPath
    } catch {
      $G.config['wx.dir'] = defaultPath
    }
  }

  if (cmd === 'hbx') {
    return runHBuilderXCli(args.argv.original.slice(1))
  }

  if (cmd === 'wx') {
    return runWeixinCli(args.argv.original.slice(1))
  }

  // 如果当面目录不存在 manifest.json，尝试使用 ../src/manifest.json
  if (!fs.existsSync($G.localLinkManifest)) {
    let tryManifestFile = path.resolve(path.join($G.appDir, '../src/manifest.json'))
    if (fs.existsSync(tryManifestFile)) {
      $G.localLinkManifest = tryManifestFile
    }
  }

  if (fs.existsSync(path.join($G.appDir, 'Main/AppDelegate.m'))) {
    $G.projectType = 'ios'
  } else if (fs.existsSync(path.join($G.appDir, '/app/build.gradle'))) {
    $G.projectType = 'android'
  } else if (fs.existsSync(path.join($G.appDir, 'pages.json')) && pathExistsSync(path.join($G.appDir, 'pages'))) {
    $G.projectType = 'webapp'
  } else if (
    fs.existsSync(path.join($G.appDir, '/src/pages.json')) &&
    pathExistsSync(path.join($G.appDir, '/src/pages'))
  ) {
    $G.projectType = 'webapp'
    $G.localLinkManifest = path.join(process.cwd(), 'src/manifest.json')
  }

  // command: uapp new
  if (cmd === 'new') {
    let projectName = args.argv.remain[1]
    if (!projectName) {
      return console.log('缺少参数名，例如: uapp new project1')
    }

    if (args.vue2) {
      // vue2 必须使用小写
      let baseCommand = args.alpha
        ? 'vue create -p dcloudio/uni-preset-vue#alpha '
        : 'vue create -p dcloudio/uni-preset-vue '
      try {
        execSync(baseCommand + projectName.toLowerCase(), { stdio: 'inherit' })
      } catch (error) {
        console.log('请先安装 vue 环境:')
        console.log('npm i -g @vue/cli')
      }
    } else {
      clone(`https://gitee.com/uappkit/platform.git/src/#main`, projectName)
    }
    return
  }

  // command: uapp sdk init
  if (cmd === 'sdk' && args.argv.remain[1] === 'init') {
    sync(path.resolve(__dirname, '../uappsdk'), $G.sdkHomeDir, { delete: false })
    console.log(chalk.green('--- uappsdk 已安装 ---'))
    return
  }

  // command: uapp add ${platform}
  // support platforms: android, ios
  if (cmd === 'add') {
    let platform = args.argv.remain[1]
    let supportPlatform = ['android', 'ios']
    if (!supportPlatform.includes(platform)) {
      console.log(`不支持平台 ${platform}, 当前支持的平台有: ${supportPlatform.join(', ')}`)
      return
    }

    return clone(`https://gitee.com/uappkit/platform.git/${platform}#main`, platform)
  }

  /*
  |--------------------------------------------------------------------------
  | 命令分水岭
  | * 上面命令不需要限制项目目录下
  | * 下面命令需要限制在项目下运行
  |--------------------------------------------------------------------------
  */

  if ($G.projectType === 'unknown') {
    console.log('无法确定项目类型，请在项目的根目录下运行命令')
    console.log('目前支持的项目类型有: webapp, android, ios')
    return
  }

  if ($G.projectType === 'webapp' && cmd !== 'run') {
    return console.log('webapp 不支持命令 uapp ' + cmd)
  }

  // command: uapp keygen
  if (cmd === 'keygen') {
    if ($G.projectType === 'android') {
      console.log('注意: ')
      console.log('build.gradle 中密码默认为 123456, 如有修改为其他密码，请对应修改 build.gradle 中的配置')
    }
    console.log('需要输入两次6位密码, 例如输入密码: 123456\n')

    let keyFile = path.join($G.appDir, 'app/app.keystore')
    fs.mkdirSync(path.dirname(keyFile), { recursive: true })

    try {
      let keyCommand =
        'keytool -genkey -alias key0 -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=uapp" -keystore ' + keyFile
      execSync(keyCommand, { stdio: 'inherit' })
      console.log('\n证书生成位置: ' + keyFile)
    } catch (error) {
      console.log('\n错误解决方法, 改名已存在的文件: ' + keyFile)
    }

    return
  }

  // command:
  // uapp manifest path/to/manifest.json
  if (cmd === 'manifest') {
    let manifestFile = args.argv.remain[1]
    if (manifestFile && !fs.existsSync(manifestFile)) {
      console.log('找不到: ' + manifestFile)
      return
    }

    if (manifestFile) {
      $G.localLinkManifest = path.join($G.appDir, '/manifest.json')
      try {
        let fstats = fs.lstatSync($G.localLinkManifest)
        if (fstats.isSymbolicLink()) {
          fs.unlinkSync($G.localLinkManifest)
        } else {
          let backupName = 'manifest-' + new Date().getTime() + '.json'
          console.log('注意：将已存在 manifest.json 文件更名为: ' + backupName)
          fs.renameSync($G.localLinkManifest, $G.localLinkManifest.replace('manifest.json', backupName))
        }
      } catch (error) {}

      fs.symlinkSync(manifestFile, $G.localLinkManifest)
    }

    if (!fs.existsSync($G.localLinkManifest)) {
      console.log('文件不存在: ' + $G.localLinkManifest)
      console.log('配置命令为: uapp manifest path/to/manifest.json')
      return
    }

    loadManifest()
    printManifestInfo()
    return
  }

  // 加载 manifest.json 数据
  loadManifest()
  $G.webAppDir = path.dirname(fs.realpathSync($G.localLinkManifest))

  // command: uapp info, uapp info jwt, uapp info key
  if (cmd === 'info' && (!args.argv.remain[1] || args.argv.remain[1] === 'jwt' || args.argv.remain[1] === 'key')) {
    printManifestInfo()

    if (($G.projectType === 'ios' && !args.argv.remain[1]) || args.argv.remain[1] === 'jwt') {
      printJWTToken().then()
      return
    }

    if ($G.projectType === 'android') {
      let keyFile = path.join($G.appDir, 'app/app.keystore')
      if (!fs.existsSync(keyFile)) {
        console.log('找不到 keystore 签名文件: ' + keyFile)
        return
      }

      let gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
      if (!fs.existsSync(path.resolve(gradle))) {
        console.log('找不到 gradle 命令: ' + gradle)
        return
      }

      printAndroidKeyInfo(gradle)
      return
    }
  }

  // command: uapp prepare
  if (cmd === 'prepare') {
    return (async () => {
      if (!args.argv.remain[1] || !args.argv.remain[1].startsWith('build:app')) {
        process.exitCode = 1
        return console.log(chalk.yellow(`命令无效，${$G.projectType} 工程仅支持 uapp prepare build:app*, 支持自定义扩展且名字必须app开头`))
      }

      if (args.webapp) {
        await buildWebApp(args.argv.remain[1])
      }

      prepareCommand()
    })()
  }

  // command: uapp run custom
  if (cmd === 'run' && args.argv.remain[1] === 'custom') {
    let command = $G.manifest.uapp[`${$G.projectType}.custom.command`] || $G.manifest.uapp['custom.command']
    if (!command) {
      console.log('自定义命令为空，请参照文档中的 custom.command 配置')
    } else {
      command = command.replace(/\$\{SRC\}/g, $G.webAppDir)
      execSync(command, { stdio: 'inherit' })
    }
    return
  }

  // commands:
  // 先判断 projectType, webapp, android, ios
  // webapp 时支持: uapp run dev:* , uapp run build:* , uapp run test:*
  // app 时支持: uapp run build:app* , uapp run test:app-*
  if (cmd === 'run') {
    console.log('当前工程类型为 ' + chalk.yellow($G.projectType + ', vue' + $G.manifest.vueVersion))

    if ($G.projectType !== 'webapp' && $G.args.release?.split('.').pop() === 'wgt') {
      process.exitCode = 1
      return console.log('命令无效，仅支持在 webapp 工程下打包为 wgt格式')
    }

    if (args.argv.remain[1]?.startsWith('test:')) {
      return runUniAppTest(args.argv.remain[1])
    }

    if ($G.projectType === 'webapp') {
      if ($G.args.release && $G.args.release.split('.').pop() !== 'wgt') {
        console.log(chalk.yellow(`webapp 工程下忽略 --release 参数 (${$G.args.release})`))
      }

      let [a, b] = (args.argv.remain[1] || '').split(':')
      if (!['build', 'dev'].includes(a) || !b) {
        process.exitCode = 1
        return console.log('命令无效，webapp 仅支持 uapp run build:* / dev:*, 支持自定义扩展')
      }

      return buildWebApp(args.argv.remain[1])
    }

    if (!args.argv.remain[1] || !args.argv.remain[1].startsWith('build:app')) {
      process.exitCode = 1
      return console.log(chalk.yellow(`命令无效，${$G.projectType} 工程仅支持 uapp run build:app*, 支持自定义扩展且名字必须app开头`))
    }

    return (async () => {
      if (args.prepare) {
        if (args.webapp) {
          await buildWebApp(args.argv.remain[1])
        }

        prepareCommand()
      }

      if ($G.projectType === 'android') {
        let buildType = 'dev'
        if (['apk', 'aab'].includes(args.release)) {
          buildType = args.release
        }

        let assembleTypeMap = {
          'dev': 'assembleDebug',
          'apk': 'assembleRelease',
          'aab': 'bundleRelease'
        }

        let outFileMap = {
          'dev': 'apk/debug/app-debug.apk',
          'apk': 'apk/release/app-release.apk',
          'aab': 'bundle/release/app-release.aab'
        }

        let gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
        execSync(gradle + ` ${assembleTypeMap[buildType]} -s`, { stdio: 'inherit' })
        let buildOutFile = path.join($G.appDir, 'app/build/outputs/', outFileMap[buildType])
        checkBuildArtifact(buildOutFile)

        if (buildType === 'dev' && args.copy) {
          sync(buildOutFile, path.join($G.webAppDir, 'unpackage/debug/android_debug.apk'), { delete: true })
        }

        console.log('\n编译成功，安装包位置: ')
        console.log(buildOutFile)
        return
      }

      if ($G.projectType === 'ios') {
        let ipaFile = path.join($G.appDir, 'out/HBuilder.ipa')
        if (hasIOSPodConfig($G.appDir)) {
          ipaFile = buildIOSWithPods($G.appDir)
        } else {
          try {
            execSync('xcodegen', { stdio: 'inherit' })
          } catch (e) {
            process.exitCode = e.status || 1
            console.log('请先安装 xcodegen, 可通过 brew install xcodegen 安装, 参考 iOS 配置文档: ')
            console.log('👉 https://gitee.com/uappkit/platform/blob/main/ios/README.md')
            return
          }

          const name = fs.readFileSync(path.join($G.appDir, '/project.yml'), 'utf8').match(/^name:\s*(\S+)/m)[1]
          // gererate uapp_debug.xcarchive
          execSync(
            `xcodebuild -project ${name}.xcodeproj -destination "generic/platform=iOS" -scheme "HBuilder" -archivePath out/uapp_debug.xcarchive archive`,
            { stdio: 'inherit' }
          )

          // generate ipa
          execSync(
            'xcodebuild -exportArchive -archivePath out/uapp_debug.xcarchive -exportPath out -exportOptionsPlist config/export.plist',
            { stdio: 'inherit' }
          )
        }

        checkBuildArtifact(ipaFile)
        if (args.copy) {
          sync(
            ipaFile,
            path.join($G.webAppDir, 'unpackage/debug/ios_debug.ipa'),
            { delete: true }
          )
        }

        console.log(chalk.yellow('iOS 仅支持自定义基座打包，正式发版请直接使用 xcode'))
      }
    })()
  }

  printHelp()
}

function checkForUpdates() {
  try {
    // Checks for available update and returns an instance
    const notifier = updateNotifier({ pkg: pkg })

    if (notifier.update && notifier.update.latest !== pkg.version) {
      // Notify using the built-in convenience method
      notifier.notify()
    }
  } catch (e) {
    // https://issues.apache.org/jira/browse/CB-10062
    if (e && e.message && /EACCES/.test(e.message)) {
      console.log('Update notifier was not able to access the config file.')
    } else {
      throw e
    }
  }
}

function checkManifest() {
  if (!fs.existsSync($G.localLinkManifest)) {
    console.log('请先执行 `uapp manifest path/to/manifest.json` 指定 manifest.json 文件')
    process.exit(1)
  }
}

function loadManifest() {
  checkManifest()
  console.log('当前使用 manifest: ' + $G.localLinkManifest)

  if (fs.existsSync($G.localLinkManifest)) {
    let content = fs.readFileSync($G.localLinkManifest, 'utf8')
    $G.manifest = JSON.parse(stripJsonComments(content))
  }

  if (!$G.manifest.vueVersion) {
    $G.manifest.vueVersion = 2
  }

  const runArg = $G.args.argv.remain[1] || ''
  if (
    !['android', 'ios'].includes($G.projectType) &&
    (
      $G.args.argv.remain[0] === 'run' &&
      (runArg.startsWith('test:') || !runArg.includes(':app'))
    )
  ) {
    return
  }

  if (!$G.manifest.appid) {
    console.log(chalk.yellow('manifest.json 中缺少 appid，请打开 HBuilderX 获取'))
  }

  if (!$G.manifest.uapp) {
    console.log(chalk.yellow('manifest.json 中缺少 uapp 节点，请复制并添加如下内容'))
    console.log(`
"uapp": {
  "name": "uapp",
  "package": "com.code0xff.uapp",
  "android.appkey": "申请并替换为 android dcloudkey",
  "ios.appkey": "申请并替换为 ios dcloudkey"
},
    `)
    process.exit(1)
  }

  $G.manifest.uapp.name = $G.manifest.uapp[`${$G.projectType}.name`] || $G.manifest.uapp.name || $G.manifest.name
  $G.manifest.uapp.package = $G.manifest.uapp[`${$G.projectType}.package`] || $G.manifest.uapp.package || ''
  $G.manifest.uapp.versionName = $G.manifest.uapp[`${$G.projectType}.versionName`] ?? $G.manifest.uapp.versionName ?? $G.manifest.versionName
  $G.manifest.uapp.versionCode = $G.manifest.uapp[`${$G.projectType}.versionCode`] ?? $G.manifest.uapp.versionCode ?? $G.manifest.versionCode
  $G.manifest.uapp.appkey = $G.manifest.uapp[`${$G.projectType}.appkey`] || ''

  // 缺失的参数，默认使用模版里的
  $G.manifest = _.merge(require(path.join($G.sdkHomeDir, '/templates/manifest.json')), $G.manifest)
}

function checkBuildArtifact(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error('未找到构建产物文件: ' + file)
  }
}

function prepareCommand() {
  let compiledDir = getBuildOut()
  if (!pathExistsSync(compiledDir) || !fs.statSync(compiledDir).isDirectory()) {
    console.log(chalk.red('找不到本地App打包资源'))
    console.log('请使用 HBuilderX => 发行(菜单) => 原生App本地打包 => 生成本地打包App资源')
    process.exit(1)
  }

  let resDir = path.join($G.webAppDir, 'unpackage/res/icons')
  // 如果没生成过图标目录, 跳过
  if (pathExistsSync(resDir)) {
    if ($G.projectType === 'android') {
      updateAndroidIcons(resDir)
    } else if ($G.projectType === 'ios') {
      updateIOSIcons(resDir)
    }
  } else {
    console.log(chalk.yellow('未发现图标资源，跳过App图标更新'))
    console.log('更新图标请使用 HBuilderX => manifest.json 配置 => App图标配置 => 自动生成所有图标\n')
  }

  if ($G.projectType === 'android') {
    updateAndroidMetaData()
  } else if ($G.projectType === 'ios') {
    updateIOSMetaData()
  }

  let embedAppsDir = path.join(
    $G.appDir,
    $G.projectType === 'ios' ? 'Main/Pandora/apps' : 'app/src/main/assets/apps'
  )

  emptyDirSync(embedAppsDir)
  sync(compiledDir, path.join(embedAppsDir, $G.manifest.appid, 'www'))
  console.log(chalk.green('APP打包所需资源已更新'))
}

/*
 * android platform
 */

function updateAndroidMetaData() {
  let wxEntryActivityFile = 'WXEntryActivity.java'
  let wXPayEntryActivityFile = 'WXPayEntryActivity.java'
  let versionName = normalizeVersionName($G.manifest.uapp.versionName)

  let baseGradleFile = path.join($G.appDir, 'app/build.gradle')
  let content = fs.readFileSync(baseGradleFile, 'utf8')

  content = content.replace(/(namespace\s*(?:=\s*)?")(.*)(")/, '$1' + $G.manifest.uapp.package + '$3')
  content = content.replace(/(applicationId\s*(?:=\s*)?")(.*)(")/, '$1' + $G.manifest.uapp.package + '$3')
  content = content.replace(/(app_name'\s*,\s*")(.*)(")/, '$1' + $G.manifest.uapp.name + '$3')
  content = content.replace(/(versionCode\s*(?:=\s*)?)(\d+)/, '$1' + $G.manifest.uapp.versionCode)
  content = content.replace(/(versionName\s*(?:=\s*)?")(.*)(")/, '$1' + versionName + '$3')
  content = content.replace(/("DCLOUD_APPKEY"\s*:\s*")(.*)(",)/, '$1' + $G.manifest.uapp.appkey + '$3')

  content = content.replace(
    /("WX_APPID"\s+:\s+")(.*)(",)/,
    '$1' + $G.manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appid + '$3'
  )

  content = content.replace(
    /("WX_SECRET"\s+:\s+")(.*)(",)/,
    '$1' + $G.manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appsecret + '$3'
  )
  fs.writeFileSync(baseGradleFile, content)

  // DONT change content here
  let contentOfEntryFiles = {
    [wxEntryActivityFile]: `package ${$G.manifest.uapp.package}.wxapi;
import io.dcloud.feature.oauth.weixin.AbsWXCallbackActivity;
public class WXEntryActivity extends AbsWXCallbackActivity {
}
`,
    [wXPayEntryActivityFile]: `package ${$G.manifest.uapp.package}.wxapi;
import io.dcloud.feature.payment.weixin.AbsWXPayCallbackActivity;
public class WXPayEntryActivity extends AbsWXPayCallbackActivity{
}
`
  }

  for (const entryFile of [wxEntryActivityFile, wXPayEntryActivityFile]) {
    let replaceFile = path.join(
      $G.appDir,
      'app/src/main/java/',
      $G.manifest.uapp.package.replace(/\./g, '/'),
      'wxapi',
      entryFile
    )

    fs.mkdirSync(path.dirname(replaceFile), { recursive: true })
    fs.writeFileSync(replaceFile, contentOfEntryFiles[entryFile])
  }

  replaceControlXml(path.join($G.appDir, 'app/src/debug/assets/data/dcloud_control.xml'))
  replaceControlXml(path.join($G.appDir, 'app/src/main/assets/data/dcloud_control.xml'))

  console.log('✅ updateAndroidMetaData')
}

function updateAndroidIcons(resDir) {
  const iconFile = path.join(getIconResourceDir(resDir), '144x144.png')
  sync(
    iconFile,
    path.join($G.appDir, 'app/src/main/res/drawable-xxhdpi/icon.png')
  )
  console.log('✅ updateAndroidIcons')
}

function getIconResourceDir(resDir) {
  const keepIcons = path.join($G.appDir, 'icons')
  return fs.existsSync(keepIcons) && fs.statSync(keepIcons).isDirectory() ? keepIcons : resDir
}

/*
 * ios platform
 */

function updateIOSMetaData() {
  if (hasIOSPodConfig($G.appDir)) {
    updateIOSPodConfig($G.appDir, $G.manifest, $G.sdkHomeDir)
  } else {
    let baseYamlFile = path.join($G.appDir, 'config/base.yml')
    let content = fs.readFileSync(baseYamlFile, 'utf8')
    let versionName = normalizeVersionName($G.manifest.uapp.versionName)

    content = content.replace(/(PRODUCT_BUNDLE_IDENTIFIER: )(.*)/, '$1' + $G.manifest.uapp.package)
    content = content.replace(/(MARKETING_VERSION: )(.*)/g, '$1' + versionName)
    content = content.replace(/(CURRENT_PROJECT_VERSION: )(.*)/g, '$1' + $G.manifest.uapp.versionCode)
    fs.writeFileSync(baseYamlFile, content)

    replaceStoryboard(path.join($G.appDir, 'Main/Resources/LaunchScreen.storyboard'))
    replaceStoryboard(path.join($G.appDir, 'Main/Resources/LaunchScreenAD.storyboard'))

    replaceInfoPlist(path.join($G.appDir, 'Main/Resources/AppDev/Info.plist'))
    replaceInfoPlist(path.join($G.appDir, 'Main/Resources/AppRelease/Info.plist'))

    replaceControlXml(path.join($G.appDir, 'Main/Resources/AppDev/control.xml'))
    replaceControlXml(path.join($G.appDir, 'Main/Resources/AppRelease/control.xml'))
  }

  let sdkLinkDir = path.join($G.appDir, '/SDKs/SDK')
  if (!fs.existsSync(sdkLinkDir)) {
    let iosSDKDir = path.join($G.sdkHomeDir, '/ios/SDK')
    if (!fs.existsSync(iosSDKDir)) {
      console.log('找不到iOS SDK，请参照 README 配置')
      console.log('SDK 位置: ' + iosSDKDir)
    } else {
      fs.symlinkSync(path.join($G.sdkHomeDir, '/ios/SDK'), sdkLinkDir, 'dir')
    }
  }

  console.log('✅ updateIOSMetaData')
}

function replaceStoryboard(storyboardFile) {
  let content = fs.readFileSync(storyboardFile, 'utf8')
  const re = /(text=")(.+?)(".+)(?=uapp-launchscreen-appname)/
  content = content.replace(re, '$1' + $G.manifest.uapp.name + '$3')
  fs.writeFileSync(storyboardFile, content)
}

function replaceInfoPlist(plistFile) {
  let content = fs.readFileSync(plistFile, 'utf8')
  let re = /(<key>dcloud_appkey<\/key>\n.+?<string>)(.*?)(<\/string>)/g
  content = content.replace(re, '$1' + $G.manifest.uapp.appkey + '$3')

  // replace ios and wexin meanwhile
  re = /(<key>UniversalLinks<\/key>\n.+?<string>)(.*?)(<\/string>)/g
  content = content.replace(re,
    '$1' + $G.manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.UniversalLinks + '$3')

  re = /(<key>weixin<\/key>[\s\S]+?appid<\/key>\n.+?<string>)(.*?)(<\/string>)/g
  content = content.replace(re, '$1' + $G.manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appid + '$3')

  re = /(<string>weixin<\/string>\n.+?<key>CFBundleURLSchemes<\/key>[\s\S]+?<string>)(.*?)(<\/string>)/g
  content = content.replace(re, '$1' + $G.manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appid + '$3')

  re = /(<key>weixin<\/key>[\s\S]+?appSecret<\/key>\n.+<string>)(.*?)(<\/string>)/g
  content = content.replace(re, '$1' + $G.manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appsecret + '$3')

  re = /(<key>CFBundleDisplayName<\/key>\n.+?<string>)(.*?)(<\/string>)/g
  if (!re.test(content)) {
    console.error('no CFBundleDisplayName, you should use xcode set Display Name first')
    process.exit(1)
  }

  content = content.replace(re, '$1' + $G.manifest.uapp.name + '$3')
  fs.writeFileSync(plistFile, content)
}

function replaceControlXml(xmlFile) {
  let sdkControlFile = path.join($G.sdkHomeDir, '/ios/SDK/control.xml')
  let innerSDKVersion = '1.0.0'
  if (fs.existsSync(sdkControlFile)) {
    let content = fs.readFileSync(sdkControlFile, 'utf8')
    innerSDKVersion = content.match(/<HBuilder.+version="(.*)"/)[1] || innerSDKVersion
  }

  let content = fs.readFileSync(xmlFile, 'utf8')
  let re = /(app appid=")(.+?)(")/g
  content = content.replace(re, '$1' + $G.manifest.appid + '$3')
  content = content.replace(/(<HBuilder.+version=")(.*)(")/, '$1' + innerSDKVersion + '$3')

  fs.writeFileSync(xmlFile, content)
}

function updateIOSIcons(resDir) {
  const iconResourceDir = getIconResourceDir(resDir)
  let iconFiles = fs.readdirSync(iconResourceDir)
  iconFiles.forEach(function (file) {
    if (!file.endsWith('.png')) return
    // skip android icons
    if (['72x72.png', '96x96.png', '144x144.png', '192x192.png'].includes(file)) return

    const fullPath = path.join(iconResourceDir, file)
    sync(fullPath, path.join($G.appDir, '/Main/Resources/Images.xcassets/AppIcon.appiconset/', file), { delete: true })
  })

  sync(path.join(iconResourceDir, '120x120.png'), path.join($G.appDir, 'Main/Resources/logo@2x.png'))
  sync(path.join(iconResourceDir, '180x180.png'), path.join($G.appDir, 'Main/Resources/logo@3x.png'))
  console.log('✅ updateIOSIcons')
}

function printManifestInfo() {
  console.log()
  console.log('- appid       : ' + $G.manifest.appid)
  console.log('- appName     : ' + $G.manifest.uapp.name)
  console.log('- package     : ' + $G.manifest.uapp.package)
  console.log('- versionName : ' + $G.manifest.uapp.versionName)
  console.log('- versionCode : ' + $G.manifest.uapp.versionCode)
  if ($G.manifest.uapp.appkey) {
    console.log('- appKey      : ' + $G.manifest.uapp.appkey)
  }

  // for uniapp project
  console.log()
  console.log(`👇 DCloud 开发者后台配置 dcloud_appkey (uapp.${$G.projectType}.appkey): `)
  console.log('https://dev.dcloud.net.cn/pages/app/detail/info?tab=package&appid=' + $G.manifest.appid)
  console.log()
}

// generate jwt token for apple oauth login
async function printJWTToken() {
  console.log('------ JWT Token ------')
  try {
    const configPath = path.join($G.appDir, 'jwt/config.json')
    let config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    if (!config.team_id) {
      let content = fs.readFileSync(path.join($G.appDir, 'config/custom.yml'), 'utf8')
      let r = content.match(/DEVELOPMENT_TEAM:\s+(.*)/)
      config.team_id = r[1] || ''
    }

    if (!config.team_id) {
      throw '请在 jwt/config.json 中设置 team_id'
    }

    let privateKey = fs.readFileSync(path.join($G.appDir, 'jwt/key.txt'))
    let headers = { kid: config.key_id }
    let timestamp = Math.floor(Date.now() / 1000)
    let claims = {
      iss: config.team_id,
      iat: timestamp,
      exp: timestamp + 86400 * 180,
      aud: 'https://appleid.apple.com',
      sub: config.client_id
    }

    const jwt = await import('jsonwebtoken')
    let token = jwt.default.sign(claims, privateKey, { algorithm: 'ES256', header: headers })
    console.log(token)
  } catch (error) {
    console.log(error.message + '\n')
    console.log('jwt/config.json 内容参考: ')
    console.log(`
{
    "team_id": "3DSM494K6L",
    "client_id": "com.code0xff.uapp.login",
    "key_id": "3C7FMSZC8Z"
}
    `)
  }

  console.log()
  console.log('👉 参考教程: http://help.jwt.code0xff.com')
}

function printAndroidKeyInfo(gradle) {
  let output = execSync(gradle + ' app:signingReport').toString()
  let r
  if (output.indexOf('Invalid keystore format') > 0) {
    r = output.match(/Error: ([\s\S]+?)\n----------/)
    console.log('签名文件错误: ' + r[1])
    console.log('问题可能因为创建 app.keystore 时使用的java版本和当前不一致，可更换java版本后再尝试')
    console.log('\n------ 当前java版本 ------')
    return execSync('java -version', { stdio: 'inherit' })
  }

  r = output.match(/Variant: release[\s\S]+?----------/)
  let md5 = r[0].match(/MD5: (.+)/)[1].replace(/:/g, '')
  let sha1 = r[0].match(/SHA1: (.+)/)[1]
  console.log('👇 应用签名 (MD5), 用于微信开放平台:')
  console.log(md5)
  console.log()
  console.log('👇 Android 证书签名 (SHA1), 用于离线打包 Key:')
  console.log(sha1)

  console.log()
  console.log('----------')
  console.log(r[0])
}

function printHBuilderXDirNotFound() {
  console.log('找不到 HBuilderX 安装路径')
  console.log('配置 HBuilderX 环境命令: ' + chalk.yellow('uapp config set hbx.dir [path/to/HBuilderX]'))
}

function resolveHBuilderXDir(options = {}) {
  const { useInternalDir = true, exitOnMissing = true } = options
  let hbxDir = $G.config['hbx.dir']
  if (!hbxDir || !fs.existsSync(hbxDir)) {
    printHBuilderXDirNotFound()
    process.exitCode = 1
    if (exitOnMissing) process.exit(1)
    return ''
  }

  const internalDir = path.join(hbxDir, 'Contents/HBuilderX')
  if (useInternalDir && process.platform === 'darwin' && fs.existsSync(internalDir)) {
    return internalDir
  }

  return hbxDir
}

function buildWebApp(buildArg) {
  let hbxDir = resolveHBuilderXDir()
  let node = path.join(hbxDir, 'plugins/node/node')
  if (process.platform === 'win32') {
    node = node + '.exe'
  }

  if (!fs.existsSync(node)) {
    node = $G.config.node
  }

  if (!node || !fs.existsSync(node)) {
    console.log('找不到 node 位置: ' + node)
    console.log('配置 node: ' + chalk.yellow('uapp config set node [path/to/node]'))
    process.exit(1)
  }

  let flag = buildArg.startsWith('build') ? 'build' : ''
  let isWeixin = buildArg.endsWith('mp-weixin')

  let vue = 'vue2'
  let spawnArgs = []
  let spawnOpts = { stdio: 'pipe' }
  let buildScript
  const buildName = buildArg.split(':')[1]

  if (Number($G.manifest.vueVersion) === 3) {
    vue = 'vue3'
    buildScript = path.join(hbxDir, 'plugins/uniapp-cli-vite/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js')
    spawnArgs = [buildScript, flag, '-p', buildName]
  } else {
    buildScript = path.join(hbxDir, 'plugins/uniapp-cli/bin/uniapp-cli.js')
    process.env.NODE_PATH = path.join(hbxDir, 'plugins/uniapp-cli/node_modules')
    spawnOpts.cwd = process.env.VUE_CLI_CONTEXT = process.env.UNI_CLI_CONTEXT = path.join(hbxDir, 'plugins/uniapp-cli')
    spawnArgs = [buildScript]
  }

  process.env.UNI_PLATFORM = require(path.join($G.webAppDir, 'package.json'))?.['uni-app']?.['scripts']?.[buildName]?.['env']?.UNI_PLATFORM ?? buildName

  if (!fs.existsSync(buildScript)) {
    console.log(chalk.yellow(`HBuilderX 需要安装插件 => uni-app (${vue}) 编译器`))
    process.exit(1)
  }

  let buildOutDir = getBuildOut()
  process.env.HX_Version = '3.x'
  process.env.HX_APP_ROOT = process.env.APP_ROOT = hbxDir
  process.env.UNI_INPUT_DIR = $G.webAppDir
  process.env.UNI_OUTPUT_DIR = buildOutDir
  process.env.NODE_ENV = flag === 'build' ? 'production' : 'development'

  return new Promise((resolve, reject) => {
    let p = spawn(node, spawnArgs, spawnOpts)
    p.on('error', reject)
    let first = false

    p.stdout.on('data', data => {
      data = data.toString()
      if (data.indexOf('DONE') > -1 && data.indexOf('Build complete') > 0) {
        first = true
        process.stdout.write(chalk.green(data))
      } else {
        process.stdout.write(data)
      }

      if ($G.args.open && isWeixin && first) {
        first = false
        runWeixinCli(['open', '--project', buildOutDir])
      }
    })

    let errOut = ''
    p.stderr.on('data', data => {
      process.stderr.write(chalk.red(data))
      errOut += data.toString()
    })

    p.on('close', code => {
      if (code !== 0 || errOut.indexOf('failed with errors') > -1 || errOut.indexOf('Missing platform') > -1) {
        return reject(Object.assign(new Error('Web 编译失败'), { exitCode: code || 1 }))
      }

      if (['build', 'app'].every(v => $G.args.argv.remain[1].includes(v)) && $G.args.release?.split('.').pop() === 'wgt') {
        let releaseDir = path.join($G.webAppDir, 'unpackage/release')
        fs.mkdirSync(releaseDir, { recursive: true })
        let wgtFile = path.join(releaseDir, path.basename($G.args.release))
        zipDirectory(buildOutDir, wgtFile).then(() => {
          console.log('\n打包成功, wgt 文件路径: ')
          console.log(wgtFile)
          resolve()
        }).catch(reject)
      } else {
        resolve()
      }
    })
  })
}

function getBuildOut() {
  if ($G.args.out) {
    return $G.args.out
  }

  let buildArg = $G.args.argv.remain[1]
  let isDev = buildArg.startsWith('dev:')
  let relativeDir = ''

  if (buildArg.startsWith('build:app')) {
    relativeDir = 'unpackage/resources/' + $G.manifest.appid + '/www'
  } else if (isDev) {
    relativeDir = 'unpackage/dist/dev/' + buildArg.split(':')[1]
  } else {
    relativeDir = 'unpackage/dist/build/' + buildArg.split(':')[1]
  }

  return path.join($G.webAppDir, relativeDir)
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile()

    function addDir(dir, base) {
      const files = fs.readdirSync(dir)
      for (const file of files) {
        const fullPath = path.join(dir, file)
        const relativePath = path.relative(base, fullPath)
        const stat = fs.statSync(fullPath)

        if (stat.isDirectory()) {
          addDir(fullPath, base)
        } else {
          zipfile.addFile(fullPath, relativePath, { compress: false })
        }
      }
    }

    addDir(sourceDir, sourceDir)
    const output = fs.createWriteStream(outPath)
    zipfile.outputStream.pipe(output).on('close', () => { resolve() }).on('error', reject)
    zipfile.end()
  })
}

const uniAppTestTargets = {
  'web-chrome': { platform: 'h5-chrome', browser: 'chromium', info: 'web chrome' },
  'web-firefox': { platform: 'h5-firefox', browser: 'firefox', info: 'web firefox' },
  'web-safari': { platform: 'h5-safari', browser: 'webkit', info: 'web safari' },
  'mp-weixin': { platform: 'mp-weixin' },
  'app-android': { platform: 'android', os: 'android', uniPlatform: 'app-plus' },
  'app-ios-simulator': { platform: 'ios', os: 'ios', uniPlatform: 'app-plus' },
  'app-ios': { platform: 'ios', os: 'ios', uniPlatform: 'app-plus' },
  'app-harmony': { platform: 'harmony', os: 'harmony', uniPlatform: 'app-harmony' }
}

function runUniAppTest(testArg) {
  const testName = testArg.split(':')[1]
  const target = uniAppTestTargets[testName]
  if (!target) {
    process.exitCode = 1
    console.log(`不支持测试平台 ${testName}, 当前支持的平台有: ${Object.keys(uniAppTestTargets).join(', ')}`)
    return
  }

  const options = parseUniAppTestArgs($G.args.argv.original.slice(2))
  if (options.project) {
    $G.webAppDir = path.resolve(options.project)
  }

  return runUniAppJestTest({ ...target, name: testName }, options)
}

function parseUniAppTestArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue
    const [key, value] = args[i].slice(2).split(/=(.*)/s)
    if (value !== undefined) {
      options[key] = value
    } else if (args[i + 1] && !args[i + 1].startsWith('--')) {
      options[key] = args[++i]
    } else {
      options[key] = true
    }
  }
  return options
}

function runUniAppJestTest(target, options = {}) {
  const hbx = resolveHBuilderXRuntime()
  const projectPath = path.resolve($G.webAppDir)
  const envFile = path.join(projectPath, 'env.js')
  const deviceId = getUniAppTestDeviceId(options)

  ensureUniAppTestConfig(projectPath, hbx)
  updateUniAppTestDevice(envFile, target, deviceId, hbx)

  const jestConfigSource = getJestConfigSource(projectPath)
  const outputFile = getUniAppTestReportFile(projectPath, target.platform, deviceId)
  const env = {
    HOME: process.env.HOME,
    PATH: ['./node_modules/.bin', process.env.PATH, path.dirname(hbx.node)].filter(Boolean).join(path.delimiter),
    NODE_PATH: [
      hbx.testNodeModules,
      hbx.compilerNodeModules,
      process.env.NODE_PATH,
    ].filter(Boolean).join(path.delimiter),
    NO_COLOR: true,
    UNI_CLI_PATH: hbx.uniCliPath,
    UNI_INPUT_DIR: projectPath,
    UNI_AUTOMATOR_CONFIG: envFile,
    UNI_PLATFORM: target.uniPlatform || (target.platform.startsWith('h5-') ? 'h5' : target.platform),
    HX_Version: hbx.version,
    uniTestProjectName: path.basename(projectPath),
    uniTestPlatformInfo: target.info || target.platform,
    UNI_AUTOMATOR_PORT: options.port || 9520,
    HX_CONFIG_ADB_PATH: $G.config['adb.path'] || '',
    UNIAPPX_KOTLIN_COMPILER_MEMORY: $G.config['uniappx.kotlin.compiler.memory'] || 2048,
    NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072',
    UNI_NODE_PATH: hbx.node,
    ...loadUniTestCustomEnv(envFile)
  }

  if (target.os) env.UNI_OS_NAME = target.os
  if (target.browser) {
    env.BROWSER = target.browser
  }
  if (deviceId && target.os) env.UNI_AUTOMATOR_DEVICE_ID = deviceId
  if (options.debug) env.DEBUG = 'automator:*'

  const cmd = [
    hbx.jest,
    '-i',
    '--forceExit',
    '--json',
    `--outputFile=${outputFile}`,
    `--env=${hbx.automatorEnv}`,
    `--globalTeardown=${hbx.automatorTeardown}`
  ]
  if (!hasJestConfigOption(jestConfigSource, 'transform')) {
    cmd.push('--transform', JSON.stringify(getDefaultJestTransform(hbx)))
  }
  if (!hasJestConfigOption(jestConfigSource, 'moduleNameMapper')) {
    cmd.push('--moduleNameMapper', JSON.stringify({
      '^~?@/(.*)$': path.join(projectPath, '$1'),
    }))
  }
  if (options.testcaseFile) {
    const testFile = path.join(projectPath, options.testcaseFile)
    if (!fs.existsSync(testFile)) {
      console.log('测试用例文件不存在: ' + testFile)
      process.exit(1)
    }
    cmd.push(options.testcaseFile)
  }

  const p = spawn(hbx.node, cmd, { cwd: projectPath, env, stdio: 'inherit' })
  p.on('close', code => {
    process.exit(code ?? 1)
  })
  p.on('error', error => {
    console.log(error.message)
    process.exit(1)
  })
}

function resolveHBuilderXRuntime() {
  let hbxDir = resolveHBuilderXDir()
  let node = path.join(hbxDir, 'plugins/node/node')

  if (process.platform === 'win32') node += '.exe'
  if (!fs.existsSync(node)) node = $G.config.node

  if (!node || !fs.existsSync(node)) {
    console.log('找不到 node 位置: ' + node)
    console.log('配置 node: ' + chalk.yellow('uapp config set node [path/to/node]'))
    process.exit(1)
  }

  const versionFile = path.join(hbxDir, 'plugins/about/package.json')
  const uniCliPath = path.join(hbxDir, Number($G.manifest.vueVersion) === 3 ? 'plugins/uniapp-cli-vite' : 'plugins/uniapp-cli')
  const testPluginPath = path.join(hbxDir, 'plugins/hbuilderx-for-uniapp-test')
  const testLibPath = path.join(hbxDir, 'plugins/hbuilderx-for-uniapp-test-lib')
  const runtime = {
    dir: hbxDir,
    node,
    version: fs.existsSync(versionFile) ? require(versionFile).version.split('.').slice(0, 2).join('.') : '3.x',
    uniCliPath,
    testPluginPath,
    testLibPath,
    testNodeModules: path.join(testLibPath, 'node_modules'),
    compilerNodeModules: path.join(uniCliPath, 'node_modules'),
    jest: path.join(testLibPath, 'node_modules/jest/bin/jest.js'),
    automatorEnv: path.join(uniCliPath, 'node_modules/@dcloudio/uni-automator/dist/environment.js'),
    automatorTeardown: path.join(uniCliPath, 'node_modules/@dcloudio/uni-automator/dist/teardown.js')
  }

  ensureUniAppTestDependency(runtime.testPluginPath, [
    '未找到 HBuilderX 自动化测试插件 hbuilderx-for-uniapp-test。',
    '请通过 HBuilderX 插件市场安装「uni-app自动化测试」插件。',
    '插件地址: https://ext.dcloud.net.cn/plugin?id=5708'
  ])
  ensureUniAppTestDependency(runtime.testLibPath, [
    '未找到 HBuilderX 自动化测试依赖库 hbuilderx-for-uniapp-test-lib。',
    '该目录由「uni-app自动化测试」插件初始化测试环境时创建。',
    '请在 HBuilderX 中点击菜单【运行 - uni-app自动化测试辅助插件 - 重装测试环境依赖】。'
  ])
  ensureUniAppTestDependency(runtime.jest, '未找到 HBuilderX 内置 Jest，请在 HBuilderX 中点击菜单【运行 - uni-app自动化测试辅助插件 - 重装测试环境依赖】。')
  ensureUniAppTestDependency(runtime.automatorEnv, '未找到 uni-automator environment.js，请确认 uni-app 编译器插件安装完整。')
  ensureUniAppTestDependency(runtime.automatorTeardown, '未找到 uni-automator teardown.js，请确认 uni-app 编译器插件安装完整。')

  return runtime
}

function getJestConfigSource(projectPath) {
  const configFile = path.join(projectPath, 'jest.config.js')
  return fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : ''
}

function hasJestConfigOption(configSource, option) {
  return new RegExp(`\\b${option}\\s*:`).test(configSource)
}

function getDefaultJestTransform(hbx) {
  return {
    '^.+\\.js$': [
      require.resolve('babel-jest', { paths: [hbx.testLibPath] }),
      {
        plugins: [require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [hbx.uniCliPath] })],
      },
    ],
  }
}

function ensureUniAppTestDependency(file, message) {
  if (fs.existsSync(file)) return
  console.log('找不到 HBuilderX 自动化测试依赖: ' + file)
  ;(Array.isArray(message) ? message : [message]).forEach(line => console.log(line))
  process.exit(1)
}

function ensureUniAppTestConfig(projectPath, hbx) {
  for (const file of ['env.js', 'jest.config.js']) {
    const targetFile = path.join(projectPath, file)
    if (fs.existsSync(targetFile)) continue
    const templateFile = path.join(hbx.testPluginPath, 'src/template', file)
    if (!fs.existsSync(templateFile)) {
      console.log('找不到 HBuilderX 自动化测试模板: ' + templateFile)
      process.exit(1)
    }
    sync(templateFile, targetFile, { delete: true })
    console.log(chalk.green('已创建自动化测试配置: ' + targetFile))
  }
}

function getUniAppTestReportFile(projectPath, testPlatform, deviceId) {
  const reportDir = path.join(projectPath, '.hbuilderx/test-report', testPlatform)
  fs.mkdirSync(reportDir, { recursive: true })
  const pad = value => String(value).padStart(2, '0')
  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
  return path.join(reportDir, `${deviceId ? deviceId + '-' : ''}${timestamp}.json`)
}

function loadUniTestCustomEnv(envFile) {
  try {
    delete require.cache[require.resolve(envFile)]
    const envConfig = require(envFile)
    return _.isPlainObject(envConfig?.UNI_TEST_CUSTOM_ENV) ? envConfig.UNI_TEST_CUSTOM_ENV : {}
  } catch {
    return {}
  }
}

function getUniAppTestDeviceId(options) {
  return options.device_id || options['device-id'] || options.deviceId || ''
}

function updateUniAppTestDevice(envFile, target, deviceId, hbx) {
  const testPlatform = target.platform
  if (!['android', 'ios', 'harmony'].includes(testPlatform)) return
  try {
    delete require.cache[require.resolve(envFile)]
    const envConfig = require(envFile)
    const appPlusPath = ['app-plus']
    if (!_.isPlainObject(_.get(envConfig, appPlusPath))) {
      _.set(envConfig, appPlusPath, {})
    }

    if (deviceId) {
      _.set(envConfig, [...appPlusPath, testPlatform, 'id'], deviceId)
    }
    if (!envConfig['is-custom-runtime']) {
      _.set(envConfig, [...appPlusPath, testPlatform, 'executablePath'], getUniAppTestLauncherPath(hbx.dir, target))
      _.set(envConfig, [...appPlusPath, 'version'], path.join(hbx.dir, 'plugins/launcher/base/version.txt'))
    }

    fs.writeFileSync(envFile, 'module.exports = ' + JSON.stringify(envConfig, null, 4))
  } catch {
    console.log(envFile + ' 测试配置文件, 可能存在语法错误，请检查。')
    process.exit(1)
  }
}

function getUniAppTestLauncherPath(hbxDir, target) {
  const launcherBase = path.join(hbxDir, 'plugins/launcher/base')
  if (target.platform === 'android') return path.join(launcherBase, 'android_base.apk')
  if (target.platform === 'ios') {
    return path.join(launcherBase, target.name === 'app-ios' ? 'iPhone_base.ipa' : 'Pandora_simulator.app')
  }
  return $G.config['harmony.devTools.path'] || ''
}

function runToolCli(cli, args) {
  const result = spawnSync(cli, args, { stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.error || result.signal || result.status !== 0) {
    process.exitCode = result.status || 1
  }
  return result
}

function runHBuilderXCli(args) {
  const hbxDir = resolveHBuilderXDir({ useInternalDir: false, exitOnMissing: false })
  if (!hbxDir) return

  let cli = 'cli'
  if (process.platform === 'darwin') {
    if (fs.existsSync(path.join(hbxDir, '../MacOS/cli'))) {
      cli = '../MacOS/cli'
    } else {
      cli = 'Contents/MacOS/cli'
    }
  }
  cli = path.join(hbxDir, cli)

  if (process.platform === 'win32') {
    cli = cli + '.exe'
  }

  console.log(cli)
  return runToolCli(cli, args)
}

function runWeixinCli(args) {
  let cli = process.platform === 'darwin' ? 'Contents/MacOS/cli' : 'cli'
  cli = path.join($G.config['wx.dir'], cli)

  if (process.platform === 'win32') {
    cli = cli + '.bat'
  }

  if (!fs.existsSync(($G.config['wx.dir']))) {
    process.exitCode = 1
    console.log('找不到微信安装路径')
    return console.log('配置微信环境命令: ' + chalk.yellow('uapp config set wx.dir [path/to/weixin]'))
  }

  console.log(cli)
  return runToolCli(cli, args)
}

function clone(url, projectName) {
  const spinner = ora()
  spinner.start('正在下载中，请稍后...')
  tiged(url, { cache: true, force: false, verbose: true })
    .on('info', info => {
      spinner.succeed(info.message)
    })
    .clone(projectName)
}

function printHelp() {
  console.log(fs.readFileSync(path.join(__dirname, '../doc/help.txt'), 'utf8'))
}
