# PureTavern 兼容矩阵

生成时间：`2026-08-03T14:01:14.200Z`
参考仓库：https://github.com/Lianues/PureTavern @ `847c04235a4fa113bef7994929779f7e1eb50871`
许可证：`AGPL-3.0`

契约：10；fixture：22；完整覆盖契约：10

| Contract | Status | Fixtures | Missing | Mobile | Reuse | Error behavior |
| --- | --- | ---: | --- | --- | --- | --- |
| `characters.card-runtime` | partial | 4/4 | - | supported | clean-room | Typed contract response |
| `chats.jsonl-import-export` | partial | 2/2 | - | supported | clean-room | COMPATIBILITY_INVALID_REQUEST |
| `world-books.entries` | partial | 2/2 | - | supported | clean-room | Typed contract response |
| `presets.prompt-pipeline` | partial | 2/2 | - | supported | clean-room | Typed contract response |
| `generation.lifecycle-events` | fixture-covered | 2/2 | - | supported | clean-room | Typed contract response |
| `extensions.legacy-hook` | partial | 2/2 | - | supported | clean-room | COMPATIBILITY_INVALID_REQUEST |
| `assets.card-relative` | supported | 2/2 | - | supported | clean-room | Typed contract response |
| `import-export.archive` | partial | 2/2 | - | supported | clean-room | Typed contract response |
| `events.tavern-runtime` | fixture-covered | 2/2 | - | supported | clean-room | Typed contract response |
| `runtime.card-ui` | partial | 2/2 | - | partial | clean-room | COMPATIBILITY_INVALID_REQUEST |
