import {
  pureTavernReference,
  type CompatibilityContract,
} from './contracts.ts'

const cleanRoom = {
  mobile: 'supported' as const,
  reuse: 'clean-room' as const,
}

export const compatibilityInventory: readonly CompatibilityContract[] = [
  {
    id: 'characters.card-runtime',
    domain: 'characters',
    status: 'partial',
    reference: pureTavernReference('apps/web/src/features/characters'),
    drawdreamTarget: 'agent/server/rest/routes/cards.ts',
    responseSchema: 'CardResponse',
    fixtureIds: ['card-v1', 'card-v2', 'card-v3', 'card-png'],
    ...cleanRoom,
  },
  {
    id: 'chats.jsonl-import-export',
    domain: 'chats',
    status: 'partial',
    reference: pureTavernReference('apps/web/src/features/chats'),
    drawdreamTarget: 'src/agent/rest.ts',
    requestSchema: 'SillyTavern JSONL',
    fixtureIds: ['chat-jsonl-metadata', 'chat-jsonl-swipes'],
    ...cleanRoom,
  },
  {
    id: 'world-books.entries',
    domain: 'world-books',
    status: 'partial',
    reference: pureTavernReference('apps/web/src/features/world-books'),
    drawdreamTarget: 'agent/src/lorebook.ts',
    fixtureIds: ['world-book-v1', 'world-book-embedded'],
    ...cleanRoom,
  },
  {
    id: 'presets.prompt-pipeline',
    domain: 'presets',
    status: 'partial',
    reference: pureTavernReference('apps/web/src/features/presets'),
    drawdreamTarget: 'agent/src/tavern-prompt.ts',
    fixtureIds: ['preset-post-history', 'prompt-differential'],
    ...cleanRoom,
  },
  {
    id: 'generation.lifecycle-events',
    domain: 'generation',
    status: 'fixture-covered',
    reference: pureTavernReference('apps/web/src/features/generation'),
    drawdreamTarget: 'agent/server/story-subscribe.ts',
    responseSchema: 'ServerFrame',
    fixtureIds: ['generation-stream', 'generation-tool-round'],
    ...cleanRoom,
  },
  {
    id: 'extensions.legacy-hook',
    domain: 'extensions',
    status: 'partial',
    reference: pureTavernReference('apps/web/src/legacy-hook'),
    drawdreamTarget: 'src/utils/cardBridge.ts',
    requestSchema: 'TavernFrame request',
    fixtureIds: ['tavernhelper-mvu', 'card-bridge-capabilities'],
    ...cleanRoom,
  },
  {
    id: 'assets.card-relative',
    domain: 'assets',
    status: 'supported',
    reference: pureTavernReference('apps/web/src/features/assets'),
    drawdreamTarget: 'src/tavern/card-assets.ts',
    fixtureIds: ['asset-relative', 'asset-traversal'],
    ...cleanRoom,
  },
  {
    id: 'import-export.archive',
    domain: 'import-export',
    status: 'partial',
    reference: pureTavernReference('apps/web/src/features/import-export'),
    drawdreamTarget: 'src/agent/rest.ts',
    fixtureIds: ['chat-jsonl-roundtrip', 'card-png-roundtrip'],
    ...cleanRoom,
  },
  {
    id: 'events.tavern-runtime',
    domain: 'events',
    status: 'fixture-covered',
    reference: pureTavernReference('packages/contracts/src'),
    drawdreamTarget: 'src/tavern/kernel/event-bus.ts',
    responseSchema: 'TavernEvent',
    fixtureIds: ['event-ordering', 'event-generation-lifecycle'],
    ...cleanRoom,
  },
  {
    id: 'runtime.card-ui',
    domain: 'runtime',
    status: 'partial',
    reference: pureTavernReference('apps/web/src/legacy-hook'),
    drawdreamTarget: 'src/components/CardHtmlFrame.tsx',
    requestSchema: 'CardBridgeRequest',
    fixtureIds: ['status-placeholder', 'card-html-frame'],
    mobile: 'partial',
    reuse: 'clean-room',
  },
]

export function getCompatibilityContract(id: string): CompatibilityContract | null {
  const contract = compatibilityInventory.find((item) => item.id === id)
  return contract ? { ...contract, fixtureIds: [...contract.fixtureIds], reference: contract.reference ? { ...contract.reference } : undefined } : null
}

export function compatibilityMatrix(): CompatibilityContract[] {
  return compatibilityInventory.map((contract) => getCompatibilityContract(contract.id)!)
}
