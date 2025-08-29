![uapp.dev](https://raw.githubusercontent.com/zencodex/art/refs/heads/main/logo.png)

## uapp 能做什么

```js
// what's uapp
const uapp = 'universal app'
```

uapp源自跨平台开发的最佳实践, 通过集成 uni-app, electron, tauri，让开发者仅需维护一套代码，就能横扫所有平台。

uapp支持所有的手机端(android, ios)，支持所有的电脑端(windows, mac osx, linux)，支持所有的小程序，浏览器插件等等。

uapp让Web开发者能搞更多事情，会H5就可以无限制重构一切软件。

- [x] 开发微信小程序时，仅运行 `uapp run dev:mp-weixin --open`，就能生成小程序代码，并直接打开微信开发者工具加载。
- [x] 开发APP离线基座，仅运行 `uapp run build:app`，就能生成自定义基座安装包，且自动发布到 hbx 工程下面直接使用。
- [x] `uapp info` 可以查看包名, 签名 md5, dcloudkey, jwt 等开发中用到的各种信息。

多一个平台，就多了一个流量渠道，多一个平台，就多个用户选择的理由，而做这些事，仅需维护一套代码。哪怕只开发一个平台，同样花时间写代码，为什么不选择复用价值更高的方法呢。

## 一、先安装 uappsdk

1、 安装 uapp 命令

```bash
npm install -g uapp

# 初始化或更新 uappsdk
uapp sdk init
```

2、下载 uniapp 离线打包的 SDK

> 注意和.uappsdk区分开，此处的uniapp离线包的SDK是指dcloud 官方发布的

**android 离线打包SDK:**

<https://nativesupport.dcloud.net.cn/AppDocs/download/android>

**ios 离线打包SDK:**

<https://nativesupport.dcloud.net.cn/AppDocs/download/ios>

解压其中的SDK目录，放入 .uappsdk 文件夹里，最终 .uappsdk 文件夹结构如下:

```
> $HOME/.uappsdk/
.
├── android
│   ├── SDK # -> 这里是Android的SDK
├── ios
│   ├── SDK # -> 这里是iOS的SDK
└── templates
    └── manifest.json
```

> SDK 相关文件都放在当前用户的 $HOME/.uappsdk 目录下。

需要引入哪些模块，请务必仔细阅读官方的 SDK 模块依赖说明，模块多了会影响APP审核，少了会影响功能使用。

android和ios工程模版仅含有微信授权登录，苹果授权登录，支付等一些基础功能。不包含广告、通知等相关依赖，因为广告和通知类的模块，在审核时需要特别提交数据跟踪说明，比较麻烦。

如不是必须，最好不包含。如果确实需要，可以自行手动添加，参照如下模块依赖说明。

**android 模块依赖说明:**

针对 android，将依赖的包名放入工程目录 `app/sdk.libs` 文件内，每个包名一行。
<https://nativesupport.dcloud.net.cn/AppDocs/usemodule/androidModuleConfig/android_Library>

**ios 模块依赖说明:**

<https://nativesupport.dcloud.net.cn/AppDocs/usemodule/iOSModuleConfig/common>

## 二、webapp 工程 (重点看) 🔥

### webapp 工程下小程序及H5直接编译

```bash
uapp run dev:h5
uapp run dev:mp-weixin
uapp run build:h5
uapp run build:mp-weixin

# electron 为自定义环境
# 自定义环境教程：https://uniapp.dcloud.net.cn/collocation/package.html
uapp run build:electron
```

👇 **uapp 编译微信小程序并打开工程**

![mp-weixin build](https://uappx.oss-cn-hangzhou.aliyuncs.com/repo/weixin.gif)

其他更多命令，可直接参考：

<https://gitee.com/dcloud/uni-preset-vue/blob/vite/package.json>

### webapp 工程的创建及配置

第一种：通过 `uapp new` 新建工程，使用 `uapp-webapp` 模版。

`uapp-webapp` 模版里集成了 unocss/tailwindcss, uvui。自带网络请求配置，可直接使用 uni.$uv.http，使用方法，可以参考模版里自带的 README 文档:  
<https://gitee.com/uappkit/platform/tree/main/src>

```bash
# 默认使用 uapp-webapp 模版
uapp new YourProject
```

第二种，通过 HBuilderX 菜单里新建工程，使用官方自带模版。

**创建好 webapp 工程后，一定要参照下面流程，获取 appid，和添加 uapp 节点。**

☘️ HBuilderX 打开工程，再选中 manifest.json 配置

- (必须) 基础配置 => 确定获取到 appid
- (必须) 源码视图 => versionCode 下面添加 uapp 节点，内容如下：

```json5
{
  // ...
  "versionCode": "100",
  "uapp": {
    "name": "uapp",
    "package": "com.code0xff.uapp",
    "android.appkey": "申请并替换为 android dcloudkey",
    "ios.appkey": "申请并替换为 ios dcloudkey"
  },
  // ...
}
```

- (建议) App图标配置 => 浏览选择图标文件 => 自动生成

- (建议) App模块配置 => OAuth 登录鉴权 => (微信登录, iOS Universal Links)

> 👉 `dcloudkey` 后台申请的链接，和要填写的内容，可通过 `uapp info` 命令查看，非常方便。

## 三、离线打包工程

例如有个 demo1 项目，想将 android, ios, webapp 源码放在一起，可参考如下目录结构:

```bash
# 保持这个目录结构和名字，就不需要 `uapp manifest` 命令来定位 src 下的 manifest.json

  demo1
      ├── android  # android 源码 (uapp add android)
      ├── ios      # ios 源码 (uapp add ios)
      └── src      # webapp 源码 (可以 uapp new webapp 后，再改名为 src)
```

### 1. 新建 android 工程

`uapp add android`

👇 **uapp 离线打包并发布 Android 自定义基座**

![android build](https://uappx.oss-cn-hangzhou.aliyuncs.com/repo/android.gif)

### 2. 新建 ios 工程

`uapp add ios`

> 如果当前目录已有 android 或 ios 目录，会提示错误，可将其改名后，再执行命令

iOS 的工程化一直都不太方便，通常都是用的 CocoaPods，但不适合 DCloud离线SDK 的发布形式。经过我们在产品中的不断实践，最终选择了 XCodeGen。

👇 **uapp 离线打包并发布 iOS 自定义基座**

![ios build](https://uappx.oss-cn-hangzhou.aliyuncs.com/repo/ios.gif)

### 3. 离线工程下常见命令

> 注意：uapp 从 3.0 开始，放弃了 run build / run build:dev，和 uniapp 一致，方便自定义扩展。

命令格式为 `uapp run build:app*`，vue2 工程用 `uapp run build:app-plus`。必须是 app 开头, 非 app 类型，如 H5 没有这个限制。

自定义扩展，package.json 中添加:

```json5
// 如何使用自定义命令：
// uapp run build:app-codex

{
  "uni-app": {
    "scripts": {
      // app-codex 这里必须是 app 开头, 非 app 类型，如 H5 没有这个限制
      "app-codex": {
        "title": "自定义命令",
        "browser": "",
        "env": {
          "UNI_PLATFORM": "app",
          "CUSTOM_ENV": "123456"
        }
      }
    }
  }
}
```

其他一些命令参考:

```bash
# 读取 manifest 中的配置，并更新基本信息
uapp manifest path/to/manifest.json

# 查看 dcloudkey 和对接第三方平台需要的信息
uapp info

# 更新 HBuilderX 生成的App图标和本地打包资源
uapp prepare build:app

# 编译APP安装包, 并发布自定义基座到 HBuilderX 下
uapp run build:app

# 打包为 uapp.wgt, 名字可改
uapp run build:app -r uapp.wgt

# vue2 要使用 app-plus，与 uniapp 一致
uapp run build:app-plus

# 编译 android apk 格式
uapp run build:app -r apk

# 编译 android aab 格式 (发布到 Google Play)
uapp run build:app -r aab

# 运行自定义打包发布流程，配置见 manifest.json => custom.command
uapp run custom
```

## 四、manifest.json 相关配置

> 注意: `uapp.* 参数` 是 uapp 根据需要扩展出来的, 非 dcloud 官方标准.

原工程里的 `manifest.json` 内的参数，大多是给 hbuiderx 在线云打包用的。编译后生成的终极发布包，里面的 manifest.json 已被去除了无关数据，所以不用担心参数暴露问题。

```json
{
  "name": "uapp",
  "appid": "__UNI__ECA8F4D",
  "versionName": "1.0.1",
  "versionCode": "1000000",
  "uapp": {
    "name": "uapp",
    "package": "com.code0xff.uapp",
    "android.appkey": "b4ab7d1c668cbb3b257aeeabd75c29da",
    "ios.appkey": "aa215ff1522abe39cb7ccec5943eeb92",
    "custom.command": "cd ${SRC}/../android && uapp run build:app && node publish_apk.js"
  },
  "app-plus": {
    "distribute": {
      "sdkConfigs": {
        "oauth": {
          "weixin": {
            "appid": "wx95039516c9f72e50",
            "appsecret": "123456",
            "UniversalLinks": "https://uapp.code0xff.com/"
          }
        }
      }
    }
  }
}
```

### 🔥 uapp.* 参数说明

👉 不同平台可以用前缀区分

<blockquote>
name, package, versionName, versionCode 如果需要平台差异化定义, 可以加前缀 android.*, ios.*

例如 android.name, android.package, ios.package, ios.versionCode ...

custom.command 参数内，可以使用 `${SRC}, ${SRC}` 为当前 manifest.json 的同级目录，支持加 ../定位上一级目录，避免用绝对路径。
</blockquote>

👇👇 👇

| uapp.* 参数      | 说明                                                                                     |
|:---------------|----------------------------------------------------------------------------------------|
| name           | APP名字，不填写默认使用根节点的name。不同平台可以加前缀区分，如 android.name                                       |
| package        | 应用的包名。不同平台可以加前缀区分，如 ios.package                                                        |
| android.appkey | DCloud平台申请的，Android 平台 dcloud_appkey，下方有申请地址                                           |
| ios.appkey     | DCloud平台申请的，iOS 平台 dcloud_appkey，下方有申请地址                                               |
| versionName    | App版本名，同上可以加前缀区分不同平台。如 android.versionName                                             |
| versionCode    | App版本Code，同上可以加前缀区分不同平台。如 ios.versionCode                                              |
| custom.command | (选填) uapp run custom 执行的自定义命令。比如一条命令里做很多事: `uapp run build:app && node publish_apk.js` |

## 五、其他参考

### 生成用户注册协议，隐私协议

`uapp privacy`

具体参考: [privacy/README.md](uappsdk/templates/privacy/readme.md)

### iOS 苹果授权登录

1、获取到 team_id, client_id, key_id 填入到 jwt/config.json 中，如下：

```json
{
  "team_id": "3DSM494K6L",
  "client_id": "com.code0xff.uapp.login",
  "key_id": "3C7FMSZC8Z"
}
```

2、登录苹果开发者账号，创建并下载签名文件， 改名为jwt/key.txt。

3、运行 `uapp info` 命令查看 JWT Token

👉 参考教程: <http://help.jwt.code0xff.com>

### 如何申请 dcloud_appkey

<https://nativesupport.dcloud.net.cn/AppDocs/usesdk/appkey>

### 如何申请微信 appid

登录微信开发者平台创建APP，审核过后，获取 `weixin.appid, weixin.appsecret` 等参数，用于微信登录，分享，支付等相关参数

<https://open.weixin.qq.com/>

### 跨端开发注意事项

<https://uniapp.dcloud.io/matter.html>

## 六、Win / Mac / Linux 等桌面应用开发

桌面应用可以将 uniapp 编译成 H5，再集成到 electron 或 tauri 中。当需要扩展系统能力时，相关方法如下：

### electron 如何扩展

electron集成了node，可通过`node-gyp`的方法扩展。API 自带了丰富的系统能力，能够满足据绝大多数应用，文档参考如下：

<https://www.electronjs.org/docs/latest/api/app>

> 优点: 对前端没学习难度，会node就行。node能做的，electron也都能做，可充分利用node生态。
>
> 缺点: electron 由于集成了 Chromium，生成安装包很大，动不动就100M上下。

### tauri 如何扩展

tauri是基于`rust`开发，可以通过`rust`生态来扩展，`v2`还处在alpha阶段，新增了手机端支持。`v1`的参考文档如下：

<https://tauri.app/v1/api/js/>

> 优点: 由于利用了系统内嵌的webview，生成安装包很小，通常几M。很方便通过 rust 语言扩展，能充分利用 rust 生态。
>
> 缺点: webview 每个系统下略有差异，UI细节可能不一致。tauri 推出时间短，生态不如 electron 健全，用 rust 也有较高的学习成本，如果不在乎 size，首推 electron

👇 uapp 基于 Electron 桌面应用案例

![electron demo](https://uappx.oss-cn-hangzhou.aliyuncs.com/repo/electron.gif)

---

## uapp 使用帮助

见 [doc/help.txt](doc/help.txt)

## License

The Apache License 2. Please see [License File](LICENSE.md) for more information.

## 联系作者

如果你在使用 uapp 中，遇到问题，或有改进建议，欢迎联系

+作者vx: 28451307
