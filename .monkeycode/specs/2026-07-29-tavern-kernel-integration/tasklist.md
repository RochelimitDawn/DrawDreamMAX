# 酒馆兼容内核实施任务

Release: `v2.0.0-alpha.1-mobile.38`

所有代码侧任务已完成。Android 真机、离线重启和 GitHub Actions APK 产物验证在发布环境执行。

## Kernel Foundation

- [x] 建立 `TavernContext`、事件总线和运行时模式类型
- [x] 实现 MVU 变量路径操作、事务校验和 revision 冲突检测
- [x] 为消息模型增加稳定 ID、session revision 和 event sequence
- [x] 编写 Kernel Foundation 单元测试

## Runtime Bridge

- [x] 建立角色卡 Runtime Manifest 和能力诊断模型
- [x] 将 Runtime Manifest 接入角色卡 REST 投影
- [x] 接入 Tavern Context、MVU 和消息发送 Bridge
- [x] 实现变量更新与事件订阅回传
- [x] 扩展 Card Bridge 协议与 bootstrap
- [x] 将 `CardHtmlFrame` 升级为 `TavernFrameHost`
- [x] 实现 frame source、token、capability 和 request/response 校验
- [x] 编写原卡 UI Bridge 单元测试

## Prompt Compatibility

- [x] 实现宏替换和基础 Prompt sections
- [x] 将扩展宏引擎接入现有 Director Prompt
- [x] 扩展 Regex placement、capture、trim 和 trace
- [x] 接入 Prompt Assembly 的 Regex 阶段
- [x] 接入 World Info、Depth Prompt、Author Note 和 Prompt sections
- [x] 将 World Info 激活和 Prompt Regex 接入实际 Agent 生成路径
- [x] 编写 Prompt Pipeline 差分测试

## TavernHelper and MVU

- [x] 暴露 TavernHelper facade 基础 API
- [x] 接入受控 Slash Command adapter
- [x] 接入消息读取和消息创建 facade
- [x] 接入叶消息更新和删除 facade
- [x] 接入 MVU schema、变量事务和消息快照
- [x] 实现 swipe、分支和回档状态恢复
- [x] 使用真实 MVU 角色卡完成 Runtime Manifest/MVU 烟囱验证

## Agent Hybrid

- [x] 实现 Tavern、DrawDream 和 Hybrid 生成协调器
- [x] 将搜索、工具和来源注入 Prompt sections
- [x] 将 Agent 活动接入 TavernMessageNode

## Extension and Mobile

- [x] 建立 Core/Headless Extension Host
- [x] 建立受控原卡 DOM Surface 和资源解析基础
- [x] 实现外部模块授权策略和 WebView Bridge 收紧基础
- [x] 完成发布前兼容、性能和安全门禁脚本
