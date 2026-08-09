/** 多用户认证 API */

export type PublicUser = {
  id: string
  username: string
  role: 'user' | 'admin'
}

export type AuthStatus = {
  mode: string
  allowRegistration: boolean
  user: PublicUser | null
  defaultPasswordIsFactory?: boolean
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* ignore */
  }
  const err = (data as { error?: string; code?: string } | null)?.error
  if (!res.ok || err) {
    const e = new Error(err || `HTTP ${res.status}`) as Error & { code?: string; status?: number }
    e.code = (data as { code?: string } | null)?.code
    e.status = res.status
    throw e
  }
  return data as T
}

export const fetchAuthStatus = () => authFetch<AuthStatus>('/api/auth/status')

/** 单机模式：自动签发本地会话 Cookie */
export const ensureLocalSession = () =>
  authFetch<{ ok: boolean; user: PublicUser }>('/api/auth/local-session', {
    method: 'POST',
    body: '{}',
  })

export const login = (username: string, password: string) =>
  authFetch<{ ok: boolean; user: PublicUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const register = (username: string, password: string) =>
  authFetch<{ ok: boolean; user: PublicUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const logout = () =>
  authFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' })

export const fetchMe = () =>
  authFetch<{ user: PublicUser; defaultPasswordIsFactory?: boolean }>('/api/auth/me')

export const changePassword = (oldPassword: string, newPassword: string) =>
  authFetch<{ ok: boolean }>('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  })

export const fetchUserSettings = () =>
  authFetch<{ settings: unknown }>('/api/user/settings')

export const putUserSettings = (settings: unknown) =>
  authFetch<{ ok: boolean }>('/api/user/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  })

export type AdminUser = PublicUser & { disabled: boolean; createdAt: number }

export const adminListUsers = () => authFetch<{ users: AdminUser[] }>('/api/admin/users')

export const adminCreateUser = (username: string, password: string, role?: 'user' | 'admin') =>
  authFetch<{ ok: boolean; user: PublicUser }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  })

export const adminPatchUser = (id: string, patch: { disabled?: boolean; role?: 'user' | 'admin' }) =>
  authFetch<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const adminResetPassword = (id: string, password: string) =>
  authFetch<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })

export const adminGetUser = (id: string) =>
  authFetch<{
    user: AdminUser
    sessions: LoginSession[]
    sessionCount: number
  }>(`/api/admin/users/${encodeURIComponent(id)}`)

/** 默认 purge workspace；confirmUsername 须与目标用户名一致 */
export const adminDeleteUser = (
  id: string,
  opts: { confirmUsername: string; purgeWorkspace?: boolean },
) =>
  authFetch<{ ok: boolean; purged: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      confirmUsername: opts.confirmUsername,
      purgeWorkspace: opts.purgeWorkspace !== false,
    }),
  })

export const adminKickUser = (id: string) =>
  authFetch<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}/kick`, {
    method: 'POST',
    body: '{}',
  })

export const adminBatchUsers = (
  action: 'disable' | 'enable' | 'kick' | 'delete',
  ids: string[],
  opts?: { purgeWorkspace?: boolean },
) =>
  authFetch<{ ok: boolean; count: number; errors: Array<{ id: string; code: string }> }>(
    '/api/admin/users/batch',
    {
      method: 'POST',
      body: JSON.stringify({
        action,
        ids,
        ...(action === 'delete'
          ? { purgeWorkspace: opts?.purgeWorkspace !== false }
          : {}),
      }),
    },
  )

export const adminRuntimeStats = () =>
  authFetch<{
    runtimes: number
    maxRuntimes: number
    connections: number
    users: Array<{
      userId: string
      connections: number
      streaming: boolean
      lastActiveAt: number
      idleMs: number
    }>
  }>('/api/admin/runtime-stats')

export type LoginSession = {
  sessionId: string
  createdAt: number
  lastSeenAt: number
  expiresAt: number | null
  userAgent: string | null
  deviceName: string
  browser: string
  os: string
  ip: string
  location: string
  current: boolean
}

export const listSessions = () => authFetch<{ sessions: LoginSession[] }>('/api/auth/sessions')

export const revokeSession = (sessionId: string) =>
  authFetch<{ ok: boolean; currentRevoked?: boolean }>(
    `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  )

export type UapiAdminPublic = {
  enabled: boolean
  baseUrl: string
  source: 'standard' | 'commercial'
  hasApiKey: boolean
}

export const adminGetSettings = () =>
  authFetch<{
    allowRegistration: boolean
    defaultPasswordIsFactory?: boolean
    factoryPasswordHint?: string
    uapi?: UapiAdminPublic
  }>('/api/admin/settings')

export const adminPutSettings = (patch: { allowRegistration?: boolean }) =>
  authFetch<{ ok: boolean; allowRegistration: boolean; uapi?: UapiAdminPublic }>(
    '/api/admin/settings',
    {
      method: 'PUT',
      body: JSON.stringify(patch),
    },
  )

export const adminGetUapi = () => authFetch<{ uapi: UapiAdminPublic }>('/api/admin/uapi')

export const adminPutUapi = (patch: {
  enabled?: boolean
  baseUrl?: string
  apiKey?: string
  source?: 'standard' | 'commercial'
  clearApiKey?: boolean
}) =>
  authFetch<{ ok: boolean; uapi: UapiAdminPublic }>('/api/admin/uapi', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
