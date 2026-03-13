import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  checkReadiness,
  getBotProfiles,
  getDashboardStats,
  type DashboardStats,
  getRemnawaveNodes,
  getRemnawaveOnlineHistory,
  type RemnawaveOnlineHistoryPoint,
} from '../api/client'
import { getBotConfigAsync } from '../utils/botConfig'
import { getPartnerStats, getPartnersList, type Partner, type PartnerStats } from '../api/botApi'
import * as Flags from 'country-flag-icons/react/3x2'
import CapybaraLoader from '../components/common/CapybaraLoader'
import { GradientAlert } from '../components/common/GradientAlert'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import CopyText from '../components/ui/CopyText'
import MetricCards from '../components/dashboard/MetricCards'
import PaymentsChart from '../components/dashboard/PaymentsChart'
import UsersSubsChart from '../components/dashboard/UsersSubsChart'
import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'

// Charts now use react-apexcharts (TailAdmin style)

type RemNodeItem = {
  id: string
  name: string
  status: 'online' | 'offline' | 'unknown'
  onlineUsers?: number | null
  countryCode?: string | null
}

function extractOnlineUsersCount(payload: any): number | null {
  if (!payload || typeof payload !== 'object') return null
  const candidates = [
    'online_users',
    'users_online',
    'onlineUsers',
    'usersOnline',
    'online_users_count',
    'onlineCount',
    'online_count',
    'online', // can be boolean OR number
    'usersOnlineCount',
  ]
  for (const k of candidates) {
    if (!(k in payload)) continue
    const raw = (payload as any)[k]
    if (typeof raw === 'boolean') continue
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw))
    if (typeof raw === 'string') {
      const n = Number.parseInt(raw, 10)
      if (Number.isFinite(n) && n >= 0) return n
    }
  }
  return null
}

function extractNodeStatus(payload: any): RemNodeItem['status'] {
  if (!payload || typeof payload !== 'object') return 'unknown'
  // Mirror backend logic (_get_node_status in backend/main.py)
  const isDisabled = Boolean((payload as any).isDisabled)
  if (isDisabled) return 'offline'

  const isConnected = (payload as any).isConnected
  if (isConnected === true) return 'online'
  if (isConnected === false) return 'offline'

  const status = (payload as any).status
  if (status) {
    const s = String(status).toLowerCase()
    if (s === 'online') return 'online'
    if (s === 'offline') return 'offline'
  }

  const online = (payload as any).online
  if (online === true) return 'online'
  if (online === false) return 'offline'

  const is_online = (payload as any).is_online
  if (is_online === true) return 'online'
  if (is_online === false) return 'offline'

  return 'unknown'
}

// EmojiIcon removed — TailAdmin uses SVG icons directly

