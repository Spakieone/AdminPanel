import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import ModalShell from '../common/ModalShell'
import CapybaraLoader from '../common/CapybaraLoader'
import { GradientAlert } from '../common/GradientAlert'
import { getBotConfigAsync } from '../../utils/botConfig'
import { getBotUtmTagStats, getUtmDailyStats, type UtmDailyStat } from '../../api/botApi'
import { buildChartThemeOptions } from '../../utils/chartTheme'

// Lazy loading для графиков
const MixedChart = lazy(() => import('react-chartjs-2').then((module) => ({ default: module.Chart })))

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

type UtmTag = {
  id?: number
  name?: string
  code?: string
  type?: string
  created_by?: number
  created_at?: string
  registrations?: number
  trials?: number
  payments?: number
  total_amount?: number
  monthly?: Array<{
    month: string
    registrations: number
    trials: number
    new_purchases_count: number
    new_purchases_amount: number
    repeat_purchases_count: number
    repeat_purchases_amount: number
  }>
  [key: string]: any
}

function formatMonthLabel(monthKey: string): string {
  // YYYY-MM -> MM.YYYY
  const [y, m] = monthKey.split('-')
  if (!y || !m) return monthKey
  return `${m}.${y}`
}

function formatDayLabel(dateKey: string): string {
  // YYYY-MM-DD -> DD.MM
  const parts = dateKey.split('-')
  if (parts.length !== 3) return dateKey
  return `${parts[2]}.${parts[1]}`
}

