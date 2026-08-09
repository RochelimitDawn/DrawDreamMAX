import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Cloud,
  Database,
  Loader2,
  RefreshCw,
  Server,
  Shield,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react'
import { apiGet, apiPost, apiPut } from '../agent/rest'
import { toast } from '../utils/toast'
import './SyncPanel.css'

interface SyncStatus {
  enabled: boolean
  connecting: boolean
  connected: boolean
  lastSeq: number
  remoteMaxSeq: number
  pendingCount: number
  conflictCount: number
  lastError?: string
  lastSyncedAt?: number
  hasConfig: boolean
  deviceId: string
  deviceName: string
  groupId: string
}

interface DeviceInfo {
  deviceId: string
  name: string
  lastSeenAt: number
  active: boolean
}

interface ConflictInfo {
  entityType: string
  entityId: string
  fieldPath: string
  localTs: number
  remoteTs: number
}

const EMPTY: SyncStatus = {
  enabled: false,
  connecting: false,
  connected: false,
  lastSeq: 0,
  remoteMaxSeq: 0,
  pendingCount: 0,
  conflictCount: 0,
  hasConfig: false,
  deviceId: '',
  deviceName: '',
  groupId: '',
}

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus>(EMPTY)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('4000')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [deviceName, setDeviceName] = useState('DrawDream')
  const [busy, setBusy] = useState(false)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([])

  const refresh = useCallback(async () => {
    try {
      const s = await apiGet<SyncStatus>('/api/sync/status', { bypassCache: true })
      setStatus(s)
      setDeviceName(s.deviceName || 'DrawDream')
      if (s.enabled) {
        const [d, c] = await Promise.all([
          apiGet<{ devices: DeviceInfo[] }>('/api/sync/devices', { bypassCache: true }),
          apiGet<{ conflicts: ConflictInfo[] }>('/api/sync/conflicts', { bypassCache: true }),
        ])
        setDevices(d.devices)
        setConflicts(c.conflicts)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const testConnection = async () => {
    setBusy(true)
    try {
      const r = await apiPost<{ ok: boolean; error?: string; code?: string; message?: string }>(
        '/api/sync/test',
        { host, port: Number(port), user, password, database },
      )
      if (r.ok) toast(r.message ?? '连接成功', 'success')
      else toast(r.error ?? '连接失败', 'error')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveConfig = async () => {
    setBusy(true)
    try {
      await apiPut('/api/sync/config', { host, port: Number(port), user, password, database })
      toast('连接配置已保存', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const enable = async () => {
    setBusy(true)
    try {
      const r = await apiPost<{ ok: boolean; error?: string; code?: string; newAccount?: boolean }>(
        '/api/sync/enable',
        {
          host,
          port: Number(port),
          user,
          password,
          database,
          username: accountUsername,
          accountPassword,
          deviceName,
        },
      )
      if (r.ok) {
        toast(r.newAccount ? '云同步已启用（账号已注册）' : '云同步已启用', 'success')
        setPassword('')
        setAccountPassword('')
        void refresh()
      } else {
        toast(r.error ?? '启用失败', 'error')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await apiPost('/api/sync/disable', {})
      toast('云同步已停用', 'success')
      setStatus(EMPTY)
      setDevices([])
      setConflicts([])
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async () => {
    setBusy(true)
    try {
      await apiPost<{ ok: boolean }>('/api/sync/sync-now', {})
      void refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const renameDevice = async (deviceId: string, name: string) => {
    try {
      await apiPost('/api/sync/devices/rename', { deviceId, name })
      void refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const resolveConflict = async (c: ConflictInfo, value: string) => {
    try {
      await apiPost('/api/sync/conflicts/resolve', {
        entityType: c.entityType,
        entityId: c.entityId,
        fieldPath: c.fieldPath,
        value,
      })
      void refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const statusLabel = status.enabled
    ? status.connected
      ? '已连接'
      : status.connecting
        ? '连接中'
        : '同步暂停'
    : '未启用'

  return (
    <div className="sync-panel">
      {/* 卡片 1：连接状态 */}
      <section className="sync-card sync-card-status">
        <div className="sync-card-head">
          <span className="sync-card-icon"><Wifi size={16} strokeWidth={2} /></span>
          <span className="sync-card-title">同步状态</span>
          <span className={`sync-badge ${status.enabled ? (status.connected ? 'is-on' : 'is-busy') : 'is-off'}`}>
            {statusLabel}
          </span>
        </div>
        <div className="sync-card-body">
          {status.lastError && <div className="sync-error">同步错误：{status.lastError}</div>}
          {status.enabled ? (
            <>
              <div className="sync-stats">
                <div className="sync-stat">
                  <span className="sync-stat-label">已同步</span>
                  <strong>{status.lastSeq}</strong>
                </div>
                <div className="sync-stat">
                  <span className="sync-stat-label">云端最大</span>
                  <strong>{status.remoteMaxSeq}</strong>
                </div>
                <div className="sync-stat">
                  <span className="sync-stat-label">待同步</span>
                  <strong>{status.pendingCount}</strong>
                </div>
                <div className="sync-stat">
                  <span className="sync-stat-label">冲突</span>
                  <strong>{status.conflictCount}</strong>
                </div>
              </div>
              <div className="sync-actions">
                <button className="btn" onClick={syncNow} disabled={busy}>
                  {busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                  立即同步
                </button>
                <button className="btn btn-ghost" onClick={() => void disable()} disabled={busy}>
                  <X size={16} />
                  停用同步
                </button>
              </div>
            </>
          ) : (
            <div className="sync-idle-hint">
              连接 TiDB Cloud 后，多台设备将共享同一份数据。
            </div>
          )}
        </div>
      </section>

      {/* 卡片 2：云同步 API */}
      <section className="sync-card">
        <div className="sync-card-head">
          <span className="sync-card-icon"><Database size={16} strokeWidth={2} /></span>
          <span className="sync-card-title">云同步 API</span>
          <span className="sync-card-sub">TiDB Serverless 连接</span>
        </div>
        <div className="sync-card-body">
          <div className="sync-form">
            <label className="sync-field">
              <span>数据库主机</span>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="gateway01.ap-southeast-1.prod.aws.tidbcloud.com"
              />
            </label>
            <div className="sync-field-row">
              <label className="sync-field">
                <span>端口</span>
                <input type="number" value={port} onChange={(e) => setPort(e.target.value)} />
              </label>
              <label className="sync-field">
                <span>数据库名</span>
                <input
                  type="text"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="dd_sync_mygroup"
                />
              </label>
            </div>
            <label className="sync-field">
              <span>连接用户</span>
              <input type="text" value={user} onChange={(e) => setUser(e.target.value)} />
            </label>
            <label className="sync-field">
              <span>连接密码</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="sync-actions">
            <button className="btn" onClick={() => void testConnection()} disabled={busy || !host}>
              {busy ? <Loader2 className="spin" size={16} /> : <Server size={16} />}
              测试连接
            </button>
            <button className="btn btn-ghost" onClick={() => void saveConfig()} disabled={busy || !host}>
              保存配置
            </button>
          </div>
        </div>
      </section>

      {/* 卡片 3：云账号（多设备共享） */}
      <section className="sync-card">
        <div className="sync-card-head">
          <span className="sync-card-icon"><Shield size={16} strokeWidth={2} /></span>
          <span className="sync-card-title">云账号</span>
          <span className="sync-card-sub">多设备共享</span>
        </div>
        <div className="sync-card-body">
          {!status.enabled ? (
            <>
              <div className="sync-form">
                <label className="sync-field">
                  <span>账号用户名</span>
                  <input
                    type="text"
                    value={accountUsername}
                    onChange={(e) => setAccountUsername(e.target.value)}
                    placeholder="首次启用将注册该账号"
                  />
                </label>
                <label className="sync-field">
                  <span>账号密码</span>
                  <input
                    type="password"
                    value={accountPassword}
                    onChange={(e) => setAccountPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label className="sync-field">
                  <span>本设备名称</span>
                  <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
                </label>
              </div>
              <div className="sync-actions">
                <button className="btn sync-enable" onClick={() => void enable()} disabled={busy}>
                  {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                  启用云同步
                </button>
              </div>
            </>
          ) : (
            <div className="sync-account-info">
              <Cloud size={16} strokeWidth={2} />
              <span>账号已绑定，组：{status.groupId || '—'}</span>
            </div>
          )}
        </div>
      </section>

      {/* 卡片 4：设备管理 */}
      {status.enabled && (
        <section className="sync-card">
          <div className="sync-card-head">
            <span className="sync-card-icon"><Smartphone size={16} strokeWidth={2} /></span>
            <span className="sync-card-title">同步设备</span>
          </div>
          <div className="sync-card-body">
            <div className="sync-devices">
              {devices.length === 0 ? (
                <div className="sync-empty">暂无其他设备</div>
              ) : (
                devices.map((d) => (
                  <div className="sync-device-row" key={d.deviceId}>
                    <Smartphone size={16} />
                    <span className="sync-device-name">{d.name}</span>
                    <span className={`sync-badge ${d.active ? 'is-on' : 'is-off'}`}>
                      {d.active ? '在线' : '离线'}
                    </span>
                    <span className="sync-device-seen">
                      {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
                    </span>
                    <button
                      className="sync-device-rename"
                      onClick={() => {
                        const name = window.prompt('设备名称', d.name)
                        if (name && name.trim()) void renameDevice(d.deviceId, name.trim())
                      }}
                    >
                      重命名
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* 卡片 5：冲突记录 */}
      {status.enabled && (
        <section className="sync-card">
          <div className="sync-card-head">
            <span className="sync-card-icon"><AlertTriangle size={16} strokeWidth={2} /></span>
            <span className="sync-card-title">冲突记录</span>
          </div>
          <div className="sync-card-body">
            <div className="sync-conflicts">
              {conflicts.length === 0 ? (
                <div className="sync-empty">无未解决冲突</div>
              ) : (
                conflicts.map((c) => (
                  <div className="sync-conflict-row" key={`${c.entityType}:${c.entityId}:${c.fieldPath}`}>
                    <span className="sync-conflict-path">
                      {c.entityType} · {c.fieldPath}
                    </span>
                    <button
                      className="btn"
                      onClick={() => {
                        const value = window.prompt('保留的值（JSON）', '"远端值"')
                        if (value) void resolveConflict(c, value)
                      }}
                    >
                      解决
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
