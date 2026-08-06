# DrawDream 推送与发布规范

## 当前发布线

- 产品版本：`2.0.0-alpha.1`
- 安卓 tag 格式：`v2.0.0-alpha.1-mobile.N`
- 默认分支：仅 **`main`**
- CI：推送匹配 `v*` 的 tag 触发 [`.github/workflows/release-apk.yml`](../../.github/workflows/release-apk.yml)
- 远程策略：只保留**最新** `v2.0.0-alpha.1-mobile.*` Release/tag

## mobile.69 变更摘要

1. **更新日志 Markdown 渲染**
   - 升级确认对话框的 Release notes 由纯文本改为 Markdown 渲染（`RichMessage mdOnly`），支持标题/列表/加粗/代码块/引用等
   - `UpdateChecker.css` 新增 `.update-notes-md` 容器样式（标题层级、代码块、引用）

2. **更新下载进度条**
   - `AppUpdater.downloadAndInstall` 增加 `onProgress: (Float) -> Unit`（0..1）；`httpDownload` 按块读取并每变化 1% 报告一次
   - `MainActivity` JS 桥新增 `window.__ddUpdateProgress(pct)` 与 `window.__ddUpdateDownloadDone(ok, msg)` 回调，下载完成由前端统一 toast（移除 Kotlin 侧 toast 避免重复）
   - 前端 `UpdateChecker`：下载中弹框切换为暖金进度条 + 百分比 + 「正在下载更新」标题，确认/取消按钮锁定；完成自动关闭并提示，失败显示错误
   - i18n 新增 `updateDownloadingTitle`/`updateDownloading`/`updateReady`/`updateFail`（zh/en）

3. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.69` 触发 APK workflow

## mobile.68 变更摘要

1. **思考强度显式探测（模型设置页）**
   - 新增 `POST /api/models/probe-thinking`（`RestHost.probeThinking`）：显式探测默认模型（缺省）或指定模型的真实思考档位，同步等待探测完成
   - 成功即写入会话期缓存并自动应用最低可用档位（排除 off），返回 `reason` 供前端提示：`probe`/`cache`/`no-config`/`no-reasoning`/`probe-fail`
   - `selectModel` 静默探测重构复用 `runThinkingProbe` + `applyLowestThinkingLevel`
   - 设置页 API tab 新增「探测思考强度」面板：显示当前默认模型，按钮触发探测，成功/失败结果内联展示并同步思考控件与可用档位
   - `agent/test/rest-host-models.test.ts` 新增 3 用例（无默认模型抛错 / no-reasoning / no-config），5/5 通过

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.68` 触发 APK workflow

## mobile.67 变更摘要

1. **子 agent 结果聚合**
   - 主助手不再逐条接收子 agent 完成/失败消息（消除多段对话）：`server/assistant.ts` 改为聚合缓冲，全部子 agent 终态后一次性汇总注入主助手会话，由主助手整合进最终回复
   - 流式中自动排队（followUp），flush 期间新完成的结果继续补一次汇总

2. **设置页便当盒升级**
   - 所有便当盒卡片左上角新增主题小图标（`settings-item-icon`），链接卡（GitHub/Releases）追加跳转标记
   - 卡片尺寸收紧（min-height 112→84，main flex-basis 修复为 auto，Slider 卡不再被拉伸为 140px 方形）
   - 左下角改为向内折角异形卡片（`::after` 渐变折角 + 折痕斜线），其余角保持圆角
   - 向量模型配置改为可折叠卡片（`vector-card`，默认折叠，点击头部展开/收起，显示当前配置摘要）

3. **检查更新按钮 / 升级对话框**
   - 手机端（≤899px）检查更新按钮改 Uiverse「learn-more」圆钮展开风格，触屏常驻展开态；平板/桌面（≥900px）保持便当盒按钮外观
   - 升级确认对话框品牌化：暖金描边 + 顶部光晕，下载徽章 + 版本号 chip + Release notes 卡片化（`ConfirmDialog` 新增 `panelClassName`）

4. **交互细节**
   - 移除任务清单 / 子拓展折叠按钮右侧脉冲点
   - 子拓展结果改为 Markdown 渲染（RichMessage mdOnly）、终态时长固定

5. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.67` 触发 APK workflow

## mobile.66 变更摘要

1. **自动更新（GitHub Releases API）**
   - 原生 Kotlin `AppUpdater`：请求 `releases/latest` 解析 tag（`v2.0.0-alpha.1-mobile.N`）与 `app-release.apk` / `SHA256SUMS.txt` 资产，与当前 `versionName` 对比
   - 启动后延迟静默检查（仅新版本存在时提示）；设置页「关于」提供手动「检查更新」
   - 下载 APK 到应用缓存，对照 `SHA256SUMS.txt` 校验 SHA-256，通过后经 FileProvider 拉起系统安装器
   - 权限：`REQUEST_INSTALL_PACKAGES`；JS 桥 `checkUpdate` / `downloadUpdate`
   - 前端全局 `UpdateChecker`：检测到新版本弹确认对话框（版本号 + Release notes + 下载并安装），已最新/不支持环境 Toast

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.66` 触发 APK workflow

