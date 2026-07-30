# 酒馆兼容内核需求规范

## 目标

DrawDream SHALL 在现有 React 聊天界面内提供 SillyTavern 核心能力。角色卡导入后，系统 SHALL 使用角色卡携带的 UI、CSS、脚本、Regex、TavernHelper 和 MVU 数据驱动消息展示。DrawDream 的 Agent、搜索、工具调用、来源引用、上下文管理和 Android 本地 Node 运行链路 SHALL 继续作为原生能力存在。

## 术语

- **酒馆兼容内核**：提供 SillyTavern 数据模型、事件、Prompt Pipeline、扩展 API、TavernHelper、MVU 和消息 UI 运行能力的 DrawDream 内部运行时。
- **原卡 UI**：角色卡或其扩展提供的 HTML、CSS、JavaScript、组件占位符和动态状态页面。
- **Tavern Kernel**：管理角色、聊天、消息、变量、扩展、Prompt 和事件的框架无关内核。
- **兼容 API**：以 SillyTavern 常用路径和数据格式提供的浏览器 API facade。
- **Hybrid 模式**：酒馆 Prompt Pipeline 与 DrawDream Agent 工具编排共同参与生成。
- **消息快照**：消息正文、swipe、变量 revision、变量操作和运行时元数据的不可变记录。
- **能力令牌**：绑定具体卡片 UI frame、会话和允许操作的短期授权凭据。

## 需求

### 需求 1：角色卡导入与运行时初始化

**用户故事：** 作为角色卡用户，我希望导入 PNG 或 JSON 后立即进入当前 DrawDream 聊天页，从而直接使用原卡 UI。

#### 验收标准

1. WHEN 用户导入 V1、V2 或 V3 JSON 角色卡或包含 `chara`/`ccv3` 的 PNG，系统 SHALL 保存原始字节、规范化字段和完整扩展字段。
2. WHEN 角色卡包含 `extensions.regex_scripts`、`tavern_helper`、MVU 配置、世界书或 UI 资源，系统 SHALL 为每项生成兼容运行时清单和诊断信息。
3. WHEN 角色卡导入成功，系统 SHALL 在当前 DrawDream 聊天页创建或绑定角色会话，并初始化 `first_mes`、`alternate_greetings`、Persona、世界书和运行时变量。
4. WHEN 角色卡包含已授权的原卡 UI 能力，系统 SHALL 在消息区域渲染原卡 UI，并将 `StatusPlaceHolderImpl` 等占位符交给兼容运行时处理。
5. IF 运行时资源准备失败，系统 SHALL 保留原始剧情文本、导入结果和错误诊断，并提供可重复的重试入口。

### 需求 2：统一 DrawDream 聊天界面

**用户故事：** 作为 DrawDream 用户，我希望在同一个聊天页面使用酒馆卡和 DrawDream Agent，从而保持一致的产品体验。

#### 验收标准

1. WHILE 用户使用酒馆兼容卡时，系统 SHALL 保持 DrawDream 的页面、侧栏、输入区、设置、上下文面板和会话导航。
2. WHEN 消息包含原卡 UI、Markdown、Agent 活动、工具结果或来源引用，系统 SHALL 在同一消息渲染树中按节点顺序展示各类内容。
3. WHEN 用户切换原生、酒馆或 Hybrid 生成策略，系统 SHALL 保持当前角色、聊天、变量和消息快照连续。
4. WHEN 用户使用 Android APK，系统 SHALL 通过现有单端口本地 Node 服务提供同一 DrawDream 页面和兼容 API。

### 需求 3：Tavern Kernel 上下文与事件

**用户故事：** 作为兼容扩展作者，我希望获得稳定的 SillyTavern Context 和事件顺序，从而复用功能型扩展。

#### 验收标准

1. WHEN 扩展调用 `SillyTavern.getContext()`，系统 SHALL 返回当前会话、角色、Persona、消息、世界书、扩展设置、聊天元数据和生成状态。
2. WHEN 角色、聊天、消息、生成、变量或 swipe 发生变化，系统 SHALL 发布对应的带序号事件。
3. WHEN WebSocket 重连，系统 SHALL 根据 session revision 和 event sequence 恢复一致的 Context。
4. WHEN 扩展注册或移除事件处理器，系统 SHALL 按注册生命周期管理处理器并释放已关闭消息 frame 的订阅。

### 需求 4：Prompt Pipeline 与生成

**用户故事：** 作为角色扮演用户，我希望酒馆卡的 Prompt 规则和 DrawDream Agent 能力共同生效，从而获得兼容的剧情生成和增强工具能力。

#### 验收标准

1. WHEN 系统生成模型请求，系统 SHALL 按确定顺序处理用户输入、宏、Regex、世界书、角色卡、Persona、示例消息、历史消息、Depth Prompt、Author Note 和后历史指令。
2. WHEN Hybrid 模式启用且 Agent 决定调用工具，系统 SHALL 将搜索、工具结果和来源引用作为可追踪 Prompt section 插入生成上下文。
3. WHEN 模型请求流式返回，系统 SHALL 同时向 DrawDream 消息流和兼容事件总线发布增量状态。
4. IF Prompt Pipeline 或模型服务发生错误，系统 SHALL 保留可重试的生成状态，并展示具体阶段和错误原因。

### 需求 5：Regex Engine

**用户故事：** 作为酒馆卡用户，我希望角色卡 Regex 按原有 placement 语义执行，从而保持正文美化和 Prompt 处理效果。

#### 验收标准

