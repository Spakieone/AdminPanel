import { useState, useEffect, useCallback } from 'react'
import { getRwUsers, enableRwUser, disableRwUser, deleteRwUser, resetRwUserTraffic } from '../api/remnawave-v2'
import { useToastContext } from '../contexts/ToastContext'
import { useRwProfile } from '../hooks/useRwProfile'

type RwUser = {
  uuid: string
  username: string
  shortUuid?: string
  status: string
  usedTraffic: number
  trafficLimitBytes: number
  expireAt: string | null
  lastActiveAt: string | null
  onlineAt: string | null
  createdAt: string
}

type Stats = { total: number; active: number; disabled: number; expired: number; online: number }

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function timeAgo(s: string | null): string {
  if (!s) return '—'
  const diff = Math.floor((Date.now() - new Date(s).getTime()) / 1000)
  if (diff < 60) return `${diff}с назад`
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`
  return `${Math.floor(diff / 86400)}д назад`
}

function statusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'active': return 'text-emerald-400 bg-emerald-400/10'
    case 'disabled': return 'text-white/40 bg-white/5'
    case 'expired': return 'text-amber-400 bg-amber-400/10'
    case 'limited': return 'text-orange-400 bg-orange-400/10'
    default: return 'text-white/40 bg-white/5'
  }
}

function statusLabel(status: string): string {
  switch (status?.toLowerCase()) {
    case 'active': return 'Активен'
    case 'disabled': return 'Отключён'
    case 'expired': return 'Истёк'
    case 'limited': return 'Лимит'
    default: return status || '—'
  }
}

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '...')[] = []
  pages.push(1)
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}

export default function RwUsers() {
  const toast = useToastContext()
  const { profileId } = useRwProfile()
  const [users, setUsers] = useState<RwUser[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, disabled: 0, expired: 0, online: 0 })
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [perPage, setPerPage] = useState(50)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await getRwUsers({ page, per_page: perPage, search: search || undefined, status: statusFilter || undefined }, profileId || undefined)
      const list: RwUser[] = (data?.users ?? data?.response ?? []).map((u: any) => ({
        uuid: u.uuid || u.id || '',
        username: u.username || u.name || '',
        shortUuid: u.shortUuid || u.short_uuid,
        status: u.status || '',
        usedTraffic: Number(u.usedTraffic ?? u.used_traffic ?? 0),
        trafficLimitBytes: Number(u.trafficLimitBytes ?? u.traffic_limit_bytes ?? 0),
        expireAt: u.expireAt ?? u.expire_at ?? null,
        lastActiveAt: u.lastActiveAt ?? u.last_active_at ?? null,
        onlineAt: u.onlineAt ?? u.online_at ?? null,
        createdAt: u.createdAt ?? u.created_at ?? '',
      }))
      setUsers(list)
      const total = data?.total ?? data?.meta?.total ?? list.length
      setTotalCount(total)
      setTotalPages(Math.max(1, Math.ceil(total / perPage)))
      const s: Stats = {
        total: data?.meta?.total ?? total,
        active: data?.meta?.active ?? list.filter(u => u.status === 'active').length,
        disabled: data?.meta?.disabled ?? list.filter(u => u.status === 'disabled').length,
        expired: data?.meta?.expired ?? list.filter(u => u.status === 'expired').length,
        online: data?.meta?.online ?? data?.onlineCount ?? 0,
      }
      setStats(s)
    } catch (e: any) {
      if (!silent) toast.showError('Ошибка', e?.message || 'Не удалось загрузить пользователей')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, perPage, search, statusFilter, profileId])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => load(true), 30000)
    return () => clearInterval(interval)
  }, [load])

  const handleSearch = (v: string) => { setSearch(v); setPage(1) }
  const handleStatus = (v: string) => { setStatusFilter(v === statusFilter ? '' : v); setPage(1) }
  const handlePerPage = (v: number) => { setPerPage(v); setPage(1) }

  const doAction = async (uuid: string, action: 'enable' | 'disable' | 'reset' | 'delete') => {
    setActionLoading(`${uuid}:${action}`)
    try {
      const pid = profileId || undefined
      if (action === 'enable') await enableRwUser(uuid, pid)
      else if (action === 'disable') await disableRwUser(uuid, pid)
      else if (action === 'reset') await resetRwUserTraffic(uuid, pid)
      else if (action === 'delete') { await deleteRwUser(uuid, pid); setConfirmDelete(null) }
      toast.showSuccess('Готово', '')
      load(true)
    } catch (e: any) {
      toast.showError('Ошибка', e?.message || 'Не удалось выполнить действие')
    } finally {
      setActionLoading(null)
    }
  }

  const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div className="glass-card p-4 rounded-xl">
      <div className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-white/45 mt-1">{label}</div>
    </div>
  )

  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, totalCount)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Пользователи Remnawave</h1>
        <p className="text-sm text-white/45 mt-0.5">VPN пользователи с трафиком и статусами</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Всего', value: stats.total, color: 'text-white' },
          { label: 'Активных', value: stats.active, color: 'text-emerald-400' },
          { label: 'Отключённых', value: stats.disabled, color: 'text-white/40' },
          { label: 'Истёкших', value: stats.expired, color: 'text-amber-400' },
          { label: 'Онлайн', value: stats.online, color: 'text-sky-400' },
        ].map((s, i) => (
          <div key={s.label} style={{ animation: 'fadeInUp 0.3s ease-out both', animationDelay: `${i * 0.06}s` }}>
            <StatCard label={s.label} value={s.value} color={s.color} />
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Поиск по имени, email..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="flex-1 min-w-48 px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-[var(--accent)]"
        />
        {['active', 'disabled', 'expired'].map(s => (
          <button
            key={s}
            onClick={() => handleStatus(s)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              statusFilter === s
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                : 'border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
            }`}
          >
            {statusLabel(s)}
          </button>
        ))}
        <button
          onClick={() => load()}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-white/50 hover:text-white/70 disabled:opacity-40"
        >
          ↻ Обновить
        </button>
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-white/40 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Пользователь</th>
                <th className="px-4 py-3 text-left">Статус</th>
                <th className="px-4 py-3 text-left">Трафик</th>
                <th className="px-4 py-3 text-left">Истекает</th>
                <th className="px-4 py-3 text-left">Последняя активность</th>
                <th className="px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="px-4 py-3"><div className="h-4 w-28 bg-white/5 rounded animate-pulse" style={{ animationDelay: `${i * 0.05}s` }} /><div className="h-3 w-16 bg-white/5 rounded animate-pulse mt-1.5" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 bg-white/5 rounded-full animate-pulse" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-20 bg-white/5 rounded animate-pulse" /><div className="h-1 w-24 bg-white/5 rounded-full mt-2 animate-pulse" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-16 bg-white/5 rounded animate-pulse" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-20 bg-white/5 rounded animate-pulse" /></td>
                    <td className="px-4 py-3"><div className="flex gap-1.5 justify-end"><div className="h-6 w-10 bg-white/5 rounded-lg animate-pulse" /><div className="h-6 w-6 bg-white/5 rounded-lg animate-pulse" /><div className="h-6 w-6 bg-white/5 rounded-lg animate-pulse" /></div></td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-white/30 text-sm">
                    {search || statusFilter ? 'Ничего не найдено' : 'Нет пользователей'}
                  </td>
                </tr>
              ) : users.map((u, i) => {
                const usedPct = u.trafficLimitBytes > 0 ? Math.min(100, (u.usedTraffic / u.trafficLimitBytes) * 100) : 0
                const isActing = actionLoading?.startsWith(u.uuid)
                return (
                  <tr key={u.uuid} className="border-b border-white/5 hover:bg-white/3 transition-colors" style={{ animation: 'fadeInUp 0.25s ease-out both', animationDelay: `${i * 0.03}s` }}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{u.username}</div>
                      {u.shortUuid && <div className="text-xs text-white/30 font-mono">{u.shortUuid}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(u.status)}`}>
                        {statusLabel(u.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-white/70 text-xs">
                        {formatBytes(u.usedTraffic)}
                        {u.trafficLimitBytes > 0 && <span className="text-white/35"> / {formatBytes(u.trafficLimitBytes)}</span>}
                      </div>
                      {u.trafficLimitBytes > 0 && (
                        <div className="mt-1 h-1 w-24 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${usedPct > 90 ? 'bg-red-500' : usedPct > 70 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                            style={{ width: `${usedPct}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/50 text-xs">{formatDate(u.expireAt)}</td>
                    <td className="px-4 py-3 text-white/50 text-xs">{timeAgo(u.lastActiveAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 justify-end">
                        {u.status === 'active' ? (
                          <button
                            onClick={() => doAction(u.uuid, 'disable')}
                            disabled={!!isActing}
                            className="px-2 py-1 text-xs rounded-lg border border-white/10 text-white/50 hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-40 transition-colors"
                          >Откл</button>
                        ) : (
                          <button
                            onClick={() => doAction(u.uuid, 'enable')}
                            disabled={!!isActing}
                            className="px-2 py-1 text-xs rounded-lg border border-white/10 text-white/50 hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-40 transition-colors"
                          >Вкл</button>
                        )}
                        <button
                          onClick={() => doAction(u.uuid, 'reset')}
                          disabled={!!isActing}
                          className="px-2 py-1 text-xs rounded-lg border border-white/10 text-white/50 hover:border-sky-500/40 hover:text-sky-400 disabled:opacity-40 transition-colors"
                        >↺</button>
                        <button
                          onClick={() => setConfirmDelete(u.uuid)}
                          disabled={!!isActing}
                          className="px-2 py-1 text-xs rounded-lg border border-white/10 text-white/50 hover:border-red-500/40 hover:text-red-400 disabled:opacity-40 transition-colors"
                        >✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/8" style={{ animation: 'fadeIn 0.3s ease-out both', animationDelay: '0.15s' }}>
            <div className="flex items-center gap-3 text-xs text-white/35">
              <span>{from}–{to} из {totalCount.toLocaleString()}</span>
              <select
                value={perPage}
                onChange={e => handlePerPage(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white/60 text-xs focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                {[25, 50, 100].map(n => <option key={n} value={n}>{n} / стр.</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 text-white/50 hover:text-white/70 hover:border-white/20 disabled:opacity-30 transition-colors text-sm"
              >←</button>
              {getPageNumbers(page, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="w-8 h-8 flex items-center justify-center text-white/25 text-xs">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                      page === p
                        ? 'bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30'
                        : 'border border-white/10 text-white/50 hover:text-white/70 hover:border-white/20'
                    }`}
                  >{p}</button>
                )
              )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 text-white/50 hover:text-white/70 hover:border-white/20 disabled:opacity-30 transition-colors text-sm"
              >→</button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 modal-backdrop">
          <div className="glass-card p-6 rounded-2xl w-80 space-y-4 modal-content">
            <div className="text-base font-semibold text-white">Удалить пользователя?</div>
            <div className="text-sm text-white/55">Это действие необратимо.</div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-xl border border-white/15 text-white/60 text-sm"
              >Отмена</button>
              <button
                onClick={() => doAction(confirmDelete, 'delete')}
                className="flex-1 py-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-semibold"
              >Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
