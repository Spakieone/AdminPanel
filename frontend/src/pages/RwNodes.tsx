import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getRwNodesV2, getRwNodesMetrics, createRwNode, updateRwNode, restartRwNode,
  enableRwNodeV2, disableRwNodeV2,
} from '../api/remnawave-v2'
import { useToastContext } from '../contexts/ToastContext'
import { useRwProfile } from '../hooks/useRwProfile'

type NodeMetrics = {
  nodeUuid: string
  uploadBytes: number   // sum of all inbounds upload
  downloadBytes: number // sum of all inbounds download
}

type RwNode = {
  uuid: string
  name: string
  address: string
  port?: number
  status: 'online' | 'offline' | 'disabled' | string
  xrayVersion?: string
  nodeVersion?: string
  lastSeenAt?: string | null
  lastStatusChange?: string | null
  usersOnline?: number
  trafficUsedBytes?: number
  trafficLimitBytes?: number
  trafficToday?: number
  trafficTotal?: number
  connectionError?: string | null
  cpuCount?: number
  cpuModel?: string
  totalRam?: string
  xrayUptime?: string
  countryCode?: string
  isTrafficTrackingActive?: boolean
}

function formatBytes(b: number): string {
  if (!b || b <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`
}

function formatSpeed(bytesStr: string | number | undefined): string {
  const b = typeof bytesStr === 'string' ? parseFloat(bytesStr) : (bytesStr ?? 0)
  if (!b || b <= 0) return '0'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1)
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}/s`
}

function formatUptime(seconds: string | undefined): string {
  if (!seconds) return '—'
  const s = parseInt(seconds, 10)
  if (isNaN(s) || s <= 0) return '—'
  if (s < 3600) return `${Math.floor(s / 60)}м`
  if (s < 86400) return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`
  return `${Math.floor(s / 86400)}д ${Math.floor((s % 86400) / 3600)}ч`
}

const COUNTRY_FLAGS: Record<string, string> = {
  RU: '🇷🇺', DE: '🇩🇪', NL: '🇳🇱', US: '🇺🇸', GB: '🇬🇧', FR: '🇫🇷',
  FI: '🇫🇮', PL: '🇵🇱', KZ: '🇰🇿', UA: '🇺🇦', TR: '🇹🇷', BY: '🇧🇾',
  CZ: '🇨🇿', SE: '🇸🇪', LV: '🇱🇻', LT: '🇱🇹', EE: '🇪🇪', AT: '🇦🇹',
}


/* ---- Dropdown Menu ---- */
function DropdownMenu({ node, onAction, disabled }: {
  node: RwNode
  onAction: (uuid: string, action: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const item = (label: string, action: string, colorClass: string, icon: string) => (
    <button
      onClick={() => { setOpen(false); onAction(node.uuid, action) }}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-xs ${colorClass} hover:bg-white/8 disabled:opacity-30 transition-colors flex items-center gap-2`}
    >
      <span className="w-4 text-center">{icon}</span>
      {label}
    </button>
  )

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 py-1 rounded-xl glass-card border border-white/10 shadow-xl z-50">
          {item('Рестарт', 'restart', 'text-sky-400', '↺')}
          {node.status === 'disabled'
            ? item('Включить', 'enable', 'text-emerald-400', '▶')
            : item('Отключить', 'disable', 'text-amber-400', '⏸')
          }
        </div>
      )}
    </div>
  )
}


const EMPTY_FORM = { name: '', address: '', port: '62050' }

