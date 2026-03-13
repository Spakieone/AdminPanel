import type { ChartOptions } from 'chart.js'

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function getChartTheme() {
  return {
    text: cssVar('--chart-text') || 'rgba(148, 163, 184, 0.9)',
    textStrong: cssVar('--chart-text-strong') || 'rgba(226, 232, 240, 0.96)',
    grid: cssVar('--chart-grid') || 'rgba(148, 163, 184, 0.16)',
    gridSoft: cssVar('--chart-grid') || 'rgba(148, 163, 184, 0.10)',
    border: cssVar('--border-default') || 'rgba(148, 163, 184, 0.28)',
    tooltipBg: cssVar('--chart-tooltip-bg') || 'rgba(15, 23, 42, 0.96)',
    tooltipBorder: cssVar('--border-default') || 'rgba(148, 163, 184, 0.34)',
  }
}

type Opts = {
  legend?: boolean
  xGrid?: boolean
  yGrid?: boolean
  stackedX?: boolean
  stackedY?: boolean
  maxXTicks?: number
  yTickFormatter?: (value: number) => string
  tooltipLabel?: (value: number, ctx: any) => string
}

export function buildChartThemeOptions(opts?: Opts): ChartOptions<any> {
  const t = getChartTheme()
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: opts?.legend ?? false,
        labels: {
          color: t.text,
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          padding: 12,
          font: { size: 12, weight: 500 },
        },
      },
      tooltip: {
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        borderWidth: 1,
        titleColor: t.textStrong,
        bodyColor: t.text,
        padding: 10,
        cornerRadius: 10,
        callbacks: {
          label: (ctx: any) => {
            const n = Number(ctx?.parsed?.y ?? ctx?.raw ?? 0)
            if (opts?.tooltipLabel) return opts.tooltipLabel(n, ctx)
            return ` ${Math.round(n).toLocaleString('ru-RU')}`
          },
        },
      },
    },
    scales: {
      x: {
        stacked: Boolean(opts?.stackedX),
        grid: {
          display: opts?.xGrid ?? false,
          color: t.gridSoft,
          drawBorder: false,
        },
        border: { color: t.border },
        ticks: {
          color: t.text,
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: opts?.maxXTicks ?? 12,
        },
      },
      y: {
        stacked: Boolean(opts?.stackedY),
        beginAtZero: true,
        grid: {
          display: opts?.yGrid ?? true,
          color: t.grid,
          drawBorder: false,
        },
        border: { color: t.border },
        ticks: {
          color: t.text,
          callback: (v: any) => {
            const n = Number(v ?? 0)
            if (Number.isFinite(n)) {
              if (opts?.yTickFormatter) return opts.yTickFormatter(n)
              return Math.round(n).toLocaleString('ru-RU')
            }
            return String(v ?? '')
          },
        },
      },
    },
  }
}