1. WHEN 系统执行 Regex，系统 SHALL 支持 Global、Preset 和角色范围脚本，并按其配置的 placement 进入对应处理阶段。
2. WHEN Regex 脚本使用 `markdownOnly`、`promptOnly`、`runOnEdit`、深度范围、trimStrings、捕获组或 `{{match}}`，系统 SHALL 按兼容规则处理。
3. WHEN Regex 脚本执行失败或超出时间预算，系统 SHALL 跳过该脚本、记录诊断并保留其余输出。
4. WHEN Regex 处理消息，系统 SHALL 保存脚本标识、输入输出摘要、执行阶段和耗时追踪。

### 需求 6：TavernHelper、MVU 与消息状态

**用户故事：** 作为依赖 TavernHelper 或 MVU 的角色卡用户，我希望变量和状态页面可以随剧情更新并支持回档。

#### 验收标准

1. WHEN 卡内脚本调用 TavernHelper 变量、消息、Slash Command、角色卡或世界书接口，系统 SHALL 通过兼容 facade 转发到 Tavern Kernel。
2. WHEN 卡内或模型产生 MVU 变量操作，系统 SHALL 在事务中校验作用域、路径、类型和 revision 后提交。
3. WHEN 用户切换 swipe、分支或回档位置，系统 SHALL 恢复目标消息的变量快照和原卡 UI 状态。
4. WHEN 用户重开会话，系统 SHALL 根据持久化消息快照恢复变量、扩展状态和选中的 swipe。
5. IF 变量事务发生冲突，系统 SHALL 返回冲突 revision，并阻止旧 revision 覆盖新状态。

### 需求 7：原卡 UI 与扩展执行

**用户故事：** 作为角色卡作者，我希望卡内 UI 在 DrawDream 消息区域工作，从而复用原有 HTML/CSS/JavaScript。

#### 验收标准

1. WHEN 消息包含 HTML、CSS、脚本或组件占位符，系统 SHALL 在受控 `TavernFrameHost` 中按消息级能力渲染。
2. WHEN 原卡 UI 调用发送、上下文、变量、消息更新、事件订阅、资源解析或尺寸调整，系统 SHALL 通过能力令牌和 frame 绑定的 Bridge 完成操作。
3. WHEN 功能型扩展仅依赖 Context、事件、TavernHelper、Slash Command 和兼容 API，系统 SHALL 提供运行入口。
4. WHEN 扩展依赖 DrawDream 已定义的 React 插槽，系统 SHALL 将工具栏、消息装饰器、设置区和侧栏操作映射到现有 UI。
5. IF 扩展依赖未适配的 Legacy DOM 选择器，系统 SHALL 展示扩展级兼容诊断，并保留可用的核心 API。

### 需求 8：兼容 API 与数据持久化

**用户故事：** 作为兼容运行时，我希望以酒馆 API 格式访问 DrawDream 数据，从而复用原有前端和扩展协议。

#### 验收标准

1. WHEN 兼容内核请求角色、聊天、世界书、Preset、资源、扩展或生成接口，系统 SHALL 通过统一 Compatibility Router 映射到 DrawDream 服务。
2. WHEN 兼容 API 写入角色、聊天、消息或变量，系统 SHALL 使用稳定 ID、revision 和条件写入保护数据。
3. WHEN 用户导出角色卡或聊天，系统 SHALL 支持原始 PNG/JSON、SillyTavern JSONL 和兼容 sidecar 的往返导出。
4. WHEN DrawDream 服务运行在 Android，系统 SHALL 在 `127.0.0.1:7620` 上提供兼容 API、WebSocket 和静态前端资源。

### 需求 9：安全与诊断

**用户故事：** 作为用户，我希望明确控制卡内脚本和外部资源能力，从而在使用原卡 UI 时了解运行风险。

#### 验收标准

1. WHEN 角色卡请求脚本、外部模块、网络、变量写入、消息修改或文件能力，系统 SHALL 在运行前展示能力清单。
2. WHEN 用户授权卡片能力，系统 SHALL 按卡片 fingerprint、脚本 hash、扩展版本和会话保存授权记录。
3. WHEN frame 发起 Bridge 请求，系统 SHALL 校验消息来源、frameId、能力令牌、能力范围、数据大小和请求频率。
4. WHEN 外部资源进入运行时，系统 SHALL 支持来源白名单、超时、大小限制、MIME 校验、版本缓存和错误诊断。
5. IF 运行时检测到不支持的脚本或扩展能力，系统 SHALL 将该能力标记为受限，并保持剧情文本和会话可用。

### 需求 10：兼容性验证

**用户故事：** 作为维护者，我希望使用真实酒馆样本进行差分测试，从而持续控制兼容回归。

#### 验收标准

1. WHEN 维护者运行兼容测试，系统 SHALL 覆盖 V2/V3 PNG、JSONL、Regex、HTML/CSS/JavaScript、TavernHelper、MVU、swipe 和外部依赖样本。
2. WHEN 相同卡片在标准 SillyTavern/PureTavern 和 DrawDream 运行，系统 SHALL 比较 Prompt、Regex 输出、事件顺序、变量状态和 UI 结构摘要。
3. WHEN 真实“文明”卡完成端到端测试，系统 SHALL 验证导入、开场白、StatusPlaceHolderImpl、MVU 更新、按钮交互、生成、swipe 和重启恢复。
4. WHEN 兼容能力发生回归，系统 SHALL 输出具体卡 fingerprint、阶段、脚本、API 和消息 revision。

## 非功能要求

- 系统 SHALL 让普通消息渲染和兼容内核初始化保持可观测，初始化阶段应展示阶段状态。
- 系统 SHALL 将稳定消息 ID、session revision 和 event sequence 作为跨重连的一致性基础。
- 系统 SHALL 将 DrawDream `WorldState` 与酒馆 MVU store 分离，通过显式适配器进行互操作。
- 系统 SHALL 将兼容运行时构建、上游快照、扩展清单和来源信息纳入可追溯发布产物。
