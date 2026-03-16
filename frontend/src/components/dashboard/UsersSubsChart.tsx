import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { useEffect, useState } from 'react'

function useIsDark() {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return isDark
}

interface UsersSubsChartProps {
  daily: any[]
  monthly: any[]
  subDaily: any[]
  subMonthly: any[]
}

function fmtDayLabel(isoDate: string) {
  const s = String(isoDate || '').trim()
  if (!s) return '—'
  const d = new Date(`${s}T00:00:00`)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function fmtMonthLabel(month: string) {
  const s = String(month || '').trim()
  if (!s) return '—'
  const m = s.slice(0, 7)
  const [y, mm] = m.split('-')
  if (!y || !mm) return s
  return `${mm}.${y}`
}

export default function UsersSubsChart({ daily, monthly, subDaily, subMonthly }: UsersSubsChartProps) {
  const isDark = useIsDark()
  const [period, setPeriod] = useState<'daily' | 'monthly'>('daily')
  const rows = period === 'monthly' ? monthly.slice(-12) : daily.slice(-30)
  const categories = rows.map((r: any) =>
    period === 'monthly' ? fmtMonthLabel(r?.month) : fmtDayLabel(r?.date),
  )
  const usersVals = rows.map((r: any) => Number(r?.users ?? 0))

  const subsRows = period === 'monthly' ? subMonthly.slice(-12) : subDaily.slice(-30)
  const subsByKey = new Map<string, any>()
  for (const r of subsRows) {
    const key = period === 'monthly' ? String(r?.month || '') : String(r?.date || '')
    subsByKey.set(key, r)
  }
  const subsNewVals = rows.map((r: any) => {
    const key = period === 'monthly' ? String(r?.month || '') : String(r?.date || '')
    const sr: any = subsByKey.get(key)
    return Number(sr?.new ?? sr?.created ?? sr?.added ?? 0)
  })

  const options: ApexOptions = {
    legend: { show: true, position: 'top', horizontalAlign: 'left', labels: { colors: '#9CA3AF' } },
    colors: [`var(--accent)`, '#22c55e'],
    chart: { fontFamily: 'Inter, sans-serif', height: 310, type: 'line', toolbar: { show: false }, zoom: { enabled: false }, foreColor: '#6B7280', background: 'transparent' },
    stroke: { curve: 'straight', width: [2, 2] },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.55, opacityTo: 0 } },
    markers: { size: 0, strokeColors: '#fff', strokeWidth: 2, hover: { size: 6 } },
    grid: { borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)', xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
    dataLabels: { enabled: false },
    tooltip: { theme: isDark ? 'dark' : 'light', enabled: true },
    xaxis: {
      type: 'category',
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
      labels: { rotate: -45, rotateAlways: true, hideOverlappingLabels: true, style: { colors: '#6B7280', fontSize: '11px' } },
    },
    yaxis: {
      labels: { style: { fontSize: '12px', colors: ['#6B7280'] } },
      title: { text: '', style: { fontSize: '0px' } },
    },
  }

  const series = [
    { name: 'Пользователи', data: usersVals },
    { name: 'Подписки (новые)', data: subsNewVals },
  ]

  return (
    <div className="rounded-2xl border border-default bg-overlay-xs px-5 pb-5 pt-5 sm:px-6 sm:pt-6">
      <div className="flex flex-col gap-5 mb-6 sm:flex-row sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-primary">Пользователи и подписки</h3>
          <p className="mt-1 text-muted text-theme-sm">
            {period === 'monthly' ? 'Последние 12 месяцев' : 'Последние 30 дней'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPeriod('daily')}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${period === 'daily' ? 'bg-accent-10 text-[var(--accent)] border-[var(--accent)]' : 'text-muted bg-overlay-md border-transparent'}`}
          >
            30 дней
          </button>
          <button
            type="button"
            onClick={() => setPeriod('monthly')}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${period === 'monthly' ? 'bg-accent-10 text-[var(--accent)] border-[var(--accent)]' : 'text-muted bg-overlay-md border-transparent'}`}
          >
            12 мес
          </button>
        </div>
      </div>
      <div className="-ml-4 -mr-2">
        <Chart options={options} series={series} type="area" height={310} />
      </div>
    </div>
  )
}
