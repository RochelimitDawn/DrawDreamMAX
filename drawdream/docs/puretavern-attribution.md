# PureTavern Reference and Attribution

DrawDream references the public PureTavern project for SillyTavern compatibility contracts and behavior analysis.

- Repository: `https://github.com/Lianues/PureTavern`
- Reference commit: `847c04235a4fa113bef7994929779f7e1eb50871`
- License: AGPL-3.0
- Reference areas: `apps/web/src/legacy-hook`, `apps/web/src/features`, `packages/contracts`, `packages/shared`

## Reuse Decision

The initial DrawDream adapter uses a clean-room implementation based on observed public contracts. No PureTavern source file is copied into DrawDream by this phase.

Direct source reuse requires file-level review, preserved AGPL-3.0 notices, source attribution, and a distribution-license decision before the file enters the product tree. DrawDream's current repository license is PolyForm Noncommercial; the license boundary remains explicit for any future adapted source.

## Scope of Reference

PureTavern provides reference behavior for browser compatibility hooks, feature boundaries, contract organization, persistence concepts, and platform adapters. DrawDream retains its own React UI, DrawDream Agent, SessionManager, WebSocket protocol, controlled Card Runtime, and Android local Node architecture.

## Change Record

| Date | Area | Decision | DrawDream target |
| --- | --- | --- | --- |
| 2026-07-30 | Legacy Hook | Clean-room contract mapping | `src/tavern/compat/` |
| 2026-07-30 | Feature registry | Clean-room compatibility inventory | `src/tavern/compat/inventory.ts` |
| 2026-07-30 | Contracts | Clean-room typed contract model | `src/tavern/compat/contracts.ts` |
