import { useState, useEffect, useCallback, useMemo } from 'react'
import { getRwUsers, getRwSystemStats, getRwNodesV2 } from '../api/remnawave-v2'
import { useToastContext } from '../contexts/ToastContext'
import { useRwProfile } from '../hooks/useRwProfile'
import {
  Search, RefreshCw, Filter, ChevronDown, ChevronUp,
  ArrowUp, ArrowDown,
} from 'lucide-react'
import DarkSelect from '../components/common/DarkSelect'
import * as Flags from 'country-flag-icons/react/3x2'

type RwUser = {
  uuid: string
  username: string
  shortUuid?: string
  telegramId?: number | null
  status: string
  usedTraffic: number
  trafficLimitBytes: number
  expireAt: string | null
  onlineAt: string | null
  createdAt: string
  lastNodeUuid?: string | null
}

type Stats = { total: number; active: number; disabled: number; limited: number; expired: number; online: number }

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

/** Сортировка с null/пустыми значениями в конец */
function cmpNullable(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
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

function statusBadge(status: string) {
  const s = status?.toLowerCase()
  const cfg: Record<string, { label: string; cls: string }> = {
    active: { label: 'Активен', cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    disabled: { label: 'Отключён', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
    expired: { label: 'Истёк', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    limited: { label: 'Лимит', cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  }
  const c = cfg[s] || { label: status || '—', cls: 'bg-white/10 text-[var(--text-muted)] border-white/10' }
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${c.cls}`}>{c.label}</span>
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

function TrafficBar({ used, limit, status }: { used: number; limit: number; status?: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const isUnlimited = !limit || limit <= 0
  const isLimited = status === 'limited'
  const isDanger = isLimited || pct >= 90

  const barBg = isUnlimited
    ? 'from-sky-600/30 to-cyan-600/30 border-sky-500/25'
    : isDanger
    ? 'from-red-600/40 to-red-500/30 border-red-500/30'
    : pct >= 70
    ? 'from-amber-600/40 to-amber-500/30 border-amber-500/30'
    : 'from-emerald-600/30 to-cyan-600/30 border-emerald-500/25'

  const fillCls = isDanger ? 'bg-red-500/30' : pct >= 70 ? 'bg-amber-500/30' : 'bg-emerald-500/30'
  const fillPct = isLimited ? 100 : pct

  return (
    <div className={`relative h-6 rounded-full overflow-hidden bg-gradient-to-r ${barBg} border`}>
      {!isUnlimited && fillPct > 0 && (
        <div className={`absolute inset-y-0 left-0 rounded-full ${fillCls}`} style={{ width: `${fillPct}%` }} />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xs font-medium drop-shadow-sm ${isDanger && !isUnlimited ? 'text-red-300' : 'text-[var(--text-primary)]'}`}>
          {formatBytes(used)} / {isUnlimited ? '∞' : formatBytes(limit)}
        </span>
      </div>
    </div>
  )
}

function OnlineIndicator({ onlineAt }: { onlineAt: string | null }) {
  if (!onlineAt) return <span className="text-red-400 text-sm">Не подключался</span>
  const diffH = (Date.now() - new Date(onlineAt).getTime()) / 3600000
  const dotColor = diffH < 1 ? 'bg-emerald-500' : diffH < 24 ? 'bg-amber-500' : diffH < 168 ? 'bg-orange-500' : 'bg-gray-500'
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className="text-[var(--text-secondary)] text-sm">{timeAgo(onlineAt)}</span>
    </div>
  )
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

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'created_at', label: 'Дата создания' },
  { value: 'username', label: 'Имя' },
  { value: 'status', label: 'Статус' },
  { value: 'used_traffic_bytes', label: 'Трафик' },
  { value: 'online_at', label: 'Активность' },
  { value: 'expire_at', label: 'Истекает' },
]

export default function RwUsers() {
  const toast = useToastContext()
  const { profileId } = useRwProfile()
  const [allUsers, setAllUsers] = useState<RwUser[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, disabled: 0, limited: 0, expired: 0, online: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [nodeMap, setNodeMap] = useState<Record<string, { name: string; countryCode?: string }>>({})

  const loadNodes = useCallback(async () => {
    try {
      const data = await getRwNodesV2(profileId || undefined)
      const resp = data?.response ?? data
      const nodes: any[] = Array.isArray(resp) ? resp : (resp?.nodes ?? resp?.items ?? [])
      const map: Record<string, { name: string; countryCode?: string }> = {}
      for (const n of nodes) {
        if (n.uuid && n.name) map[n.uuid] = { name: n.name, countryCode: n.countryCode }
      }
      setNodeMap(map)
    } catch { /* тихо */ }
  }, [profileId])

  const loadStats = useCallback(async () => {
    try {
      const data = await getRwSystemStats(profileId || undefined)
      const resp = data?.response ?? data
      const sc = resp?.users?.statusCounts || {}
      const os = resp?.onlineStats || {}
      setStats({
        total: resp?.users?.totalUsers ?? 0,
        active: sc.ACTIVE ?? 0,
        disabled: sc.DISABLED ?? 0,
        limited: sc.LIMITED ?? 0,
        expired: sc.EXPIRED ?? 0,
        online: os.onlineNow ?? 0,
      })
    } catch { /* тихо */ }
  }, [profileId])

  const loadUsers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await getRwUsers({
        page: 1, size: 1000,
        search: search || undefined,
        status: statusFilter ? statusFilter.toUpperCase() : undefined,
      } as any, profileId || undefined)
      const resp = data?.response ?? data
      const rawUsers: any[] = Array.isArray(resp) ? resp : (resp?.users ?? resp?.items ?? [])
      const list: RwUser[] = rawUsers.map((u: any) => {
        const ut = u.userTraffic || {}
        return {
          uuid: u.uuid || u.id || '',
          username: u.username || u.name || '',
          shortUuid: u.shortUuid || u.short_uuid,
          telegramId: u.telegramId ?? u.telegram_id ?? null,
          status: (u.status || '').toLowerCase(),
          usedTraffic: Number(ut.usedTrafficBytes ?? u.usedTrafficBytes ?? u.usedTraffic ?? u.used_traffic_bytes ?? 0),
          trafficLimitBytes: Number(u.trafficLimitBytes ?? u.traffic_limit_bytes ?? 0),
          expireAt: u.expireAt ?? u.expire_at ?? null,
          onlineAt: ut.onlineAt ?? u.onlineAt ?? u.online_at ?? null,
          createdAt: u.createdAt ?? u.created_at ?? '',
          lastNodeUuid: ut.lastConnectedNodeUuid ?? u.lastConnectedNodeUuid ?? null,
        }
      })
      setAllUsers(list)
    } catch (e: any) {
      if (!silent) toast.showError('Ошибка', e?.message || 'Не удалось загрузить пользователей')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [search, statusFilter, profileId])

  useEffect(() => { loadUsers(); loadStats(); loadNodes() }, [loadUsers, loadStats, loadNodes])
  useEffect(() => {
    const interval = setInterval(() => { loadUsers(true); loadStats() }, 30000)
    return () => clearInterval(interval)
  }, [loadUsers, loadStats])

  // Клиентская сортировка
  const sortedUsers = useMemo(() => {
    const sorted = [...allUsers]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'username': cmp = a.username.localeCompare(b.username); break
        case 'status': cmp = a.status.localeCompare(b.status); break
        case 'used_traffic_bytes': {
          const pctA = a.trafficLimitBytes > 0 ? a.usedTraffic / a.trafficLimitBytes : -1
          const pctB = b.trafficLimitBytes > 0 ? b.usedTraffic / b.trafficLimitBytes : -1
          cmp = pctA - pctB
          break
        }
        case 'online_at': cmp = cmpNullable(a.onlineAt, b.onlineAt); break
        case 'expire_at': cmp = cmpNullable(a.expireAt, b.expireAt); break
        case 'created_at': default: cmp = cmpNullable(a.createdAt, b.createdAt); break
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
    return sorted
  }, [allUsers, sortBy, sortOrder])

  // Клиентская пагинация
  const totalCount = sortedUsers.length
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage))
  const pagedUsers = useMemo(() => {
    const start = (page - 1) * perPage
    return sortedUsers.slice(start, start + perPage)
  }, [sortedUsers, page, perPage])

  const handleSearch = (v: string) => { setSearch(v); setPage(1) }
  const handlePerPage = (v: number) => { setPerPage(v); setPage(1) }
  const handleSort = (field: string) => {
    if (sortBy === field) { setSortOrder(o => o === 'asc' ? 'desc' : 'asc') }
    else { setSortBy(field); setSortOrder('desc') }
    setPage(1)
  }


  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, totalCount)
  const activeFilterCount = (statusFilter ? 1 : 0)

  return (
    <div className="space-y-5">
      {/* Заголовок */}
      <div>
        <h1 className="text-xl font-bold text-primary">Пользователи Remnawave</h1>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Всего', value: stats.total, color: 'text-primary' },
          { label: 'Активных', value: stats.active, color: 'text-emerald-400' },
          { label: 'Отключённых', value: stats.disabled, color: 'text-red-400' },
          { label: 'Истёкших', value: stats.expired, color: 'text-amber-400' },
          { label: 'Онлайн', value: stats.online, color: 'text-sky-400' },
        ].map((s, i) => (
          <div key={s.label} style={{ animation: 'fadeInUp 0.3s ease-out both', animationDelay: `${i * 0.06}s` }}>
            <div className="rounded-2xl border border-default bg-overlay-xs p-4">
              <div className={`text-4xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
              <div className="text-xs text-muted mt-1">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Поиск + Фильтры + Сортировка */}
      <div className="rounded-2xl border border-default bg-overlay-xs p-4 space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Поиск по имени, email, UUID..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-10 pr-3 py-2 text-sm rounded-xl bg-overlay-sm border border-default text-primary placeholder:text-muted focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-colors ${
              activeFilterCount > 0 ? 'border-[var(--accent)]/50 text-[var(--accent)]' : 'border-default text-muted hover:text-primary'
            }`}
          >
            <Filter size={13} />
            Фильтры
            {activeFilterCount > 0 && (
              <span className="bg-[var(--accent)] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
            )}
            {showFilters ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          <div className="w-px h-5 bg-[var(--border-default)] hidden sm:block" />

          <button
            onClick={() => { setSortOrder(o => o === 'desc' ? 'asc' : 'desc'); setPage(1) }}
            className="w-8 h-8 flex items-center justify-center rounded-xl border border-default text-[var(--accent)] hover:bg-overlay-sm transition-colors"
            title={sortOrder === 'desc' ? 'По убыванию' : 'По возрастанию'}
          >
            {sortOrder === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
          </button>

          <DarkSelect
            value={sortBy}
            onChange={v => { setSortBy(v); setPage(1) }}
            groups={[{ options: SORT_OPTIONS.map(o => ({ value: o.value, label: o.label })) }]}
            buttonClassName="px-3 py-1.5 text-xs rounded-xl bg-overlay-sm border border-default text-primary"
          />

          <button
            onClick={() => { loadUsers(); loadStats() }}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-xl border border-default text-muted hover:text-primary disabled:opacity-40 transition-colors"
            title="Обновить"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {showFilters && (
          <div className="pt-3 border-t border-default space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1 block">Статус</label>
                <DarkSelect
                  value={statusFilter || '_all'}
                  onChange={v => { setStatusFilter(v === '_all' ? '' : v); setPage(1) }}
                  groups={[{ options: [
                    { value: '_all', label: 'Все статусы' },
                    { value: 'active', label: 'Активен' },
                    { value: 'disabled', label: 'Отключён' },
                    { value: 'limited', label: 'Лимит' },
                    { value: 'expired', label: 'Истёк' },
                  ] }]}
                  buttonClassName="w-full px-3 py-1.5 text-xs rounded-xl bg-overlay-sm border border-default text-primary"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1 block">На странице</label>
                <DarkSelect
                  value={String(perPage)}
                  onChange={v => handlePerPage(Number(v))}
                  groups={[{ options: [10, 25, 50, 100].map(n => ({ value: String(n), label: String(n) })) }]}
                  buttonClassName="w-full px-3 py-1.5 text-xs rounded-xl bg-overlay-sm border border-default text-primary"
                />
              </div>
            </div>
            {(statusFilter || search) && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted">
                  Найдено: <span className="font-semibold text-primary">{totalCount.toLocaleString()}</span> пользователей
                </span>
                <button
                  onClick={() => { setSearch(''); setStatusFilter(''); setPage(1) }}
                  className="text-xs text-[var(--accent)] hover:opacity-75"
                >
                  Сбросить фильтры
                </button>
              </div>
            )}
          </div>
        )}

        {!showFilters && statusFilter && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[11px] text-[var(--accent)]">
              Статус: {statusLabel(statusFilter)}
              <button onClick={() => { setStatusFilter(''); setPage(1) }} className="hover:opacity-75 ml-0.5">✕</button>
            </span>
          </div>
        )}
      </div>

      {/* Таблица */}
      <div className="rounded-2xl border border-default bg-overlay-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-default">
                {[
                  { label: 'Пользователь', field: 'username' },
                  { label: 'Статус', field: 'status' },
                  { label: 'Трафик', field: 'used_traffic_bytes' },
                  { label: 'Нода', field: '' },
                  { label: 'Активность', field: 'online_at' },
                  { label: 'Истекает', field: 'expire_at' },
                  { label: 'Создан', field: 'created_at' },
                ].map((col, ci) => (
                  <th key={ci} className="px-3 py-3 text-left">
                    {col.field ? (
                      <button
                        onClick={() => handleSort(col.field)}
                        className={`flex items-center gap-1 text-sm font-semibold uppercase tracking-wider transition-colors ${
                          sortBy === col.field ? 'text-[var(--accent)]' : 'text-muted hover:text-primary'
                        }`}
                      >
                        {col.label}
                        {sortBy === col.field && (sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                      </button>
                    ) : (
                      <span className="text-sm font-semibold text-muted uppercase tracking-wider">{col.label}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-default">
                    <td className="px-3 py-3"><div className="h-4 w-28 bg-overlay-md rounded animate-pulse" /><div className="h-3 w-16 bg-overlay-md rounded animate-pulse mt-1.5" /></td>
                    <td className="px-3 py-3"><div className="h-5 w-16 bg-overlay-md rounded-full animate-pulse" /></td>
                    <td className="px-3 py-3"><div className="h-6 w-full bg-overlay-md rounded-full animate-pulse" /></td>
                    <td className="px-3 py-3"><div className="h-4 w-16 bg-overlay-md rounded animate-pulse" /></td>
                    <td className="px-3 py-3"><div className="h-4 w-20 bg-overlay-md rounded animate-pulse" /></td>
                    <td className="px-3 py-3"><div className="h-4 w-16 bg-overlay-md rounded animate-pulse" /></td>
                    <td className="px-3 py-3"><div className="h-4 w-16 bg-overlay-md rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : pagedUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted text-sm">
                    {search || statusFilter ? 'Ничего не найдено' : 'Нет пользователей'}
                  </td>
                </tr>
              ) : pagedUsers.map((u, i) => {
                const nodeInfo = u.lastNodeUuid ? nodeMap[u.lastNodeUuid] || null : null
                return (
                  <tr key={u.uuid} className="border-b border-default last:border-b-0 hover:bg-overlay-sm transition-colors" style={{ animation: 'fadeInUp 0.25s ease-out both', animationDelay: `${i * 0.03}s` }}>
                    <td className="px-3 py-3">
                      <div className="font-medium text-primary text-sm truncate">{u.username}</div>
                      {u.telegramId && <div className="text-xs text-muted truncate">TG: {u.telegramId}</div>}
                    </td>
                    <td className="px-3 py-3">{statusBadge(u.status)}</td>
                    <td className="px-3 py-3">
                      <TrafficBar used={u.usedTraffic} limit={u.trafficLimitBytes} status={u.status} />
                    </td>
                    <td className="px-3 py-3">
                      {nodeInfo
                        ? <span className="flex items-center gap-1.5 text-secondary text-sm truncate"><FlagIcon code={nodeInfo.countryCode} /><span className="truncate">{nodeInfo.name}</span></span>
                        : <span className="text-muted text-sm">—</span>
                      }
                    </td>
                    <td className="px-3 py-3"><OnlineIndicator onlineAt={u.onlineAt} /></td>
                    <td className="px-3 py-3 text-secondary text-sm">{formatDate(u.expireAt)}</td>
                    <td className="px-3 py-3 text-secondary text-sm">{formatDate(u.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Пагинация */}
        {totalPages > 1 && (
          <div className="px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-default">
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>{from}–{to} из {totalCount.toLocaleString()}</span>
              <DarkSelect
                value={String(perPage)}
                onChange={v => handlePerPage(Number(v))}
                groups={[{ options: [10, 25, 50, 100].map(n => ({ value: String(n), label: `${n} / стр.` })) }]}
                buttonClassName="bg-overlay-sm border border-default rounded-lg px-2 py-1 text-primary text-xs"
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-default text-muted hover:text-primary disabled:opacity-30 transition-colors text-sm"
              >←</button>
              {getPageNumbers(page, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="w-8 h-8 flex items-center justify-center text-muted text-xs">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                      page === p
                        ? 'bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30'
                        : 'border border-default text-muted hover:text-primary'
                    }`}
                  >{p}</button>
                )
              )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-default text-muted hover:text-primary disabled:opacity-30 transition-colors text-sm"
              >→</button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