function getMoscowTodayStr(): string {
  const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000
  const nowMsk = new Date(Date.now() + MOSCOW_OFFSET_MS)
  const y = nowMsk.getUTCFullYear()
  const m = String(nowMsk.getUTCMonth() + 1).padStart(2, '0')
  const d = String(nowMsk.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map((v) => Number(v))
  if (!y || !m || !d) return dateStr
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function addMonths(monthStr: string, months: number): string {
  const [y, m] = monthStr.split('-').map((v) => Number(v))
  if (!y || !m) return monthStr
  const dt = new Date(Date.UTC(y, m - 1, 1))
  dt.setUTCMonth(dt.getUTCMonth() + months)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  return `${yy}-${mm}`
}

export default function UtmStatsModal({
  isOpen,
  utm,
  onClose,
}: {
  isOpen: boolean
  utm: UtmTag
  onClose: () => void
}) {
  const code = String(utm?.code || '').trim()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<UtmTag | null>(null)
  const [dailyStats, setDailyStats] = useState<UtmDailyStat[]>([])
  
  const [period, setPeriod] = useState<'days' | 'months'>('days')
  const [daysRange, setDaysRange] = useState<30 | 90 | 180 | 365>(30)
  const [showTable, setShowTable] = useState(false)
  const [showEmptyDays, setShowEmptyDays] = useState(false)
  const [onlyPurchaseDays, setOnlyPurchaseDays] = useState(false)

  const loadStats = useCallback(async () => {
    if (!code) return
    setError(null)
    setLoading(true)
    try {
      const config = await getBotConfigAsync()
      if (!config) throw new Error('Нет активного профиля. Создайте профиль в настройках.')
      
      // Load both monthly and daily stats in parallel
      const [monthlyData, dailyData] = await Promise.all([
        getBotUtmTagStats(config, code),
        getUtmDailyStats(config, code),
      ])
      
      setStats(monthlyData)
      setDailyStats(dailyData?.daily || [])
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки статистики UTM')
    } finally {
      setLoading(false)
    }
  }, [code])

  useEffect(() => {
    if (!isOpen) return
    setStats(null)
    setDailyStats([])
    setShowTable(false)
    setShowEmptyDays(false)
    setOnlyPurchaseDays(false)
    loadStats()
  }, [isOpen, loadStats])

  const monthlySeries = useMemo(() => {
    const monthly = stats?.monthly || utm?.monthly || []
    if (!Array.isArray(monthly) || monthly.length === 0) return []
    const normalized = monthly
      .map((m: any) => ({
        month: String(m.month || '').slice(0, 7),
        registrations: Number(m.registrations || 0),
        trials: Number(m.trials || 0),
        new_purchases_count: Number(m.new_purchases_count || 0),
        new_purchases_amount: Number(m.new_purchases_amount || 0),
        repeat_purchases_count: Number(m.repeat_purchases_count || 0),
        repeat_purchases_amount: Number(m.repeat_purchases_amount || 0),
      }))
      .filter((m) => m.month)
      .sort((a, b) => a.month.localeCompare(b.month))
    return normalized
  }, [stats, utm])

  // Normalize daily series: always show continuous range (fills missing days with zeros)
  const filledDailySeries = useMemo(() => {
    const end = getMoscowTodayStr()
    const start = addDays(end, -(daysRange - 1))
    const byDate = new Map<string, UtmDailyStat>()
    ;(dailyStats || []).forEach((d) => {
      if (!d?.date) return
      byDate.set(String(d.date).slice(0, 10), {
        date: String(d.date).slice(0, 10),
        registrations: Number((d as any).registrations || 0),
        trials: Number((d as any).trials || 0),
        new_purchases_count: Number((d as any).new_purchases_count || 0),
        new_purchases_amount: Number((d as any).new_purchases_amount || 0),
        repeat_purchases_count: Number((d as any).repeat_purchases_count || 0),
        repeat_purchases_amount: Number((d as any).repeat_purchases_amount || 0),
      })
    })
    const out: UtmDailyStat[] = []
    for (let i = 0; i < daysRange; i++) {
      const date = addDays(start, i)
      out.push(
        byDate.get(date) || {
          date,
          registrations: 0,
          trials: 0,
          new_purchases_count: 0,
          new_purchases_amount: 0,
          repeat_purchases_count: 0,
          repeat_purchases_amount: 0,
        },
      )
    }
    return out
  }, [dailyStats, daysRange])

  const rawDailySeriesInRange = useMemo(() => {
    const end = getMoscowTodayStr()
    const start = addDays(end, -(daysRange - 1))
    return (dailyStats || [])
      .map((d: any) => ({
        date: String(d?.date || '').slice(0, 10),
        registrations: Number(d?.registrations || 0),
        trials: Number(d?.trials || 0),
        new_purchases_count: Number(d?.new_purchases_count || 0),
        new_purchases_amount: Number(d?.new_purchases_amount || 0),
        repeat_purchases_count: Number(d?.repeat_purchases_count || 0),
        repeat_purchases_amount: Number(d?.repeat_purchases_amount || 0),
      }))
      .filter((d) => d.date && d.date >= start && d.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [dailyStats, daysRange])

  const purchaseDaysSeries = useMemo(() => {
    return rawDailySeriesInRange.filter((d) => {
      const c = (d.new_purchases_count || 0) + (d.repeat_purchases_count || 0)
      const a = (d.new_purchases_amount || 0) + (d.repeat_purchases_amount || 0)
      return c > 0 || a > 0
    })
  }, [rawDailySeriesInRange])

  const activityDaysSeries = useMemo(() => {
    return rawDailySeriesInRange.filter((d) => {
      const c = (d.new_purchases_count || 0) + (d.repeat_purchases_count || 0)
      const a = (d.new_purchases_amount || 0) + (d.repeat_purchases_amount || 0)
      return (d.registrations || 0) > 0 || (d.trials || 0) > 0 || c > 0 || a > 0
    })
  }, [rawDailySeriesInRange])

  const daysSeriesForView = useMemo(() => {
    if (showEmptyDays) return filledDailySeries
    return onlyPurchaseDays ? purchaseDaysSeries : activityDaysSeries
  }, [activityDaysSeries, filledDailySeries, onlyPurchaseDays, purchaseDaysSeries, showEmptyDays])

  // Monthly series fallback from daily (if monthly missing) + fill gaps between months
  const filledMonthlySeries = useMemo(() => {
    let base = monthlySeries
    if (!base || base.length === 0) {
      const grouped = new Map<string, any>()
      for (const d of dailyStats || []) {
        const key = String(d?.date || '').slice(0, 7)
        if (!key) continue
        const curr =
          grouped.get(key) ||
          ({
            month: key,
            registrations: 0,
            trials: 0,
            new_purchases_count: 0,
            new_purchases_amount: 0,
            repeat_purchases_count: 0,
            repeat_purchases_amount: 0,
          } as any)
        curr.registrations += Number((d as any).registrations || 0)
        curr.trials += Number((d as any).trials || 0)
        curr.new_purchases_count += Number((d as any).new_purchases_count || 0)
        curr.new_purchases_amount += Number((d as any).new_purchases_amount || 0)
        curr.repeat_purchases_count += Number((d as any).repeat_purchases_count || 0)
        curr.repeat_purchases_amount += Number((d as any).repeat_purchases_amount || 0)
        grouped.set(key, curr)
      }
      base = [...grouped.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)))
    }
    if (!base || base.length === 0) return []
    const start = base[0].month
    const end = base[base.length - 1].month
    const byMonth = new Map<string, any>()
    base.forEach((m: any) => byMonth.set(String(m.month).slice(0, 7), m))
    const out: any[] = []
    let cursor = start
    // cap to 36 months to avoid accidental huge ranges
    for (let i = 0; i < 36; i++) {
      const row =
        byMonth.get(cursor) ||
        ({
          month: cursor,
          registrations: 0,
          trials: 0,
          new_purchases_count: 0,
          new_purchases_amount: 0,
          repeat_purchases_count: 0,
          repeat_purchases_amount: 0,
        } as any)
      out.push(row)
      if (cursor === end) break
      cursor = addMonths(cursor, 1)
    }
    return out
  }, [dailyStats, monthlySeries])

  // Base chart options factory — reads CSS vars at call time (theme-aware)
  const makeBaseOptions = useCallback((maxTicks: number) => {
    return buildChartThemeOptions({
      legend: true,
      xGrid: false,
      yGrid: true,
      maxXTicks: maxTicks,
    }) as any
  }, [])

  const maxTicks = daysRange === 30 ? 10 : daysRange === 90 ? 12 : 15

  // Series data
  const baseSeriesForPeriod = useMemo(() => {
    const series = period === 'days' ? daysSeriesForView : filledMonthlySeries
    if (!series || series.length === 0) return null

    const labels =
      period === 'days'
        ? (series as any[]).map((d) => formatDayLabel(String(d.date)))
        : (series as any[]).map((m) => formatMonthLabel(String(m.month)))

    return {
      labels,
      registrations: (series as any[]).map((x) => Number(x.registrations || 0)),
      trials:        (series as any[]).map((x) => Number(x.trials || 0)),
      newCount:      (series as any[]).map((x) => Number(x.new_purchases_count || 0)),
      repeatCount:   (series as any[]).map((x) => Number(x.repeat_purchases_count || 0)),
      newAmount:     (series as any[]).map((x) => Math.round(Number(x.new_purchases_amount || 0))),
      repeatAmount:  (series as any[]).map((x) => Math.round(Number(x.repeat_purchases_amount || 0))),
    }
  }, [daysSeriesForView, filledMonthlySeries, period])

  // Chart 1 — Воронка: Регистрации → Триалы (grouped bars)
  const funnelChart = useMemo(() => {
    if (!baseSeriesForPeriod) return null
    const { labels, registrations, trials } = baseSeriesForPeriod
    const barStyle = { borderWidth: 0, borderRadius: 4, borderSkipped: false as const, barPercentage: 0.8, categoryPercentage: 0.75 }
    return {
      labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'Регистрации',
          data: registrations,
          backgroundColor: 'rgba(59, 130, 246, 0.75)',
          hoverBackgroundColor: 'rgba(59, 130, 246, 1)',
          yAxisID: 'y',
          ...barStyle,
        },
        {
          type: 'bar' as const,
          label: 'Триалы',
          data: trials,
          backgroundColor: 'rgba(34, 197, 94, 0.75)',
          hoverBackgroundColor: 'rgba(34, 197, 94, 1)',
          yAxisID: 'y',
          ...barStyle,
        },
      ],
    }
  }, [baseSeriesForPeriod])

  // Chart 2 — Покупки: новые и повторные (stacked bars)
  const purchasesChart = useMemo(() => {
    if (!baseSeriesForPeriod) return null
    const { labels, newCount, repeatCount } = baseSeriesForPeriod
    const barStyle = { borderWidth: 0, borderRadius: 4, borderSkipped: false as const, barPercentage: 0.8, categoryPercentage: 0.75 }
    return {
      labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'Новые покупки',
          data: newCount,
          backgroundColor: 'rgba(168, 85, 247, 0.80)',
          hoverBackgroundColor: 'rgba(168, 85, 247, 1)',
          stack: 'p',
          yAxisID: 'y',
          ...barStyle,
        },
        {
          type: 'bar' as const,
          label: 'Повторные',
          data: repeatCount,
          backgroundColor: 'rgba(6, 182, 212, 0.80)',
          hoverBackgroundColor: 'rgba(6, 182, 212, 1)',
          stack: 'p',
          yAxisID: 'y',
          ...barStyle,
        },
      ],
    }
  }, [baseSeriesForPeriod])

  // Chart 3 — Выручка (bars stacked + line total)
  const revenueChart = useMemo(() => {
    if (!baseSeriesForPeriod) return null
    const { labels, newAmount, repeatAmount } = baseSeriesForPeriod
    const total = newAmount.map((v, i) => v + repeatAmount[i])
    const barStyle = { borderWidth: 0, borderRadius: 0, borderSkipped: false as const, barPercentage: 0.85, categoryPercentage: 0.8 }
    return {
      labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'Новые (₽)',
          data: newAmount,
          backgroundColor: 'rgba(168, 85, 247, 0.70)',
          hoverBackgroundColor: 'rgba(168, 85, 247, 0.95)',
          stack: 'r',
          yAxisID: 'y',
          order: 2,
          ...barStyle,
        },
        {
          type: 'bar' as const,
          label: 'Повторные (₽)',
          data: repeatAmount,
          backgroundColor: 'rgba(6, 182, 212, 0.70)',
          hoverBackgroundColor: 'rgba(6, 182, 212, 0.95)',
          stack: 'r',
          yAxisID: 'y',
          order: 2,
          ...barStyle,
        },
        {
          type: 'line' as const,
          label: 'Итого (₽)',
          data: total,
          borderColor: 'rgba(251, 191, 36, 1)',
          backgroundColor: 'rgba(251, 191, 36, 0.08)',
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: 'rgba(251, 191, 36, 1)',
          borderWidth: 2,
          tension: 0.3,
          fill: false,
          yAxisID: 'y',
          order: 1,
        },
      ],
    }
  }, [baseSeriesForPeriod])

  const funnelOptions = useMemo(() => {
    const base = makeBaseOptions(maxTicks)
    return {
      ...base,
      animation: { duration: 400 },
      plugins: {
        ...base.plugins,
        legend: { ...base.plugins?.legend, position: 'top' as const },
        tooltip: {
          ...base.plugins?.tooltip,
          callbacks: {
            label: (ctx: any) => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString('ru-RU')}`,
          },
        },
      },
      scales: {
        ...base.scales,
        x: { ...base.scales?.x, stacked: false },
        y: { ...base.scales?.y, beginAtZero: true, stacked: false },
      },
    }
  }, [makeBaseOptions, maxTicks])

  const purchasesOptions = useMemo(() => {
    const base = makeBaseOptions(maxTicks)
    return {
      ...base,
      animation: { duration: 400 },
      plugins: {
        ...base.plugins,
        legend: { ...base.plugins?.legend, position: 'top' as const },
        tooltip: {
          ...base.plugins?.tooltip,
          callbacks: {
            label: (ctx: any) => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString('ru-RU')}`,
            footer: (items: any[]) => {
              const sum = items.reduce((s, i) => s + Number(i.parsed.y || 0), 0)
              return sum > 0 ? `Итого: ${sum.toLocaleString('ru-RU')}` : undefined
            },
          },
        },
      },
      scales: {
        ...base.scales,
        x: { ...base.scales?.x, stacked: true },
        y: { ...base.scales?.y, beginAtZero: true, stacked: true },
      },
    }
  }, [makeBaseOptions, maxTicks])

  const revenueOptions = useMemo(() => {
    const base = makeBaseOptions(maxTicks)
    const ruFmt = (v: any) => `${Number(v).toLocaleString('ru-RU')} ₽`
    return {
      ...base,
      animation: { duration: 400 },
      plugins: {
        ...base.plugins,
        legend: { ...base.plugins?.legend, position: 'top' as const },
        tooltip: {
          ...base.plugins?.tooltip,
          callbacks: {
            label: (ctx: any) => ` ${ctx.dataset.label}: ${ruFmt(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        ...base.scales,
        x: { ...base.scales?.x, stacked: true },
        y: {
          ...base.scales?.y,
          beginAtZero: true,
          stacked: false,
          ticks: { ...base.scales?.y?.ticks, callback: ruFmt },
        },
      },
    }
  }, [makeBaseOptions, maxTicks])

  const headerActions = useMemo(() => {
    return (
      <button
        onClick={() => loadStats()}
        className="px-3 py-1.5 rounded-lg border border-default bg-overlay-xs hover:bg-overlay-sm transition-colors text-sm text-primary"
        title="Обновить"
      >
        Обновить
      </button>
    )
  }, [loadStats])

  // Тоталы
  const totals = useMemo(() => {
    return {
      registrations: stats?.registrations ?? utm?.registrations ?? 0,
      trials: stats?.trials ?? utm?.trials ?? 0,
      payments: stats?.payments ?? utm?.payments ?? 0,
      total_amount: stats?.total_amount ?? utm?.total_amount ?? 0,
    }
  }, [stats, utm])

  const periodTotals = useMemo(() => {
    const series = period === 'days' ? daysSeriesForView : filledMonthlySeries
    return (series as any[]).reduce(
      (acc, d) => ({
        registrations: acc.registrations + Number(d.registrations || 0),
        trials: acc.trials + Number(d.trials || 0),
        new_purchases_count: acc.new_purchases_count + Number(d.new_purchases_count || 0),
        new_purchases_amount: acc.new_purchases_amount + Number(d.new_purchases_amount || 0),
        repeat_purchases_count: acc.repeat_purchases_count + Number(d.repeat_purchases_count || 0),
        repeat_purchases_amount: acc.repeat_purchases_amount + Number(d.repeat_purchases_amount || 0),
      }),
      { registrations: 0, trials: 0, new_purchases_count: 0, new_purchases_amount: 0, repeat_purchases_count: 0, repeat_purchases_amount: 0 },
    )
  }, [filledDailySeries, filledMonthlySeries, period])

  const periodTabs = [
    { key: 'days', label: 'По дням' },
    { key: 'months', label: 'По месяцам' },
  ] as const

  const dayRangeOptions = [
    { value: 30, label: '30 дней' },
    { value: 90, label: '90 дней' },
    { value: 180, label: '180 дней' },
    { value: 365, label: '1 год' },
  ] as const

  return (
    <ModalShell
      isOpen={isOpen}
      title={utm?.name ? `UTM: ${utm.name}` : `UTM: ${code || '—'}`}
      subtitle={code ? `Код: ${code} • Тип: ${utm?.type || '—'}` : '—'}
      onClose={onClose}
      closeButtonTone="danger"
      shellTone="neutral"
      size="full"
      headerActions={headerActions}
    >
      {error ? (
        <div className="mb-4">
          <GradientAlert variant="error" title="Ошибка" description={error} onClose={() => setError(null)} />
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {/* Тоталы (общие из API бота) */}
        <div className="glass-panel p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{totals.registrations.toLocaleString('ru-RU')}</div>
            <div className="text-sm text-muted">Регистрации</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-500">{totals.trials.toLocaleString('ru-RU')}</div>
            <div className="text-sm text-muted">Триалы</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--accent)]">{totals.payments.toLocaleString('ru-RU')}</div>
            <div className="text-sm text-muted">Новые покупки</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-500">{totals.total_amount.toLocaleString('ru-RU')} ₽</div>
            <div className="text-sm text-muted">Сумма</div>
          </div>
        </div>

        {/* Period Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-default">
            {periodTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setPeriod(tab.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  period === tab.key
                    ? 'bg-blue-500/30 text-primary'
                    : 'bg-overlay-xs text-muted hover:bg-overlay-sm hover:text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {period === 'days' && (
            <>
              <div className="flex rounded-lg overflow-hidden border border-default ml-2">
                {dayRangeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDaysRange(opt.value)}
                    className={`px-3 py-2 text-sm font-medium transition-colors ${
                      daysRange === opt.value
                        ? 'bg-accent-25 text-primary'
                        : 'bg-overlay-xs text-muted hover:bg-overlay-sm hover:text-primary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowEmptyDays((v) => !v)}
                className={`px-3 py-2 rounded-lg border border-default text-sm font-medium transition-colors ml-2 ${
                  showEmptyDays ? 'bg-blue-500/30 text-primary' : 'bg-overlay-xs text-muted hover:bg-overlay-sm hover:text-primary'
                }`}
                title={showEmptyDays ? 'Показываем пустые дни' : 'Скрываем пустые дни (только дни с покупками)'}
              >
                Пустые дни
              </button>
              <button
                onClick={() => setOnlyPurchaseDays((v) => !v)}
                className={`px-3 py-2 rounded-lg border border-default text-sm font-medium transition-colors ml-2 ${
                  onlyPurchaseDays ? 'bg-accent-25 text-primary' : 'bg-overlay-xs text-muted hover:bg-overlay-sm hover:text-primary'
                }`}
                title={onlyPurchaseDays ? 'Показываем только дни с покупками' : 'Показываем дни с любой активностью (рег/триал/покупки)'}
              >
                Только покупки
              </button>
            </>
          )}

          {loading && <div className="text-sm text-muted ml-2">загрузка…</div>}
        </div>

        {/* Charts (main) */}
        <div className="glass-panel p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-primary text-base sm:text-lg font-semibold truncate">
                {period === 'days' ? `Графики • ${daysRange} дней` : 'Графики • по месяцам'}
              </div>
              <div className="text-xs text-muted mt-0.5">
                Итого: {periodTotals.registrations.toLocaleString('ru-RU')} рег • {periodTotals.trials.toLocaleString('ru-RU')} триал •{' '}
                {periodTotals.new_purchases_count.toLocaleString('ru-RU')} новых • {periodTotals.repeat_purchases_count.toLocaleString('ru-RU')} повтор •{' '}
                {Math.round(periodTotals.new_purchases_amount + periodTotals.repeat_purchases_amount).toLocaleString('ru-RU')} ₽
              </div>
            </div>
            <button
              onClick={() => setShowTable((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-default bg-overlay-xs hover:bg-overlay-sm transition-colors text-sm text-primary"
              title="Показать/скрыть таблицу"
            >
              Таблица
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {/* Row 1: Воронка + Покупки */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-default bg-overlay-xs p-3">
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-semibold text-primary leading-tight">Регистрации и триалы</div>
                    <div className="text-xs text-muted">Сколько пришло и попробовало</div>
                  </div>
                </div>
                {funnelChart ? (
                  <div className="h-[260px]">
                    <Suspense fallback={<CapybaraLoader />}>
                      <MixedChart type="bar" data={funnelChart as any} options={funnelOptions as any} />
                    </Suspense>
                  </div>
                ) : (
                  <div className="py-10 text-center text-muted text-sm">{loading ? 'Загрузка…' : 'Нет данных'}</div>
                )}
              </div>

              <div className="rounded-xl border border-default bg-overlay-xs p-3">
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-semibold text-primary leading-tight">Покупки</div>
                    <div className="text-xs text-muted">Новые и повторные платежи</div>
                  </div>
                </div>
                {purchasesChart ? (
                  <div className="h-[260px]">
                    <Suspense fallback={<CapybaraLoader />}>
                      <MixedChart type="bar" data={purchasesChart as any} options={purchasesOptions as any} />
                    </Suspense>
                  </div>
                ) : (
                  <div className="py-10 text-center text-muted text-sm">{loading ? 'Загрузка…' : 'Нет данных'}</div>
                )}
              </div>
            </div>

            {/* Row 2: Выручка (full width) */}
            <div className="rounded-xl border border-default bg-overlay-xs p-3">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-primary leading-tight">Выручка</div>
                  <div className="text-xs text-muted">Сумма новых и повторных покупок, линия — итого</div>
                </div>
              </div>
              {revenueChart ? (
                <div className="h-[220px]">
                  <Suspense fallback={<CapybaraLoader />}>
                    <MixedChart type="bar" data={revenueChart as any} options={revenueOptions as any} />
                  </Suspense>
                </div>
              ) : (
                <div className="py-10 text-center text-muted text-sm">{loading ? 'Загрузка…' : 'Нет данных'}</div>
              )}
            </div>
          </div>
        </div>

        {/* Details table */}
        {showTable ? (
          <div className="glass-panel p-3 sm:p-4">
            <div className="text-primary text-base sm:text-lg font-semibold mb-3">
              {period === 'days' ? `Таблица • ${daysRange} дней` : 'Таблица • по месяцам'}
            </div>
            <div className="max-h-[240px] overflow-auto">
              {period === 'days' ? (
                daysSeriesForView.length > 0 ? (
                  <table className="w-full min-w-[820px] text-left">
                    <thead className="sticky top-0 bg-[var(--table-thead-bg)] backdrop-blur">
                      <tr className="border-b border-default text-[12px] uppercase tracking-wider text-muted">
                        <th className="py-2 px-2">Дата</th>
                        <th className="py-2 px-2 text-right">Рег</th>
                        <th className="py-2 px-2 text-right">Триал</th>
                        <th className="py-2 px-2 text-right">Новые</th>
                        <th className="py-2 px-2 text-right">Сумма новых</th>
                        <th className="py-2 px-2 text-right">Повтор</th>
                        <th className="py-2 px-2 text-right">Сумма повтор</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...daysSeriesForView].reverse().map((d: any) => {
                        return (
                          <tr key={d.date} className="border-b border-subtle odd:bg-transparent even:bg-overlay-xs hover:bg-overlay-sm transition-colors">
                            <td className="py-2 px-2 text-primary text-[13px] font-semibold whitespace-nowrap" title={d.date}>
                              {formatDayLabel(d.date)}
                            </td>
                            <td className="py-2 px-2 text-right text-secondary text-[13px]">{d.registrations.toLocaleString('ru-RU')}</td>
                            <td className="py-2 px-2 text-right text-secondary text-[13px]">{Number((d as any).trials || 0).toLocaleString('ru-RU')}</td>
                            <td className="py-2 px-2 text-right text-secondary text-[13px]">{d.new_purchases_count.toLocaleString('ru-RU')}</td>
                            <td className="py-2 px-2 text-right text-green-500 text-[13px] font-semibold whitespace-nowrap">
                              {Math.round(d.new_purchases_amount).toLocaleString('ru-RU')} ₽
                            </td>
                            <td className="py-2 px-2 text-right text-secondary text-[13px]">{d.repeat_purchases_count.toLocaleString('ru-RU')}</td>
                            <td className="py-2 px-2 text-right text-purple-500 text-[13px] font-semibold whitespace-nowrap">
                              {Math.round(d.repeat_purchases_amount).toLocaleString('ru-RU')} ₽
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-10 text-center text-muted">{loading ? 'Загрузка…' : 'Нет покупок за период'}</div>
                )
              ) : filledMonthlySeries.length > 0 ? (
                <table className="w-full min-w-[860px] text-left">
                  <thead className="sticky top-0 bg-[var(--table-thead-bg)]">
                    <tr className="border-b border-default text-[12px] uppercase tracking-wider text-muted">
                      <th className="py-2 px-2">Месяц</th>
                      <th className="py-2 px-2 text-right">Рег</th>
                      <th className="py-2 px-2 text-right">Триал</th>
                      <th className="py-2 px-2 text-right">Новые</th>
                      <th className="py-2 px-2 text-right">Сумма новых</th>
                      <th className="py-2 px-2 text-right">Повтор</th>
                      <th className="py-2 px-2 text-right">Сумма повтор</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filledMonthlySeries].reverse().map((m: any) => {
                      return (
                        <tr key={m.month} className="border-b border-subtle odd:bg-transparent even:bg-overlay-xs hover:bg-overlay-sm transition-colors">
                          <td className="py-2 px-2 text-primary text-[13px] font-semibold whitespace-nowrap" title={m.month}>
                            {formatMonthLabel(m.month)}
                          </td>
                          <td className="py-2 px-2 text-right text-secondary text-[13px]">{Number(m.registrations || 0).toLocaleString('ru-RU')}</td>
                          <td className="py-2 px-2 text-right text-secondary text-[13px]">{Number(m.trials || 0).toLocaleString('ru-RU')}</td>
                          <td className="py-2 px-2 text-right text-secondary text-[13px]">{Number(m.new_purchases_count || 0).toLocaleString('ru-RU')}</td>
                          <td className="py-2 px-2 text-right text-[var(--accent)] text-[13px] font-semibold whitespace-nowrap">
                            {Math.round(Number(m.new_purchases_amount || 0)).toLocaleString('ru-RU')} ₽
                          </td>
                          <td className="py-2 px-2 text-right text-secondary text-[13px]">{Number(m.repeat_purchases_count || 0).toLocaleString('ru-RU')}</td>
                          <td className="py-2 px-2 text-right text-purple-500 text-[13px] font-semibold whitespace-nowrap">
                            {Math.round(Number(m.repeat_purchases_amount || 0)).toLocaleString('ru-RU')} ₽
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="py-10 text-center text-muted">{loading ? 'Загрузка…' : 'Нет данных'}</div>
              )}
            </div>
          </div>
        ) : null}

        {/* Info */}
        <div className="text-xs text-muted text-center">
          Дневная статистика: новые покупки = первый платёж пользователя, повторные = все последующие.
          <br />
          Исключены: referral (реферальные) и admin (ручные) начисления.
        </div>
      </div>
    </ModalShell>
  )
}
