import { useState, useEffect, useCallback } from 'react'
import {
  getRwNodesV2, getRwNodesBandwidthRealtime, createRwNode, updateRwNode, restartRwNode,
  enableRwNodeV2, disableRwNodeV2,
} from '../api/remnawave-v2'
import { useToastContext } from '../contexts/ToastContext'
import { useRwProfile } from '../hooks/useRwProfile'
import * as Flags from 'country-flag-icons/react/3x2'
import {
  Globe, PlugZap, Cpu, CheckCircle2, XCircle, Clock, HardDrive, Timer,
  ArrowDownToLine, ArrowUpFromLine, Box, Zap, Users,
} from 'lucide-react'

type BandwidthNode = {
  nodeUuid: string
  downloadSpeedBps: number
  uploadSpeedBps: number
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
  usersOnline?: number
  trafficUsedBytes?: number
  trafficToday?: number
  xrayUptime?: string
  countryCode?: string
  isXrayRunning?: boolean | null
}

function formatBytes(b: number): string {
  if (!b || b <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`
}

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return '0 B/s'
  const units = ['B/s', 'КБ/с', 'МБ/с', 'ГБ/с']
  let value = bps
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`
}

function formatUptime(seconds: string | number | undefined): string {
  if (!seconds) return '—'
  const s = typeof seconds === 'string' ? parseInt(seconds, 10) : seconds
  if (isNaN(s) || s <= 0) return '—'
  if (s < 3600) return `${Math.floor(s / 60)}м`
  if (s < 86400) return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`
  return `${Math.floor(s / 86400)}д ${Math.floor((s % 86400) / 3600)}ч`
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 10) return 'Только что'
  if (diff < 60) return `${diff}с назад`
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`
  return `${Math.floor(diff / 86400)}д назад`
}

function FlagIcon({ code }: { code?: string | null }) {
  const cc = String(code || '').trim().toUpperCase()
  if (!cc) return null
  const FlagComp = (Flags as any)[cc] as React.ComponentType<{ style?: React.CSSProperties; title?: string }>
  if (!FlagComp) return <span className="text-[10px] font-mono text-muted">{cc}</span>
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[2px]" style={{ width: 18, height: 13 }}>
      <FlagComp style={{ width: 18, height: 13, display: 'block' }} title={cc} />
    </span>
  )
}

// Row helper — icon + label left, value right
function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 min-h-[22px]">
      <span className="flex items-center gap-1.5 text-xs text-muted shrink-0">
        {icon && <span className="opacity-60 flex-shrink-0">{icon}</span>}
        {label}
      </span>
      <span className="text-xs font-medium text-primary text-right">{children}</span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2.5">{children}</div>
}