export default function RwNodes() {
  const toast = useToastContext()
  const { profileId } = useRwProfile()
  const [nodes, setNodes] = useState<RwNode[]>([])
  const [metrics, setMetrics] = useState<Record<string, NodeMetrics>>({})
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Edit modal
  const [editNode, setEditNode] = useState<RwNode | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formLoading, setFormLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const stats = {
    total: nodes.length,
    online: nodes.filter(n => n.status === 'online').length,
    offline: nodes.filter(n => n.status === 'offline').length,
    disabled: nodes.filter(n => n.status === 'disabled').length,
    usersOnline: nodes.reduce((s, n) => s + (n.usersOnline || 0), 0),
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await getRwNodesV2(profileId || undefined)
      const list: RwNode[] = (data?.response ?? data?.nodes ?? data ?? []).map((n: any) => ({
        uuid: n.uuid || n.id || '',
        name: n.name || '',
        address: n.address || n.host || '',
        port: n.port,
        status: n.isDisabled ? 'disabled' : (n.isConnected ? 'online' : 'offline'),
        xrayVersion: n.xrayVersion ?? n.xray_version,
        nodeVersion: n.nodeVersion ?? n.node_version,
        lastSeenAt: n.lastStatusChange ?? n.lastSeenAt ?? n.last_seen_at,
        lastStatusChange: n.lastStatusChange,
        usersOnline: n.usersOnline ?? n.users_online ?? 0,
        trafficUsedBytes: n.trafficUsedBytes ?? n.traffic_used_bytes ?? 0,
        trafficLimitBytes: n.trafficLimitBytes ?? n.traffic_limit_bytes ?? 0,
        trafficToday: n.trafficToday ?? n.traffic_today ?? 0,
        trafficTotal: n.trafficTotal ?? n.traffic_total ?? 0,
        connectionError: n.lastStatusMessage || (n.connectionError ?? n.connection_error ?? null),
        cpuCount: n.cpuCount,
        cpuModel: n.cpuModel,
        totalRam: n.totalRam,
        xrayUptime: n.xrayUptime,
        countryCode: n.countryCode,
        isTrafficTrackingActive: n.isTrafficTrackingActive,
      }))
      list.sort((a, b) => {
        const order = { offline: 0, online: 1, disabled: 2 }
        return (order[a.status as keyof typeof order] ?? 1) - (order[b.status as keyof typeof order] ?? 1)
      })
      setNodes(list)

      // Load speed metrics in parallel (non-critical, ignore errors)
      getRwNodesMetrics(profileId || undefined).then((mData: any) => {
        const arr: any[] = mData?.response?.nodes ?? mData?.nodes ?? []
        const map: Record<string, NodeMetrics> = {}
        arr.forEach((m: any) => {
          const sumUp = (m.inboundsStats ?? []).reduce((s: number, x: any) => s + (parseFloat(x.upload) || 0), 0)
          const sumDl = (m.inboundsStats ?? []).reduce((s: number, x: any) => s + (parseFloat(x.download) || 0), 0)
          map[m.nodeUuid] = { nodeUuid: m.nodeUuid, uploadBytes: sumUp, downloadBytes: sumDl }
        })
        setMetrics(map)
      }).catch(() => {})
    } catch (e: any) {
      if (!silent) toast.showError('Ошибка', e?.message || 'Не удалось загрузить ноды')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [profileId])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => load(true), 30000)
    return () => clearInterval(interval)
  }, [load])

  const handleAction = async (uuid: string, action: string) => {
    setActionLoading(`${uuid}:${action}`)
    try {
      const pid = profileId || undefined
      if (action === 'restart') await restartRwNode(uuid, pid)
      else if (action === 'enable') await enableRwNodeV2(uuid, pid)
      else if (action === 'disable') await disableRwNodeV2(uuid, pid)
      toast.showSuccess('Готово', '')
      load(true)
    } catch (e: any) {
      toast.showError('Ошибка', e?.message || '')
    } finally {
      setActionLoading(null)
    }
  }

  const openCreate = () => {
    setEditNode(null)
    setForm(EMPTY_FORM)
    setShowCreate(true)
  }

  const saveNode = async () => {
    if (!form.name.trim() || !form.address.trim()) return
    const portNum = parseInt(form.port, 10)
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      toast.showError('Ошибка', 'Порт должен быть от 1 до 65535')
      return
    }
    setFormLoading(true)
    try {
      const pid = profileId || undefined
      const body = { name: form.name.trim(), address: form.address.trim(), port: portNum }
      if (editNode) await updateRwNode(editNode.uuid, body, pid)
      else await createRwNode(body, pid)
      toast.showSuccess('Сохранено', '')
      setEditNode(null); setShowCreate(false)
      load(true)
    } catch (e: any) {
      toast.showError('Ошибка', e?.message || '')
    } finally {
      setFormLoading(false)
    }
  }

  const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div className="glass-card p-4 rounded-xl">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-white/45 mt-1">{label}</div>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Ноды Remnawave</h1>
          <p className="text-sm text-white/45 mt-0.5">Управление серверами и агентами</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} disabled={loading} className="px-3 py-1.5 text-xs rounded-xl border border-white/10 text-white/50 hover:text-white/70 disabled:opacity-40">↻</button>
          <button onClick={openCreate} className="px-3 py-1.5 text-xs rounded-xl border border-[var(--accent)]/30 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors">+ Добавить ноду</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Всего', value: stats.total, color: 'text-white' },
          { label: 'Online', value: stats.online, color: 'text-emerald-400' },
          { label: 'Offline', value: stats.offline, color: 'text-red-400' },
          { label: 'Отключено', value: stats.disabled, color: 'text-white/40' },
          { label: 'Пользователей', value: stats.usersOnline, color: 'text-sky-400' },
        ].map((s, i) => (
          <div key={s.label} style={{ animation: 'fadeInUp 0.3s ease-out both', animationDelay: `${i * 0.06}s` }}>
            <StatCard label={s.label} value={s.value} color={s.color} />
          </div>
        ))}
      </div>

      {/* Node list */}
      <div className="glass-card rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid gap-x-3 px-4 py-2 border-b border-white/8 text-[11px] font-semibold text-white/30 uppercase tracking-wide select-none"
          style={{ gridTemplateColumns: '2fr 1.4fr 0.7fr 0.9fr 0.9fr 1fr 1fr 0.7fr 0.7fr 32px' }}>
          <span>Нода</span>
          <span>IP</span>
          <span className="text-center">Онлайн</span>
          <span className="text-right">Трафик</span>
          <span className="text-right">Лимит</span>
          <span className="text-center">Скорость</span>
          <span className="text-center">Версии</span>
          <span className="text-center">Аптайм</span>
          <span className="text-right">RAM</span>
          <span />
        </div>

        {loading ? (
          <div className="divide-y divide-white/5">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="px-4 py-3 animate-pulse flex gap-3">
                <div className="h-3 w-32 bg-white/5 rounded" />
                <div className="h-3 w-24 bg-white/5 rounded" />
                <div className="h-3 w-16 bg-white/5 rounded ml-auto" />
              </div>
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <div className="text-center py-10 text-white/30">Нет нод</div>
        ) : (
          <div className="divide-y divide-white/5">
            {nodes.map((n) => {
              const isActing = actionLoading?.startsWith(n.uuid)
              const flag = n.countryCode ? (COUNTRY_FLAGS[n.countryCode] ?? n.countryCode) : ''
              const trafficPct = n.trafficLimitBytes && n.trafficLimitBytes > 0
                ? Math.min(100, Math.round((n.trafficUsedBytes || 0) / n.trafficLimitBytes * 100))
                : null
              return (
                <div
                  key={n.uuid}
                  className={`grid gap-x-3 px-4 py-3 items-center text-sm hover:bg-white/[0.02] transition-colors ${n.status === 'disabled' ? 'opacity-50' : ''}`}
                  style={{ gridTemplateColumns: '2fr 1.4fr 0.7fr 0.9fr 0.9fr 1fr 1fr 0.7fr 0.7fr 32px' }}
                >
                  {/* Нода: флаг + статус + название */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${n.status === 'online' ? 'bg-emerald-400' : n.status === 'disabled' ? 'bg-white/20' : 'bg-red-400'}`} />
                    {flag && <span className="text-base leading-none flex-shrink-0">{flag}</span>}
                    <span className="font-medium text-white/90 truncate">{n.name}</span>
                  </div>

                  {/* IP:port */}
                  <span className="font-mono text-xs text-white/40 truncate">{n.address}{n.port ? `:${n.port}` : ''}</span>

                  {/* Онлайн */}
                  <span className="text-center font-semibold text-sky-400">{n.usersOnline ?? 0}</span>

                  {/* Трафик использован */}
                  <div className="text-right">
                    <span className="text-white/70 text-xs">{formatBytes(n.trafficUsedBytes || 0)}</span>
                    {trafficPct !== null && (
                      <div className="mt-1 h-0.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${trafficPct > 80 ? 'bg-red-400' : trafficPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ width: `${trafficPct}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Лимит */}
                  <span className="text-right text-xs text-white/30">
                    {n.trafficLimitBytes && n.trafficLimitBytes > 0 ? formatBytes(n.trafficLimitBytes) : '∞'}
                  </span>

                  {/* Скорость */}
                  {(() => {
                    const m = metrics[n.uuid]
                    if (!m || (m.uploadBytes === 0 && m.downloadBytes === 0)) {
                      return <div className="text-center text-[11px] text-white/20">—</div>
                    }
                    return (
                      <div className="text-center text-[11px] leading-tight">
                        <div className="text-emerald-400/70">↑ {formatSpeed(m.uploadBytes)}</div>
                        <div className="text-sky-400/70">↓ {formatSpeed(m.downloadBytes)}</div>
                      </div>
                    )
                  })()}

                  {/* Версии node + xray */}
                  <div className="text-center text-[11px] text-white/35 leading-tight">
                    {n.nodeVersion && <div>node {n.nodeVersion}</div>}
                    {n.xrayVersion && <div className="text-amber-400/60">xray {n.xrayVersion}</div>}
                  </div>

                  {/* Аптайм */}
                  <span className="text-center text-xs text-emerald-400/70">{formatUptime(n.xrayUptime)}</span>

                  {/* RAM */}
                  <span className="text-right text-[11px] text-white/30">{n.totalRam ?? '—'}</span>

                  {/* Actions */}
                  <div className="flex justify-end">
                    <DropdownMenu node={n} onAction={handleAction} disabled={!!isActing} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit/Create modal */}
      {(editNode || showCreate) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 modal-backdrop">
          <div className="glass-card p-6 rounded-2xl w-96 space-y-4 modal-content">
            <div className="text-base font-semibold text-white">{editNode ? 'Редактировать ноду' : 'Добавить ноду'}</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/50 mb-1 block">Название</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Адрес (IP или домен)</label>
                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Порт агента</label>
                <input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-[var(--accent)]" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setEditNode(null); setShowCreate(false) }}
                className="flex-1 py-2 rounded-xl border border-white/15 text-white/60 text-sm">Отмена</button>
              <button onClick={saveNode} disabled={formLoading || !form.name.trim() || !form.address.trim()}
                className="flex-1 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 font-semibold text-sm disabled:opacity-50 transition-colors">
                {formLoading ? '...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