function FlagEmoji({ code }: { code?: string | null }) {
  const cc = String(code || '').trim().toUpperCase()
  if (!cc) return <span className="text-xs font-mono text-dim">—</span>
  const FlagComp = (Flags as any)[cc] as React.ComponentType<{ className?: string; title?: string; style?: React.CSSProperties }>
  if (!FlagComp) return <span className="text-xs font-mono text-dim">{cc}</span>
  return (
    <span className="inline-flex shrink-0 items-center justify-center w-5 h-3.5 overflow-hidden rounded" style={{ minWidth: 20 }}>
      <FlagComp className="flag-svg" title={cc} style={{ width: 20, height: 14, display: 'block' }} />
    </span>
  )
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [readiness, setReadiness] = useState<{
    ready: boolean
    hasWarnings: boolean
    issues: string[]
    warnings: string[]
  } | null>(null)

  const [fastStats, setFastStats] = useState<DashboardStats | null>(null)

  const [rmwNodes, setRmwNodes] = useState<{ total: number; online: number; offline: number } | null>(null)
  const [rmwNodeItems, setRmwNodeItems] = useState<RemNodeItem[]>([])
  const [rmwOnlinePeriod, setRmwOnlinePeriod] = useState<'24h' | 'week'>('24h')
  const [rmwOnlineHistory, setRmwOnlineHistory] = useState<RemnawaveOnlineHistoryPoint[]>([])
  const [rmwProfileId, setRmwProfileId] = useState<string | null>(null)

  const [partnerStats, setPartnerStats] = useState<PartnerStats | null>(null)
  const [partners, setPartners] = useState<Partner[]>([])
  const [partnersSort, setPartnersSort] = useState<'invites' | 'balance'>('invites')

  const loadReadiness = useCallback(async () => {
    try {
      const result = (await checkReadiness()) as any
      if (result && typeof result === 'object') {
        setReadiness({
          ready: Boolean(result.ready),
          hasWarnings: Boolean(result.hasWarnings),
          issues: Array.isArray(result.issues) ? result.issues.map(String) : [],
          warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
        })
      }
    } catch {
      // ignore
    }
  }, [])

  const loadFastStats = useCallback(async () => {
    const stats = await getDashboardStats()
    setFastStats(stats)
  }, [])

  const loadRemnawave = useCallback(async () => {
    try {
      const profilesData = await getBotProfiles()
      const activeProfileId = String(profilesData?.activeProfileId || '').trim()
      if (!activeProfileId) {
        setRmwNodes(null)
        setRmwNodeItems([])
        setRmwOnlineHistory([])
        setRmwProfileId(null)
        return
      }
      setRmwProfileId(activeProfileId)

      let total = 0
      let online = 0
      let offline = 0
      const items: RemNodeItem[] = []

      // IMPORTANT: take nodes directly from Remnawave API (not monitoring/state),
      // so dashboard doesn't merge nodes from multiple Remnawave profiles.
      const rawNodes: any = await getRemnawaveNodes(activeProfileId).catch(() => null)
      const nodesArr: any[] =
        Array.isArray(rawNodes) ? rawNodes
          : Array.isArray(rawNodes?.response) ? rawNodes.response
          : Array.isArray(rawNodes?.nodes) ? rawNodes.nodes
          : Array.isArray(rawNodes?.data) ? rawNodes.data
          : []

      const byId = new Map<string, RemNodeItem>()
      for (const node of nodesArr) {
        if (!node || typeof node !== 'object') continue
        const nodeId = String((node as any).id ?? (node as any).uuid ?? '').trim()
        const safeId = nodeId || String((node as any).name || '').trim()
        if (!safeId) continue

        const name = String((node as any).name || (node as any).node_name || (node as any).nodeName || safeId).trim() || safeId
        const status = extractNodeStatus(node)
        const countryCode = ((node as any).country_code ?? (node as any).countryCode ?? (node as any).country ?? (node as any).cc ?? null) as any
        const onlineUsers = extractOnlineUsersCount(node)

        const prev = byId.get(safeId)
        if (!prev) {
          byId.set(safeId, {
            id: safeId,
            name,
            status,
            onlineUsers,
            countryCode: countryCode ? String(countryCode).trim().toUpperCase() : null,
          })
          continue
        }
        // Merge (keep "best" status and max onlineUsers)
        const rank = (s: RemNodeItem['status']) => (s === 'online' ? 2 : s === 'offline' ? 1 : 0)
        const nextStatus = rank(status) > rank(prev.status) ? status : prev.status
        const nextOnlineUsers =
          typeof onlineUsers === 'number' && typeof prev.onlineUsers === 'number'
            ? Math.max(prev.onlineUsers, onlineUsers)
            : typeof prev.onlineUsers === 'number'
              ? prev.onlineUsers
              : typeof onlineUsers === 'number'
                ? onlineUsers
                : null

        byId.set(safeId, {
          ...prev,
          name: prev.name || name,
          status: nextStatus,
          onlineUsers: nextOnlineUsers,
          countryCode: prev.countryCode || (countryCode ? String(countryCode).trim().toUpperCase() : null),
        })
      }

      for (const it of byId.values()) {
        total += 1
        if (it.status === 'online') online += 1
        else if (it.status === 'offline') offline += 1
        items.push(it)
      }

      items.sort((a, b) => {
        // Smart: online first, by onlineUsers desc; then offline; then unknown.
        const rank = (s: RemNodeItem['status']) => (s === 'online' ? 0 : s === 'offline' ? 1 : 2)
        const ra = rank(a.status)
        const rb = rank(b.status)
        if (ra !== rb) return ra - rb
        const da = typeof a.onlineUsers === 'number' ? a.onlineUsers : -1
        const db = typeof b.onlineUsers === 'number' ? b.onlineUsers : -1
        if (da !== db) return db - da
        return a.name.localeCompare(b.name)
      })

      setRmwNodes(total > 0 ? { total, online, offline } : null)
      setRmwNodeItems(items)
    } catch {
      setRmwNodes(null)
      setRmwNodeItems([])
      setRmwOnlineHistory([])
      setRmwProfileId(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!rmwProfileId) {
        setRmwOnlineHistory([])
        return
      }
      try {
        const res = await getRemnawaveOnlineHistory(rmwOnlinePeriod, rmwProfileId).catch(() => null)
        if (cancelled) return
        const hist = Array.isArray((res as any)?.history) ? ((res as any).history as RemnawaveOnlineHistoryPoint[]) : []
        setRmwOnlineHistory(hist)
      } catch {
        if (cancelled) return
        setRmwOnlineHistory([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [rmwOnlinePeriod, rmwProfileId])

  const loadPartners = useCallback(async () => {
    try {
      const cfg = await getBotConfigAsync()
      if (!cfg) {
        setPartnerStats(null)
        setPartners([])
        return
      }
      const [st, list] = await Promise.all([
        getPartnerStats(cfg).catch(() => null),
        getPartnersList(cfg, 200, 0).catch(() => null),
      ])
      setPartnerStats(st as any)
      const items = Array.isArray((list as any)?.items) ? ((list as any).items as Partner[]) : []
      setPartners(items)
    } catch {
      setPartnerStats(null)
      setPartners([])
    }
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([loadReadiness(), loadFastStats(), loadRemnawave(), loadPartners()])
    } catch (e: any) {
      setError(String(e?.message || 'Ошибка загрузки'))
    } finally {
      setLoading(false)
    }
  }, [loadFastStats, loadPartners, loadReadiness, loadRemnawave])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // Auto-refresh nodes + online history every 30s (lightweight, no full reload)
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadRemnawave()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [loadRemnawave])

  const onRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await loadAll()
    } finally {
      setRefreshing(false)
    }
  }, [loadAll, refreshing])

  const users = fastStats?.users ?? { total: 0, day: 0, yesterday: 0, week: 0, month: 0, prev_month: 0 }
  const finances = fastStats?.finances ?? { total: 0, day: 0, yesterday: 0, week: 0, month: 0, prev_month: 0 }
  const subs = fastStats?.subscriptions ?? { total: 0, active: 0, paid_active: 0, trial_active: 0, expired: 0 }
  const daily = useMemo(() => (Array.isArray(fastStats?.chart_daily) ? fastStats!.chart_daily : []), [fastStats])
  const monthly = useMemo(() => (Array.isArray(fastStats?.chart_monthly) ? fastStats!.chart_monthly : []), [fastStats])
  const subDaily = useMemo(() => (Array.isArray((fastStats as any)?.subscription_daily) ? ((fastStats as any).subscription_daily as any[]) : []), [fastStats])
  const subMonthly = useMemo(() => (Array.isArray((fastStats as any)?.subscription_monthly) ? ((fastStats as any).subscription_monthly as any[]) : []), [fastStats])
  const tariffStats = useMemo(() => (Array.isArray((fastStats as any)?.tariff_stats) ? ((fastStats as any).tariff_stats as any[]) : []), [fastStats])

  // Remnawave online history for ApexCharts — current period + previous period overlay
  const rmwOnlineApex = useMemo(() => {
    const rows = Array.isArray(rmwOnlineHistory) ? rmwOnlineHistory : []
    const now = Date.now()
    const periodMs = rmwOnlinePeriod === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    const fromTs = now - periodMs
    // Current period points
    const rawPoints = rows.filter((p) => Number(p?.timestamp || 0) >= fromTs)
    // Previous period points (same length, shifted back by periodMs)
    const prevFromTs = fromTs - periodMs
    const prevRawPoints = rows.filter((p) => {
      const ts = Number(p?.timestamp || 0)
      return ts >= prevFromTs && ts < fromTs
    })

    const targetPoints = rmwOnlinePeriod === 'week' ? 336 : 288

    function sample(pts: typeof rows) {
      if (pts.length <= targetPoints) return pts
      const step = Math.max(1, Math.ceil(pts.length / targetPoints))
      const sampled = pts.filter((_, idx) => idx % step === 0)
      if (sampled.length && sampled[sampled.length - 1]?.timestamp !== pts[pts.length - 1]?.timestamp) {
        sampled.push(pts[pts.length - 1])
      }
      return sampled.slice(-targetPoints)
    }

    const points = sample(rawPoints)
    const prevPoints = sample(prevRawPoints)

    const cats = points.map((p) => {
      const d = new Date(Number(p.timestamp || 0))
      return rmwOnlinePeriod === '24h'
        ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    })
    const data = points.map((p) => Number(p.count ?? 0))

    // Align prev data to same length as current (pad with null if shorter)
    const prevData: (number | null)[] = points.map((_, i) => {
      const pp = prevPoints[i]
      return pp != null ? Number(pp.count ?? 0) : null
    })

    const prevLabel = rmwOnlinePeriod === '24h' ? 'Вчера' : 'Прошлая неделя'
    const hasPrev = prevPoints.length > 0

    return { categories: cats, data, prevData, prevLabel, hasPrev }
  }, [rmwOnlineHistory, rmwOnlinePeriod])

  // Tariff popularity for ApexCharts
  const tariffApex = useMemo(() => {
    const rows = tariffStats.slice().sort((a: any, b: any) => Number(b?.count ?? 0) - Number(a?.count ?? 0))
    return {
      categories: rows.map((r: any) => `${String(r?.name || 'Тариф')}`),
      data: rows.map((r: any) => Number(r?.count ?? 0)),
    }
  }, [tariffStats])

  // ApexCharts options for Remnawave online
  const rmwApexOptions: ApexOptions = {
    colors: ['#22c55e', '#6B7280'],
    chart: { fontFamily: 'Inter, sans-serif', type: 'area', height: 310, toolbar: { show: false }, zoom: { enabled: false }, foreColor: '#6B7280', background: 'transparent' },
    stroke: { curve: 'smooth', width: [2, 1.5], dashArray: [0, 4] },
    fill: {
      type: 'gradient',
      gradient: {
        opacityFrom: [0.45, 0.1],
        opacityTo: [0, 0],
      },
    },
    markers: { size: 0, hover: { size: 5 } },
    grid: { borderColor: 'rgba(128,128,128,0.12)', xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
    dataLabels: { enabled: false },
    xaxis: { type: 'category', categories: rmwOnlineApex.categories, axisBorder: { show: false }, axisTicks: { show: false }, labels: { rotate: 0, hideOverlappingLabels: true, maxHeight: 40, style: { colors: '#6B7280' } } },
    yaxis: { labels: { style: { fontSize: '12px', colors: ['#6B7280'] } } },
    legend: { show: false },
    tooltip: {
      theme: 'dark',
      shared: true,
      custom: ({ series, dataPointIndex }: { series: number[][], dataPointIndex: number }) => {
        const cur = series[0]?.[dataPointIndex] ?? 0
        const prev = series[1]?.[dataPointIndex]
        const prevLabel = rmwOnlineApex.prevLabel
        let deltaHtml = ''
        if (prev != null && prev > 0) {
          const diff = cur - prev
          const pct = Math.round((diff / prev) * 100)
          const color = diff >= 0 ? '#22c55e' : '#ef4444'
          const sign = diff >= 0 ? '+' : ''
          deltaHtml = `<div style="margin-top:4px;font-size:11px;color:${color}">${sign}${diff} (${sign}${pct}%) vs ${prevLabel}</div>`
        }
        return `<div style="padding:8px 12px;font-size:13px;color:#f1f5f9">
          <div style="font-weight:600">${cur} онлайн</div>
          ${deltaHtml}
        </div>`
      },
    },
  }

  // ApexCharts options for tariff popularity
  const tariffApexOptions: ApexOptions = {
    colors: [`var(--accent)`],
    chart: { fontFamily: 'Inter, sans-serif', type: 'bar', toolbar: { show: false }, zoom: { enabled: false }, foreColor: '#6B7280', background: 'transparent' },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '70%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: tariffApex.categories, axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { colors: '#6B7280' } } },
    yaxis: { labels: { style: { fontSize: '12px', colors: ['#6B7280'] }, maxWidth: 200 } },
    grid: { borderColor: 'rgba(128,128,128,0.12)', xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
    tooltip: { theme: 'dark', y: { formatter: (val: number) => `${val} подписок` } },
  }

  // Card style constants
  const C = 'rounded-2xl border border-default bg-overlay-xs p-5 md:p-6'
  const pillActive = 'rounded-full px-3 py-1 text-xs font-medium bg-accent-10 text-[var(--accent)]'
  const pill = 'rounded-full px-3 py-1 text-xs font-medium text-muted bg-overlay-md'

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      {/* Alerts */}
      {readiness && (!readiness.ready || readiness.hasWarnings) && (
        <div className={`col-span-12 ${C}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-primary">
                {!readiness.ready ? 'Требуется настройка' : 'Предупреждения'}
              </h3>
              <p className="mt-1 text-sm text-muted">Проверь настройки панели и интеграций</p>
            </div>
            <OpenPanelSettingsButton label="Перейти в настройки" />
          </div>
          <GradientAlert
            variant={!readiness.ready ? 'error' : 'warning'}
            title={!readiness.ready ? 'Требуется настройка' : 'Предупреждения'}
            description={<>
              {readiness.issues.length > 0 && <ul className="list-disc list-inside mb-2 space-y-1">{readiness.issues.map((issue, idx) => <li key={idx}>{issue}</li>)}</ul>}
              {readiness.warnings.length > 0 && <ul className="list-disc list-inside space-y-1">{readiness.warnings.map((w, idx) => <li key={idx}>{w}</li>)}</ul>}
            </>}
          />
        </div>
      )}

      {error && (
        <div className={`col-span-12 ${C}`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-primary">Ошибка загрузки</h3>
              <p className="mt-1 text-sm text-muted">{error}</p>
            </div>
            <div className="flex gap-2">
              <OpenPanelSettingsButton />
              <button className={pill} type="button" onClick={() => void onRefresh()} disabled={refreshing}>{refreshing ? 'Обновляем…' : 'Обновить'}</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="col-span-12"><CapybaraLoader /></div>
      ) : (
        <>
          {/* Refresh */}
          <div className="col-span-12 flex items-center justify-end gap-3">
            <span className="text-xs text-muted">
              Обновлено: {fastStats?.cached_at ? new Date(fastStats.cached_at).toLocaleString('ru-RU') : '—'}
            </span>
            <button className={pill} type="button" onClick={() => void onRefresh()} disabled={refreshing}>
              {refreshing ? 'Обновляем…' : 'Обновить'}
            </button>
          </div>

          {/* Metric Cards — TailAdmin EcommerceMetrics style */}
          <div className="col-span-12">
            <MetricCards users={users} finances={finances} subs={subs} />
          </div>

          {/* Charts row: Payments + Users/Subs */}
          <div className="col-span-12 xl:col-span-7">
            <PaymentsChart daily={daily} monthly={monthly} />
          </div>

          <div className="col-span-12 xl:col-span-5">
            <UsersSubsChart daily={daily} monthly={monthly} subDaily={subDaily} subMonthly={subMonthly} />
          </div>

          {/* Remnawave Online chart */}
          {rmwProfileId && (
            <>
              <div className={`col-span-12 xl:col-span-7 ${C}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-primary">Онлайн Remnawave</h3>
                    <p className="mt-1 text-sm text-muted">{rmwOnlinePeriod === '24h' ? 'За 24 часа' : 'За неделю'}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={rmwOnlinePeriod === '24h' ? pillActive : pill} onClick={() => setRmwOnlinePeriod('24h')}>24ч</button>
                    <button type="button" className={rmwOnlinePeriod === 'week' ? pillActive : pill} onClick={() => setRmwOnlinePeriod('week')}>7д</button>
                  </div>
                </div>
                <div className="-ml-4 -mr-2">
                  {rmwOnlineApex.data.length > 0
                    ? <Chart
                        options={rmwApexOptions}
                        series={[
                          { name: 'Онлайн', data: rmwOnlineApex.data },
                          ...(rmwOnlineApex.hasPrev ? [{ name: rmwOnlineApex.prevLabel, data: rmwOnlineApex.prevData as number[] }] : []),
                        ]}
                        type="area"
                        height={310}
                      />
                    : <p className="text-sm text-muted">Нет данных</p>}
                </div>
              </div>

              {/* Nodes list */}
              <div className={`col-span-12 xl:col-span-5 ${C}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-primary">Ноды</h3>
                    <p className="mt-1 text-sm text-muted">По онлайну</p>
                  </div>
                  <span className="text-sm font-mono text-muted">{rmwNodes?.online ?? 0}/{rmwNodes?.total ?? 0}</span>
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                  {rmwNodeItems.slice().sort((a, b) => (Number(b.onlineUsers ?? -1) - Number(a.onlineUsers ?? -1))).slice(0, 50).map((n) => (
                    <div key={n.id} className="flex items-center justify-between gap-3 rounded-lg border border-default px-3 py-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FlagEmoji code={n.countryCode} />
                        <span className="text-sm font-medium text-primary break-words">{n.name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${n.status === 'online' ? 'bg-success-500/15 text-success-500' : n.status === 'offline' ? 'bg-error-500/15 text-error-500' : 'bg-overlay-sm text-muted'}`}>
                          {n.status}
                        </span>
                        <span className="text-sm font-mono text-secondary w-8 text-right">{typeof n.onlineUsers === 'number' ? n.onlineUsers.toLocaleString('ru-RU') : '—'}</span>
                      </div>
                    </div>
                  ))}
                  {rmwNodeItems.length === 0 && <p className="text-sm text-muted">Нет данных</p>}
                </div>
              </div>
            </>
          )}

          {/* Tariff popularity */}
          <div className={`col-span-12 ${C}`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-primary">Популярность тарифов</h3>
                <p className="mt-1 text-sm text-muted">По количеству подписок</p>
              </div>
            </div>
            <div className="max-w-full overflow-x-auto custom-scrollbar">
              <div style={{ minHeight: Math.min(600, Math.max(200, tariffApex.data.length * 30 + 60)) }}>
                {tariffApex.data.length > 0
                  ? <Chart options={tariffApexOptions} series={[{ name: 'Подписки', data: tariffApex.data }]} type="bar" height={Math.min(600, Math.max(200, tariffApex.data.length * 30 + 60))} />
                  : <p className="text-sm text-muted">Нет данных</p>}
              </div>
            </div>
          </div>

          {/* Partners */}
          <div className={`col-span-12 xl:col-span-7 ${C}`}>
            <h3 className="text-lg font-semibold text-primary mb-1">Партнёрская программа</h3>
            <p className="text-sm text-muted mb-4">Привлечено и выплаты</p>
            {/* Row 1: main stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">Партнёров</span>
                <div className="text-lg font-semibold text-primary font-mono">{Number(partnerStats?.total_partners ?? 0).toLocaleString('ru-RU')}</div>
              </div>
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">Суммарный баланс</span>
                <div className="text-lg font-semibold text-success-500 font-mono">{Number(partnerStats?.total_balance ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽</div>
              </div>
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">Привлечено всего</span>
                <div className="text-lg font-semibold text-primary font-mono">{Number(partnerStats?.total_referred ?? 0).toLocaleString('ru-RU')}</div>
              </div>
            </div>
            {/* Row 2: referrals breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">Сегодня</span>
                <div className="text-sm font-semibold text-primary font-mono">+{Number(partnerStats?.referred_today ?? 0).toLocaleString('ru-RU')}</div>
              </div>
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">Вчера</span>
                <div className="text-sm font-semibold text-primary font-mono">+{Number(partnerStats?.referred_yesterday ?? 0).toLocaleString('ru-RU')}</div>
              </div>
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">За неделю</span>
                <div className="text-sm font-semibold text-primary font-mono">+{Number(partnerStats?.referred_week ?? 0).toLocaleString('ru-RU')}</div>
              </div>
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">За месяц</span>
                <div className="text-sm font-semibold text-primary font-mono">+{Number(partnerStats?.referred_month ?? 0).toLocaleString('ru-RU')}</div>
              </div>
            </div>
            {/* Row 3: payouts */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">Выплаты сегодня</span>
                <div className="text-sm font-semibold text-success-500 font-mono">{Number(partnerStats?.paid_today_amount ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽</div>
              </div>
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">За месяц</span>
                <div className="text-sm font-semibold text-success-500 font-mono">{Number(partnerStats?.paid_month_amount ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽</div>
              </div>
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">Всего выплачено</span>
                <div className="text-sm font-semibold text-success-500 font-mono">{Number(partnerStats?.paid_total_amount ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽</div>
              </div>
              <div className="rounded-lg border border-default p-3">
                <span className="text-xs text-muted">Ожидают вывода</span>
                <div className="text-sm font-semibold text-warning-500 font-mono">{Number(partnerStats?.pending_withdrawals_count ?? 0)} ({Number(partnerStats?.pending_withdrawals_amount ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽)</div>
              </div>
            </div>
          </div>

          {/* Top partners */}
          <div className={`col-span-12 xl:col-span-5 ${C}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-primary">ТОП партнёров</h3>
              <div className="flex gap-2">
                <button type="button" className={partnersSort === 'invites' ? pillActive : pill} onClick={() => setPartnersSort('invites')}>Приглашения</button>
                <button type="button" className={partnersSort === 'balance' ? pillActive : pill} onClick={() => setPartnersSort('balance')}>Баланс</button>
              </div>
            </div>
            <div className="space-y-2">
              {partners.slice().sort((a, b) => partnersSort === 'balance' ? Number(b.balance || 0) - Number(a.balance || 0) : Number(b.referred_count || 0) - Number(a.referred_count || 0)).slice(0, 5).map((p, idx) => (
                <div key={`top-${partnersSort}-${p.tg_id}`} className="flex items-center justify-between gap-3 rounded-lg border border-default px-3 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-overlay-md text-sm font-mono text-muted">{idx + 1}</span>
                    <CopyText text={String(p.tg_id || '')} showToast={false} className="text-xs font-mono text-muted" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-success-500">{Number(p.balance || 0).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽</span>
                    <span className="text-xs text-muted">👥 {Number(p.referred_count || 0).toLocaleString('ru-RU')}</span>
                  </div>
                </div>
              ))}
              {partners.length === 0 && <p className="text-sm text-muted">Нет данных</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