/* ---- Node Card ---- */
function NodeCard({ node, bw, onAction, actionLoading }: {
  node: RwNode
  bw?: BandwidthNode
  onAction: (uuid: string, action: string) => void
  actionLoading: string | null
}) {
  const isActing = actionLoading?.startsWith(node.uuid)
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const copyIp = () => {
    const text = node.address
    try { navigator.clipboard.writeText(text) } catch {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-9999px'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  // isXrayRunning: use field if present, otherwise infer from status
  const xrayRunning = node.isXrayRunning != null
    ? node.isXrayRunning
    : node.status === 'online'

  const statusConfig = node.status === 'online'
    ? { dot: 'bg-emerald-400', badge: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30', label: '● Online' }
    : node.status === 'disabled'
    ? { dot: 'bg-[var(--text-muted)]', badge: 'bg-overlay-md text-muted border border-default', label: '○ Отключено' }
    : { dot: 'bg-red-400', badge: 'bg-red-500/20 text-red-400 border border-red-500/30', label: '● Offline' }

  return (
    <div className={`rounded-2xl border border-default bg-overlay-xs overflow-hidden ${node.status === 'disabled' ? 'opacity-60' : ''}`}>
      {/* Header: флаг + название + онлайн пользователи + статус + ⋮ */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-default">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusConfig.dot}`} />
        <FlagIcon code={node.countryCode} />
        <span className="font-semibold text-primary text-sm flex-1 min-w-0 truncate">{node.name}</span>
        {/* Онлайн пользователей */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20">
          <Users size={13} className="text-sky-500 dark:text-sky-400" />
          <span className="text-sm font-bold text-sky-500 dark:text-sky-400">{node.usersOnline ?? 0}</span>
        </div>
        <span className={`text-sm font-bold px-3 py-1 rounded-full ${statusConfig.badge}`}>
          {statusConfig.label}
        </span>
        {/* ⋮ menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            disabled={!!isActing}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-overlay-md text-muted hover:text-primary transition-colors text-base disabled:opacity-40"
            title="Действия"
          >
            {isActing ? <span className="text-xs animate-spin inline-block">↻</span> : '⋮'}
          </button>
          {menuOpen && (
            <>
              {/* backdrop */}
              <div className="fixed inset-0 z-[10]" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-[20] w-44 rounded-xl border border-default bg-[var(--bg-base)] shadow-xl overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); onAction(node.uuid, 'restart') }}
                  disabled={!!isActing}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-sky-500 dark:text-sky-400 hover:bg-sky-500/10 transition-colors disabled:opacity-40"
                >
                  <span>↺</span> Перезапустить
                </button>
                {node.status === 'disabled' ? (
                  <button
                    onClick={() => { setMenuOpen(false); onAction(node.uuid, 'enable') }}
                    disabled={!!isActing}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-emerald-500 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                  >
                    <span>▶</span> Включить
                  </button>
                ) : (
                  <button
                    onClick={() => { setMenuOpen(false); onAction(node.uuid, 'disable') }}
                    disabled={!!isActing}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                  >
                    <span>⏸</span> Отключить
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body — 2 columns */}
      <div className="grid grid-cols-2 divide-x divide-default">

        {/* Информация + Трафик + Uptime */}
        <div className="px-4 py-3 space-y-1.5">
          <SectionTitle>Информация</SectionTitle>

          <Row label="Адрес" icon={<Globe size={12} />}>
            <button onClick={copyIp} className="font-mono text-violet-500 dark:text-violet-400 hover:opacity-75 transition-opacity flex items-center gap-1" title="Скопировать IP">
              {node.address}
              <span className="text-[10px] opacity-60">{copied ? '✓' : '⎘'}</span>
            </button>
          </Row>

          {node.port && (
            <Row label="Порт" icon={<PlugZap size={12} />}>
              <span className="font-mono text-primary">{node.port}</span>
            </Row>
          )}

          <Row label="Xray" icon={<Zap size={12} />}>
            <span className="font-mono text-amber-500 dark:text-amber-400">{node.xrayVersion || '—'}</span>
          </Row>

          <Row label="Xray запущен" icon={xrayRunning ? <CheckCircle2 size={12} /> : <XCircle size={12} />}>
            <span className={xrayRunning ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}>
              {xrayRunning ? '✓ Да' : '✗ Нет'}
            </span>
          </Row>

          <Row label="Последняя связь" icon={<Clock size={12} />}>
            <span className="text-primary">{timeAgo(node.lastSeenAt)}</span>
          </Row>

          <Row label="Трафик" icon={<HardDrive size={12} />}>
            <span className="font-mono text-primary">{formatBytes(node.trafficUsedBytes || 0)}</span>
          </Row>

          <Row label="Uptime" icon={<Timer size={12} />}>
            <span className="font-mono text-emerald-500 dark:text-emerald-400">{formatUptime(node.xrayUptime)}</span>
          </Row>
        </div>

        {/* Скорость + Версии */}
        <div className="px-4 py-3 space-y-1.5">
          <SectionTitle>Скорость</SectionTitle>

          <Row label="Загрузка" icon={<ArrowDownToLine size={12} />}>
            <span className="font-mono text-sky-500 dark:text-sky-400">
              {bw && bw.downloadSpeedBps > 0 ? formatSpeed(bw.downloadSpeedBps) : '—'}
            </span>
          </Row>

          <Row label="Отдача" icon={<ArrowUpFromLine size={12} />}>
            <span className="font-mono text-emerald-500 dark:text-emerald-400">
              {bw && bw.uploadSpeedBps > 0 ? formatSpeed(bw.uploadSpeedBps) : '—'}
            </span>
          </Row>

          <div className="pt-2 border-t border-default space-y-1.5">
            <SectionTitle>Версии</SectionTitle>
            {node.nodeVersion && (
              <Row label="node" icon={<Box size={12} />}>
                <span className="font-mono text-violet-500 dark:text-violet-400">{node.nodeVersion}</span>
              </Row>
            )}
            {node.xrayVersion && (
              <Row label="xray" icon={<Cpu size={12} />}>
                <span className="font-mono text-amber-500 dark:text-amber-400">{node.xrayVersion}</span>
              </Row>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

const EMPTY_FORM = { name: '', address: '', port: '62050' }

export default function RwNodes() {
  const toast = useToastContext()
  const { profileId } = useRwProfile()
  const [nodes, setNodes] = useState<RwNode[]>([])
  const [bandwidth, setBandwidth] = useState<Record<string, BandwidthNode>>({})
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

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

  const loadBandwidth = useCallback((pid: string | undefined) => {
    getRwNodesBandwidthRealtime(pid).then((data: any) => {
      const arr: any[] = Array.isArray(data) ? data : (data?.response ?? data?.nodes ?? [])
      const map: Record<string, BandwidthNode> = {}
      arr.forEach((item: any) => {
        const uuid = item.nodeUuid || item.uuid
        if (uuid) {
          map[uuid] = {
            nodeUuid: uuid,
            downloadSpeedBps: parseInt(item.downloadSpeedBps ?? item.download_speed_bps ?? 0, 10) || 0,
            uploadSpeedBps: parseInt(item.uploadSpeedBps ?? item.upload_speed_bps ?? 0, 10) || 0,
          }
        }
      })
      setBandwidth(map)
    }).catch(() => {})
  }, [])

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
        usersOnline: n.usersOnline ?? n.users_online ?? 0,
        trafficUsedBytes: n.trafficUsedBytes ?? n.traffic_used_bytes ?? n.trafficTotal ?? n.traffic_total_bytes ?? 0,
        trafficToday: n.trafficToday ?? n.traffic_today ?? n.trafficTodayBytes ?? n.traffic_today_bytes ?? 0,
        xrayUptime: n.xrayUptime,
        countryCode: n.countryCode,
        // isXrayRunning may not exist in standard Remnawave API — null means infer from status
        isXrayRunning: (n.isXrayRunning != null) ? Boolean(n.isXrayRunning) : ((n.is_xray_running != null) ? Boolean(n.is_xray_running) : null),
      }))
      list.sort((a, b) => {
        const order = { offline: 0, online: 1, disabled: 2 }
        return (order[a.status as keyof typeof order] ?? 1) - (order[b.status as keyof typeof order] ?? 1)
      })
      setNodes(list)
      loadBandwidth(profileId || undefined)
    } catch (e: any) {
      if (!silent) toast.showError('Ошибка', e?.message || 'Не удалось загрузить ноды')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [profileId, loadBandwidth])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const interval = setInterval(() => load(true), 15000)
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">Ноды Remnawave</h1>
          <p className="text-sm text-muted mt-0.5">Управление серверами и агентами</p>
        </div>
        <button onClick={() => load()} disabled={loading} className="px-3 py-1.5 text-xs rounded-xl border border-default text-muted hover:text-primary disabled:opacity-40 transition-colors">↻</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Всего', value: stats.total, color: 'text-primary' },
          { label: 'Online', value: stats.online, color: 'text-emerald-500 dark:text-emerald-400' },
          { label: 'Offline', value: stats.offline, color: 'text-red-500 dark:text-red-400' },
          { label: 'Отключено', value: stats.disabled, color: 'text-muted' },
          { label: 'Пользователей', value: stats.usersOnline, color: 'text-sky-500 dark:text-sky-400' },
        ].map((s, i) => (
          <div key={s.label} style={{ animation: 'fadeInUp 0.3s ease-out both', animationDelay: `${i * 0.06}s` }}>
            <div className="rounded-2xl border border-default bg-overlay-xs p-4">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted mt-1">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Node cards */}
      {loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-2xl border border-default bg-overlay-xs p-4 animate-pulse space-y-3">
              <div className="h-4 w-40 bg-overlay-md rounded" />
              <div className="h-20 bg-overlay-md rounded" />
            </div>
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <div className="rounded-2xl border border-default bg-overlay-xs text-center py-10 text-muted">Нет нод</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {nodes.map(n => (
            <NodeCard
              key={n.uuid}
              node={n}
              bw={bandwidth[n.uuid]}
              onAction={handleAction}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}

      {/* Edit/Create modal */}
      {(editNode || showCreate) && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-overlay-md">
          <div className="rounded-2xl border border-default bg-[var(--bg-base)] p-6 w-96 space-y-4 shadow-2xl">
            <div className="text-base font-semibold text-primary">{editNode ? 'Редактировать ноду' : 'Добавить ноду'}</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">Название</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-overlay-sm border border-default text-primary focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Адрес (IP или домен)</label>
                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-overlay-sm border border-default text-primary focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Порт агента</label>
                <input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-overlay-sm border border-default text-primary focus:outline-none focus:border-[var(--accent)]" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setEditNode(null); setShowCreate(false) }}
                className="flex-1 py-2 rounded-xl border border-default text-muted text-sm hover:text-primary transition-colors">Отмена</button>
              <button onClick={saveNode} disabled={formLoading || !form.name.trim() || !form.address.trim()}
                className="flex-1 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30 font-semibold text-sm disabled:opacity-50 transition-colors">
                {formLoading ? '...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
