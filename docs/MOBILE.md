# DrawDream 移动端交付规范

本仓库 **DrawDreamMAX** 的**唯一产品主线**是安卓本地 APK。

| 项 | 约定 |
| --- | --- |
| 交付物 | GitHub Release 签名 `app-release.apk` |
| 运行位置 | 手机本地：内嵌 Node + WebView |
| 业务代码 | `drawdream/src`（UI）+ `drawdream/agent`（运行时） |
| 壳与打包 | `drawdream/mobile` |
| 端口 | **7620**（`/*` · `/api/*` · `/ws`） |
| 当前规范 Release | **`v2.0.0-alpha.1-mobile.70`** |

UI 与 Agent **不是「可删除的网页版副本」**：它们是 APK 内本地 Node 拉起的前端与后端。桌面 `npm run dev` 仅用于构建与联调。

```text
                    ┌─────────────────────────────────────┐
                    │   DrawDream UI  +  Agent Runtime    │
                    │         同源 127.0.0.1:7620          │
                    └───────────────┬─────────────────────┘
                                    │
                                    ▼
                         安卓壳 WebView + jniLibs Node
```

---

## 1. 仓库布局

```text
DrawDreamMAX/
|-- README.md
|-- LICENSE                              # PolyForm Noncommercial 1.0.0
|-- docs/MOBILE.md                       # 本文
|-- .github/workflows/release-apk.yml    # tag v* → 签名 APK
|-- scripts/dev-all.sh
`-- drawdream/
    |-- src/                             # React UI → 打进 runtime ui/
    |-- dist/                            # UI 构建产物（gitignore）
    |-- agent/                           # Agent → 打进 runtime agent/
    |-- mobile/
    |   |-- README.md
    |   |-- scripts/
    |   |   |-- fetch-android-node.mjs
    |   |   |-- prepare-runtime.mjs
    |   |   |-- inject-android-assets.mjs
    |   |   `-- smoke-mobile-env.mjs
    |   |-- android/                     # Gradle com.drawdream.app
    |   `-- runtime/                     # 本地组装（gitignore）
    `-- package.json
```

原则：

- **业务与协议只维护一份**（UI + agent）。
- **平台差异集中在 `drawdream/mobile/`**。
- 大体积产物（`runtime.zip`、`jniLibs/`、Node 二进制）不入库。
- 远程默认分支仅为 **`main`**；当前发布版本为 `mobile.70`，旧版本历史已清理。

---

## 2. 真机执行模型

1. Android 10+ 禁止从 `files/` 执行二进制 → Node 与 `.so` 放入 `jniLibs/arm64-v8a/`，从 `nativeLibraryDir` 启动。
2. `assets/runtime.zip` **只含 agent + ui**；inject 负责 so 改名与 `patchelf`。
3. `packages/*/dist` **不入库**；`prepare-runtime` 用全局 `tsgo` 按序构建 `tui → ai → agent → coding-agent`。
4. agent 树 `rsync -aL` 解引用 symlink；`@drawdream/*` 用实体覆盖。
5. APK 环境：`DD_AUTH_MODE=single`、`DD_ALLOW_REGISTER=0`，本地静默会话。
6. LLM 走用户配置的云端 API。

---

## 3. 用户安装

