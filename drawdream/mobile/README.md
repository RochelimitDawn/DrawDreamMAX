# DrawDream Android

Android 壳 + 本地内嵌 Node + 绘梦 UI / Agent。设备上监听 `127.0.0.1:7620`，WebView 打开本地页。

**产品主线即本目录交付的 APK。** UI（`../src`）与 Agent（`../agent`）是 runtime 组成部分，桌面联调仅用于构建。

移动端规范：[docs/MOBILE.md](../../docs/MOBILE.md)

## 结构

```text
mobile/
  scripts/
    fetch-android-node.mjs     # Termux aarch64 Node + so
    prepare-runtime.mjs        # 组装 agent+ui；强制 packages dist
    inject-android-assets.mjs  # jniLibs + assets/runtime.zip
    smoke-mobile-env.mjs       # 桌面冒烟（无需 SDK）
  android/                     # Gradle（com.drawdream.app）
  runtime/                     # prepare 产出（gitignore）
```

## 真机执行模型

1. Android 10+ 禁止从 `files/` 执行二进制 → Node 与依赖 `.so` 放入 `jniLibs/arm64-v8a/`（`libdrawdream_node.so` 等），从 `nativeLibraryDir` 启动。
2. `assets/runtime.zip` **只含 agent + ui**；`inject` 负责 so 改名与 `patchelf --replace-needed`。
3. `packages/*/dist` **不入库**；`prepare-runtime` 在打包前用全局 `tsgo` 按序构建 `tui → ai → agent → coding-agent`，并做 ESM import smoke。
4. agent 树用 `rsync -aL` 解引用 symlink；`node_modules/@drawdream/*` 用 `packages/*` 实体覆盖。
5. 解压后校验 `agent-runtime/dist/web.js` 等关键文件（runtime schema ≥ 4）。

## 快速开始

### 桌面冒烟

```bash
cd drawdream
npm run build
npm run mobile:smoke
# 期望：[smoke] PASS
```

### 组装 runtime 并注入

```bash
cd drawdream
npm run build
npm run mobile:node
npm run mobile:prepare
```

| 命令 | 作用 |
| --- | --- |
| `npm run mobile:node` | 拉取 Termux aarch64 Node |
| `npm run mobile:runtime` | 组装 runtime / tarball |
| `npm run mobile:inject` | 写入 jniLibs + runtime.zip |
| `npm run mobile:prepare` | runtime + inject |
| `npm run mobile:smoke` | 桌面 env 冒烟 |

常用环境变量：

| 变量 | 说明 |
| --- | --- |
| `SKIP_UI_BUILD=1` | 复用已有 `dist/` |
| `SKIP_NODE_DOWNLOAD=1` | 复用已有 Node |
| `SKIP_AGENT_INSTALL=1` | 跳过 `npm ci`（本地已装依赖时） |
| `SKIP_AGENT_PACKAGES_BUILD=1` | 跳过 packages 编译（须已有完整 dist） |
| `FORCE_LINUX_NODE=1` | 强制官方 linux 包（真机通常不可用） |
| `NODE_ARCH=x64` | 本机冒烟打包（不可上真机） |

### 本地打 APK（需 Android SDK + JDK 17）

```bash
cd mobile/android
./gradlew :app:assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

## CI 签名发布

工作流：仓库根 [`.github/workflows/release-apk.yml`](../../.github/workflows/release-apk.yml)

### 生成 keystore（仅一次，永久保管）

```bash
keytool -genkeypair -v \
  -keystore drawdream-release.keystore \
  -alias drawdream-release \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass '你的强密码' \
  -keypass '你的强密码' \
  -dname "CN=DrawDream, OU=Mobile, O=DrawDream, L=Internet, ST=NA, C=CN"
```

```bash
# Linux
base64 -w 0 drawdream-release.keystore > drawdream-release.keystore.b64
```

### GitHub Secrets

| Name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | `.b64` 整段一行 |
| `ANDROID_KEYSTORE_PASSWORD` | storepass |
| `ANDROID_KEY_ALIAS` | `drawdream-release` |
| `ANDROID_KEY_PASSWORD` | keypass |

### 触发

```bash
git tag -a v2.0.0-alpha.1-mobile.N -m "Android release"
git push origin v2.0.0-alpha.1-mobile.N
```

或 Actions → **Release APK** → Run workflow。

产物：Release 资产 `app-release.apk`、`SHA256SUMS.txt`。

## 运行时环境变量（壳注入）

| 变量 | 值 |
| --- | --- |
| `HOST` | `127.0.0.1` |
| `PORT` | `7620` |
| `HOME` | App 专属外部目录 `home` |
| `DRAWDREAM_UI_DIST` | App 专属外部目录 `runtime/releases/<version>/ui` |
| `DRAWDREAM_SKIP_BUILTIN_MODELS` | `1` |
| `DD_DATA_ROOT` | App 专属外部目录 `data` |

## 无缝版本更新

APK 覆盖安装会保留 App 专属外部目录中的用户数据。应用启动时比较 APK 内 `VERSION.json.runtimeId` 与当前 runtime 指针；发现代码变化就解压新 runtime，停止旧 Node 并启动新 Node。新版本通过关键文件校验和 `/healthz` 检查后，壳层切换 Node 并刷新 WebView。`data/` 与 `home/` 目录保持独立，更新过程不覆盖用户数据。

运行时目录结构：

```text
Android/data/com.drawdream.app/files/
├── data/                 # 会话、角色卡、世界书、配置
├── home/                 # Agent HOME 与工作区
├── runtime/releases/     # 按 appVersion 保存的代码
├── runtime/current.json  # 当前 runtimeId 指针
└── backups/              # 预留的数据备份目录
```

更新失败时保留旧 runtime 并自动回退。卸载应用或手动清除应用数据会清除 App 专属外部目录；重要资料应使用应用内导出功能备份到公共 Documents 目录。

更新验收：

1. 使用相同签名证书覆盖安装新 APK。
2. 启动时比较 runtimeId，必要时完成新 runtime 解压和关键文件校验。
3. `data/`、`home/` 和会话文件在更新前后保持可读。
4. 新 runtime 通过 `/healthz` 后切换，失败时继续使用旧 runtime。
5. 新 UI 与 Agent 代码在切换后生效。

## 排障

| 现象 | 处理 |
| --- | --- |
| `error=13 Permission denied`（node） | 确认 Node 在 jniLibs，非 files/bin |
| `ERR_MODULE_NOT_FOUND` … `web.js` | 确认 CI 跑了 packages build；zip 内有 `agent/node_modules/@drawdream/agent-runtime/dist/web.js` |
| symlink / 绝对路径断链 | 确认 prepare 使用 rsync 解引用 + @drawdream 实体覆盖 |
| 升级后仍用旧 runtime | 检查 `VERSION.json.runtimeId`、`runtime/current.json` 与 `logs/agent.log`；确认旧 Node 已停止并重新启动 |
| 首屏红字 | 阅读错误全文与 `agent.log` 尾部，点重试 |
| 导入角色卡/文件无反应 | WebView 须实现 `onShowFileChooser`（见 `MainActivity`）；装最新 APK |
| 导出/下载无文件 | 依赖 `DownloadListener` + blob→`DrawDreamAndroid.saveDataUrl` 钩子；文件进系统「下载」 |

## 注意

1. 仅 `arm64-v8a`；包体可超过 100MB。
2. Agent 本地运行，**LLM 默认仍需网络 API Key**。
3. 无私有 SDK 时本机只做 runtime 打包 + 桌面 smoke；正式 APK 走 GitHub Actions。
