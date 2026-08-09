export type CompatibilityErrorCode =
  | 'COMPATIBILITY_UNSUPPORTED'
  | 'COMPATIBILITY_INVALID_REQUEST'
  | 'RUNTIME_CAPABILITY_UNAVAILABLE'
  | 'EXTERNAL_MODULE_UNDECLARED'
  | 'EXTERNAL_MODULE_AUTH_REQUIRED'

export class CompatibilityError extends Error {
  readonly code: CompatibilityErrorCode
  readonly capability?: string
  readonly details?: Record<string, unknown>

  constructor(
    code: CompatibilityErrorCode,
    message: string,
    options?: { capability?: string; details?: Record<string, unknown> },
  ) {
    super(message)
    this.name = 'CompatibilityError'
    this.code = code
    this.capability = options?.capability
    this.details = options?.details ? { ...options.details } : undefined
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      error: this.message,
      ...(this.capability ? { capability: this.capability } : {}),
      ...(this.details ? { details: { ...this.details } } : {}),
    }
  }
}

export function unsupportedCompatibility(
  contractId: string,
  capability?: string,
): CompatibilityError {
  return new CompatibilityError(
    'COMPATIBILITY_UNSUPPORTED',
    `Compatibility contract is unsupported: ${contractId}`,
    { capability, details: { contractId } },
  )
}

export function invalidCompatibilityRequest(
  contractId: string,
  fields: string[],
): CompatibilityError {
  return new CompatibilityError(
    'COMPATIBILITY_INVALID_REQUEST',
    `Invalid compatibility request: ${contractId}`,
    { details: { contractId, fields: [...fields] } },
  )
}

export function unavailableRuntimeCapability(method: string, alternative?: string): CompatibilityError {
  return new CompatibilityError(
    'RUNTIME_CAPABILITY_UNAVAILABLE',
    `Runtime capability is unavailable: ${method}`,
    { capability: method, details: alternative ? { alternative } : undefined },
  )
}