1. [Releases](https://github.com/RochelimitDawn/DrawDreamMAX/releases) 下载最新 `app-release.apk`
2. 直接覆盖安装，应用保留 App 专属外部目录中的用户数据
3. 启动 → 旧 runtime 先提供界面 → 后台准备新 runtime → 健康检查通过后切换
4. **设置 → API** 填写 Key / 模型

---

## 4. 开发者构建

```bash
cd drawdream
npm install && npm run agent:install
npm run build
npm run mobile:node
npm run mobile:prepare
npm run mobile:smoke    # 期望 [smoke] PASS
```

有 Android SDK + JDK 17：

```bash
cd mobile/android
./gradlew :app:assembleDebug
```

| 命令 | 作用 |
| --- | --- |
| `npm run mobile:node` | 拉取 Termux aarch64 Node |
| `npm run mobile:runtime` | 组装 runtime |
| `npm run mobile:inject` | 写入 jniLibs + runtime.zip |
| `npm run mobile:prepare` | runtime + inject |
| `npm run mobile:smoke` | 桌面 env 冒烟 |

| 变量 | 说明 |
| --- | --- |
| `SKIP_UI_BUILD=1` | 复用已有 `dist/` |
| `SKIP_NODE_DOWNLOAD=1` | 复用已有 Node |
| `SKIP_AGENT_INSTALL=1` | 跳过 `npm ci` |
| `SKIP_AGENT_PACKAGES_BUILD=1` | 跳过 packages 编译（须已有 dist） |

### 4.1 UI 交互规范

- 助手流式生成期间，用户上滑后获得滚动控制权；后续 token 更新保持用户当前阅读位置。
- 用户处于列表底部附近时，助手面板跟随新增内容；用户离开底部后暂停自动贴底。
- 流式消息收尾转为正式消息时，保留用户当前滚动位置。
- Toggle 打开态与关闭态保持一致的外圈视觉，不使用黑色环形阴影。
- LLM 提供商图标在暗色主题下保持可读；彩色品牌图标保留原色，单色图标使用高对比处理。
- 第三方中转、自定义网关和 relay 渠道统一使用 DrawDream 自有 logo，渠道列表、模型列表和当前渠道卡片保持一致。
- 设置页在 `900px` 及以上视口使用 Bento Grid：侧边导航保持稳定，短配置项使用两列卡片，API 渠道与核心操作区使用完整宽度。
- 设置页在 `899px` 及以下视口继续使用移动端分区列表与详情下钻，桌面 Bento 规则不覆盖移动端。
- 设置页 Bento 设计规范与验收记录位于 `.monkeycode/specs/2026-07-27-settings-bento-grid/`。
- 设置页便当盒卡片统一带**左上角主题小图标**，卡片尺寸收紧，左下角采用**向内折角**异形造型（其余角圆角），移动端保持普通圆角卡片。
- 独立向量模型配置为**可折叠卡片**：默认折叠，点击头部展开/收起，头部显示当前渠道与模型摘要。
- 检查更新按钮在 `≥900px` 使用便当盒按钮外观，`≤899px` 使用「learn-more」圆钮展开风格；升级确认对话框使用暖金品牌化面板（描边 + 顶部光晕 + 版本徽章 + Release notes 卡片）。
- 任务清单 / 子拓展折叠区头部不显示脉冲点；子拓展结果以 Markdown 渲染，终态时长固定。
- 主助手对子 agent 结果采用**聚合回传**：全部子 agent 终态后一次性注入，避免逐条完成产生多段对话。
- 设置页「API」提供显式**「探测思考强度」**按钮：默认探测默认模型的真实思考档位，成功后自动应用最低档并启用思考强度控件；渠道无 Key / 模型不支持 / 探测失败均有明确提示。
- 升级确认对话框的 Release notes 使用 **Markdown 渲染**；下载更新时展示**暖金进度条 + 百分比**（`__ddUpdateProgress`），完成后自动关闭并提示。

---

## 5. CI 出包

- 工作流：仓库根 `.github/workflows/release-apk.yml`
- 触发：推送匹配 `v*` 的 tag，或 Actions 页 `workflow_dispatch`
- Secrets：`ANDROID_KEYSTORE_B64` · `ANDROID_KEYSTORE_PASSWORD` · `ANDROID_KEY_ALIAS` · `ANDROID_KEY_PASSWORD`
- 产物：`dist-apk/*.apk` + `SHA256SUMS.txt`；tag 推送时创建 GitHub Release 并挂载 APK

无 keystore 时仍可产出 debug Artifact（不签名）。

### 5.1 发布 checklist

```bash
# 1. 合入 main 并确认 UI build / forge 测试
cd drawdream && npm run build
cd agent && node --test test/forge.test.ts

# 2. 推送 main
git push origin main

# 3. 删除过期 Release/tag（只保留即将发布的一条线）
# gh release delete <old-tag> -y
# git push origin :refs/tags/<old-tag>

# 4. 打 tag 触发 Action
git tag -a v2.0.0-alpha.1-mobile.N -m "v2.0.0-alpha.1-mobile.N — Android APK"
git push origin v2.0.0-alpha.1-mobile.N
```

---

## 6. 打包硬约束

| 约束 | 原因 |
| --- | --- |
| pack 前强制 `tsgo` 构建 packages dist | 缺 `dist/web.js` → `ERR_MODULE_NOT_FOUND` |
| `rsync -aL` + 实体覆盖 `@drawdream/*` | 绝对 symlink 在手机断链 |
| Node / `.so` 进 jniLibs | Android 10+ noexec |
| inject / 解压校验关键文件 | 坏包尽早失败 |
| WebView 文件选择与下载钩子 | 壳内才能唤起系统选择器 |

排障详见 [`drawdream/mobile/README.md`](../drawdream/mobile/README.md)。

---

## 7. 版本与远程仓库策略

| 类型 | 约定 |
| --- | --- |
| 产品版本 | `drawdream/package.json` → `2.0.0-alpha.1` |
| 发布线 | 当前 `v2.0.0-alpha.1-mobile.70` Release |
| 默认分支 | **`main` only** |
| 历史 | 以当前发布 tag 和 mobile.30 稳定基线作为维护依据 |
| 主维护面 | **移动端 APK** |

当前稳定基线：

```bash
git checkout main
git pull
git describe --tags --exact-match
# v2.0.0-alpha.1-mobile.70
```

---

## 8. 相关文档

| 文档 | 内容 |
| --- | --- |
| [根 README](../README.md) | 产品总览、获取 APK、联调 |
| [drawdream/README](../drawdream/README.md) | 包内快速开始 |
| [mobile/README](../drawdream/mobile/README.md) | 安卓构建与真机排障 |
| [agent/EMBEDDED.md](../drawdream/agent/EMBEDDED.md) | 内嵌边界 |
| [agent/MULTI_USER.md](../drawdream/agent/MULTI_USER.md) | 鉴权与数据根（APK 为 single） |

---

## 9. 许可证

全仓库自有代码采用 **[PolyForm Noncommercial 1.0.0](../LICENSE)**（禁止商业用途，详见协议全文）。

- 早期思路曾参考梨园方向；**现行代码为 DrawDream 自研重构成果**。
- 第三方子包许可证以各包内文件为准。
