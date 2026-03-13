import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { useState } from 'react'

interface PaymentsChartProps {
  daily: any[]
  monthly: any[]
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

export default function PaymentsChart({ daily, monthly }: PaymentsChartProps) {
  const [period, setPeriod] = useState<'daily' | 'monthly'>('daily')
  const rows = period === 'monthly' ? monthly.slice(-12) : daily.slice(-30)
  const categories = rows.map((r: any) =>
    period === 'monthly' ? fmtMonthLabel(r?.month) : fmtDayLabel(r?.date),
  )
  const values = rows.map((r: any) => Number(r?.payments ?? 0))

  const options: ApexOptions = {
    colors: [`var(--accent)`],
    chart: {
      fontFamily: 'Inter, sans-serif',
      type: 'bar',
      height: 310,
      toolbar: { show: false },
      foreColor: '#6B7280',
      background: 'transparent',
      zoom: { enabled: false },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '60%',
        borderRadius: 3,
        borderRadiusApplication: 'end',
      },
    },
    dataLabels: { enabled: false },
    stroke: { show: true, width: 2, colors: ['transparent'] },
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        rotate: -45,
        rotateAlways: true,
        style: { colors: '#6B7280', fontSize: '11px' },
        hideOverlappingLabels: true,
      },
    },
    legend: { show: false },
    yaxis: { title: { text: undefined }, labels: { style: { colors: ['#6B7280'] } } },
    grid: { borderColor: 'rgba(255,255,255,0.06)', yaxis: { lines: { show: true } } },
    fill: { opacity: 1 },
    tooltip: {
      theme: 'dark',
      x: { show: true },
      y: { formatter: (val: number) => `${Math.round(val).toLocaleString('ru-RU')} ₽` },
    },
  }

  const series = [{ name: 'Платежи', data: values }]

  return (
    <div className="overflow-hidden rounded-2xl border border-default bg-overlay-xs px-5 pt-5 pb-5 sm:px-6 sm:pt-6">
      <div className="flex flex-col gap-5 mb-6 sm:flex-row sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-primary">Платежи</h3>
          <p className="mt-1 text-muted text-theme-sm">
            {period === 'monthly' ? 'Последние 12 месяцев' : 'Последние 30 дней'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPeriod('daily')}
            className={`rounded-full px-3 py-1 text-xs font-medium ${period === 'daily' ? 'bg-accent-10 text-[var(--accent)]' : 'text-muted bg-overlay-md'}`}
          >
            30 дней
          </button>
          <button
            type="button"
            onClick={() => setPeriod('monthly')}
            className={`rounded-full px-3 py-1 text-xs font-medium ${period === 'monthly' ? 'bg-accent-10 text-[var(--accent)]' : 'text-muted bg-overlay-md'}`}
          >
            12 мес
          </button>
        </div>
      </div>
      <div className="-ml-4 -mr-2">
        <Chart options={options} series={series} type="bar" height={310} />
      </div>
    </div>
  )
}
