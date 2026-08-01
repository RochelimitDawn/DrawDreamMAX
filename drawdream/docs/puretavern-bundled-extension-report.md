# PureTavern 内置扩展兼容报告

参考 commit：`847c04235a4fa113bef7994929779f7e1eb50871`

扩展数：2；manifest 可加载：2；可直接运行：2；需要适配：0；阻断：0

| Extension | Manifest | Runtime | Status | Required APIs | Missing capabilities |
| --- | --- | --- | --- | --- | --- |
| `js-slash-runner-4.8.19` | manifest-loadable | runnable | supported | TavernHelper, SillyTavern, eventSource, generate, iframe | - |
| `st-prompt-template-1.16` | manifest-loadable | runnable | supported | SillyTavern, eventSource, generate, iframe | - |

结论：manifest 可加载代表归档和入口可识别，runtime 可运行还需要所有声明 API 映射到 DrawDream capability。