## mobile.65 变更摘要

1. **子拓展（Subagent）并行编排**
   - 助手可派发多个后台子 agent 并行执行独立子任务（进程内独立 AgentSession，`server/subagent-host.ts`）
   - 复用任务清单面板新增「子拓展」实时状态区：状态彩点/名称/任务/时长，完成可展开结果；状态经 `assistant_subagents` 帧实时推送
   - 子 agent 完成/失败结果自动回传主助手整合；并发上限配置 `subagents.maxConcurrent`（默认 2）
   - 参考：pi-interactive-subagents（异步子 agent 模型，不使用终端 pane）

2. **对话框玻璃态升级**
   - 主对话与助手对话框参考 LiveAgent composer-glass-card：半透明 + 背景模糊 + 饱和度提升 + 顶部 rim-light 高光 + 内 gloss 渐变 + 聚焦品牌光晕
   - 圆角由胶囊（22px/19px）收窄为方框微圆角（12px/10px），扩大可读空间；保留原有胶囊展开/聚焦/浮动面板动效
   - 工具按钮聚焦环 + 激活小圆点；textarea 不支持 backdrop-filter，毛玻璃置于父容器 `.dd-composer-field`

3. **向量模型与对话模型分开配置**
   - 设置页新增独立「向量模型」区块（选择渠道 + 该渠道向量模型，保存打 `kind=embedding`）；渠道编辑区仅保留对话模型
   - `GET /api/models` 对话模型列表自动排除 `kind=embedding` 向量模型

4. **思考档位自动应用**
   - 选中默认对话模型 / 聊天页切换模型时自动触发思考档位探测，成功后自动应用最低可用档位（排除 off）以降低 token 消耗
   - 探测完成有 Toast 提示（设置页与聊天页）；同一模型会话期内不重复探测，仅探测失败（报错）时重探

5. **修复**
   - 助手过程区 / 任务清单展开折叠按钮改用 lucide 图标（原 ▸/▾ 字符渲染为一点）
   - 工具调用条流式宽度对齐（`width: fit-content` → `100%` + 与 tool-call-list 一致的上限）

6. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.65` 触发 APK workflow

## mobile.64 变更摘要

1. **助手输入条贴底（flex 列布局）**
   - 助手面板由 CSS Grid 改为 flex 列：消息流 `flex: 1 1 0` 独占剩余空间并内部滚动，输入条/顶栏/任务清单 `flex-shrink: 0`
   - 横屏/竖屏短视口下输入条不再被挤出屏幕，也不再遮挡消息内容
   - 空对话时输入条始终贴底，不再悬浮于面板中部

2. **头像暖金配色**
   - 消息/历史/顶部助手头像渐变统一为暖金（accent-gold → brand → brand-deep），替换原近黑棕/深灰蓝
   - 助手生成中的 3D spinner SVG 填充改为暖金 `#d4a017`

3. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.64` 触发 APK workflow

## mobile.63 变更摘要

1. **思考强度自动探测**
   - 借鉴 frakiowork capability-probe：对渠道发最小 chat 请求，按 `reasoning_effort` 探测 off/low/medium/high，按 api 类型适配请求体
   - `availableLevels` 以探测结果优先，10 分钟 TTL 缓存 + 防重入；失败/未完成回退内置目录
   - 思考按钮点击后原地向上展开浮动面板，当前档位高亮，切换即关，外部/Esc 关闭

2. **思考/工具交错时间线**
   - `ProcessTimeline` 组件：`thinking` 段与工具调用按到达顺序交错展示，相邻重复工具折叠 ×n
   - 主对话与助手流式按到达顺序构建 `streamTimeline` 并落泡保存；历史消息回退旧分组

3. **助手与任务清单 UI**
   - 助手侧栏布局修复：高瘦屏下输入栏不再被挤出、顶栏不再被推出屏幕
   - `todo_write` 清单支持折叠为单行（标题/进度/进行中徽标）
   - 助手生成时卡片头像展示暖金双层 3D spinner（reduced-motion 回退静态）

4. **向量模型（Embedding）配置**
   - 设置页渠道编辑可指定向量模型（`kind='embedding'`），记忆/世界书启用向量召回，留空回退纯词法
   - `ChannelPublic.models` 增加 `kind` 字段

5. **环境页优化**
   - 参考 1Panel 增加运行时/端口/工具就绪/数据占用概览条与工具链状态圆点

6. **联网搜索单路/多路修复**
   - 工具描述改为「模式由用户设置决定」；`execute` 中 `mode` 强制取 `config.smartSearch.mode`，忽略模型自主选择

7. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.63` 触发 APK workflow

## mobile.39 变更摘要

