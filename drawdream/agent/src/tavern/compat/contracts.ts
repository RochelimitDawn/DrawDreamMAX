export type CompatibilityDomain =
  | 'characters'
  | 'chats'
  | 'world-books'
  | 'presets'
  | 'generation'
  | 'extensions'
  | 'assets'
  | 'import-export'
  | 'events'
  | 'runtime'

export type CompatibilityStatus = 'supported' | 'partial' | 'fixture-covered' | 'unsupported'
export type MobileCompatibility = 'supported' | 'partial' | 'unsupported'
export type ReuseDecision = 'clean-room' | 'adapted-with-notice' | 'pending-review'

export type CompatibilityReference = {
  repository: string
  path: string
  commit: string
  license: 'AGPL-3.0'
}

export type CompatibilityContract = {
  id: string
  domain: CompatibilityDomain
  status: CompatibilityStatus
  reference?: CompatibilityReference
  drawdreamTarget: string
  requestSchema?: string
  responseSchema?: string
  fixtureIds: string[]
  mobile: MobileCompatibility
  reuse: ReuseDecision
}

export const PURE_TAVERN_REFERENCE = {
  repository: 'https://github.com/Lianues/PureTavern',
  commit: '847c04235a4fa113bef7994929779f7e1eb50871',
  license: 'AGPL-3.0' as const,
}

export function pureTavernReference(path: string): CompatibilityReference {
  return {
    ...PURE_TAVERN_REFERENCE,
    path,
  }
}

export function cloneContract(contract: CompatibilityContract): CompatibilityContract {
  return {
    ...contract,
    fixtureIds: [...contract.fixtureIds],
    ...(contract.reference ? { reference: { ...contract.reference } } : {}),
  }
}
