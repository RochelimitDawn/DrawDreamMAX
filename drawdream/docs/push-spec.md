# DrawDream 推送与发布规范

## 当前发布线

- 产品版本：`2.0.0-alpha.1`
- 安卓 tag 格式：`v2.0.0-alpha.1-mobile.N`
- 默认分支：仅 **`main`**
- CI：推送匹配 `v*` 的 tag 触发 [`.github/workflows/release-apk.yml`](../../.github/workflows/release-apk.yml)
- 远程策略：只保留**最新** `v2.0.0-alpha.1-mobile.*` Release/tag

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