1. **酒馆兼容内核**
   - 完成 Tavern Context、事件、TavernHelper、MVU、消息快照、swipe 和分支状态恢复
   - 完成 Prompt Pipeline、宏、World Info、Regex、Depth Prompt、Author Note 和差分测试
   - 完成受控原卡 iframe DOM、资源解析、外部模块授权和 Agent 活动节点

2. **运行时稳定性**
   - Hybrid Coordinator 将 Agent、工具、搜索和来源作为独立 Prompt sections
   - Android WebView 仅保留 `127.0.0.1:7620` 和 `localhost:7620` 本地导航
   - 外部模块授权按角色卡 fingerprint 隔离并持久化

3. **发布验证**
   - `npm run release:gate`
   - 关键兼容测试、Agent 类型检查、生产构建和 `git diff --check`
   - tag `v2.0.0-alpha.1-mobile.39` 触发 APK workflow

4. **UI 与流式稳定性**
   - `StatusPlaceHolderImpl` 在聊天消息中转换为状态面板
   - 工具中间轮不再清空当前流式气泡，最终消息按 stream ID 原子替换

## 历史发布摘要

### mobile.36

1. **酒馆兼容基础链路**
   - 角色卡读取 `extensions.regex_scripts`，仅执行受限的显示期替换
   - 聊天页支持直接导入 SillyTavern JSONL，并写入可继续对话的导入消息
   - 导入保留 `send_date`、`extra`、`variables`、`metadata`、swipes 和原始正文 sidecar
   - MVU 变量当前采用无损保留策略，变量命令和消息级回放快照列入后续阶段

2. **设置页与消息显示**
   - 桌面/平板设置页改为章节流与稳定 Bento 内部网格
   - 修复 Advanced 标题跨列、长区块半宽和控件挤压
   - 修复重复生成、RP 流式标签闪动与助手侧栏滚动

3. **联网搜索**
   - 本轮联网开关直接控制模型工具 schema
   - 世界时间使用 60 秒 TTL 缓存
   - 支持双语查询规划、单路排序、多路 RRF 融合、正文去重和来源平衡

4. **发布验证**
   - Agent 兼容层专项测试
   - 前端 `npm run build`
   - Agent `npx tsc --noEmit`
   - `git diff --check`
   - tag `v2.0.0-alpha.1-mobile.36` 触发 APK workflow

### mobile.30

1. **卡皮肤依赖清理**
   - 删除酒馆卡前端美化皮肤逻辑、控件、配置字段、REST 路由和相关测试
   - 删除 `body.load` 外链美化、HTML proxy 和 SillyTavern 兼容依赖

2. **移动端与渠道体验**
   - 移动端上下文面板恢复可点击并居中显示
   - 自定义中转渠道始终使用 DrawDream Logo
   - Toggle 恢复黑白配色
   - 修复助手生成前后滚动层级与 flex 高度

3. **Android 与角色卡**
   - Android 桌面、通知和启动页统一使用关于页 DrawDream Logo
   - 角色卡删除增加文件存在性校验并清空卡元信息缓存

4. **消息显示**
   - 抉择选项标题和正文复用 Markdown 渲染，支持 `**加粗**`
   - 保留普通 `show_html` 安全 iframe 渲染

5. **继承能力**
   - 设置精简、接口地址预览、ChatComposer 和透明品牌资源
   - 静默档门禁、状态账本 `chapter`、粘性章节条

6. **发布验证**
   - 前端 `npm run build`
   - `git diff --check`
   - tag `v2.0.0-alpha.1-mobile.30` 触发 APK workflow

## 文档布局

| 路径 | 用途 |
| --- | --- |
| 根 `README.md` | 产品总览、APK 获取、联调 |
| `docs/MOBILE.md` | 移动端架构与打包 |
| `drawdream/README.md` | UI + Agent 子项目入口 |
| `drawdream/docs/push-spec.md` | 本文件：发布与本版变更 |
| `drawdream/docs/pi-intercom-dual-agent-design.md` | Ledger 双轨设计 |

## 打 tag 打包

```bash
git checkout main
git pull
git tag -a v2.0.0-alpha.1-mobile.N -m "Android release mobile.N"
git push origin v2.0.0-alpha.1-mobile.N
```

或 GitHub Actions → Release APK → Run workflow。

Secrets：`ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`。

## 本地联调

```bash
cd drawdream
cp agent/drawdream.agent.example.json agent/drawdream.agent.json
cp agent/drawdream.config.example.json agent/drawdream.config.json
npm install && npm run agent:install
npm run dev
```

默认 `http://127.0.0.1:7620`。勿提交带 Key 的 `drawdream.agent.json`。

## 验证清单

1. 明/暗主题对比度；对话正文刻本宋
2. 窄屏：设置下钻、对话托盘、历史/助手全屏感
3. 普通 `show_html` 内容保持安全 iframe 隔离
4. tag 推送后 Actions 产出 `app-release.apk`（有 keystore 时）
