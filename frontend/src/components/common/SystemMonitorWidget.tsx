import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Cpu, HardDrive, Wifi } from 'lucide-react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { getManagementMetrics, type ManagementMetrics } from '../../api/botApi'
import { getBotProfiles, getMonitoringSettings, getPanelMetrics, getRemnawaveNodes } from '../../api/client'

type DataPoint = {
  value: number
  timestamp: number
  isSpike?: boolean
}

type RemnawaveNodesSummary = { total: number; online: number; offline: number; unknown: number }

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function clampPct(v: number) {
  return Math.max(0, Math.min(100, v))
}

function toPoint(value: number, timestamp: number, opts: { spikeThreshold: number }): DataPoint {
  const v = clampPct(value)
  return { value: v, timestamp, isSpike: v >= opts.spikeThreshold }
}

function toneFromPct(v?: number | null): 'ok' | 'warn' | 'crit' {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'ok'
  if (v >= 90) return 'crit'
  if (v >= 80) return 'warn'
  return 'ok'
}

function Sparkline({
  data,
  color,
  spikeColor = '#ef4444',
  width = 120,
  height = 24,
  domainMax,
}: {
  data: DataPoint[]
  color: string
  spikeColor?: string
  width?: number
  height?: number
  domainMax?: number
}) {
  const reactId = useId()
  const id = useMemo(() => `sl-${reactId.replace(/[^a-zA-Z0-9_-]/g, '_')}`, [reactId])
  const safe = data.length >= 2 ? data : [{ value: 0, timestamp: 0 }, { value: 0, timestamp: 1 }]
  const maxV =
    typeof domainMax === 'number' && Number.isFinite(domainMax) && domainMax > 0
      ? domainMax
      : Math.max(1, ...safe.map((p) => (typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : 0)))
  const points = safe.map((p, i) => {
    const x = safe.length === 1 ? 0 : (i / (safe.length - 1)) * width
    const y = height - (clamp01((p.value || 0) / maxV) * height)
    return { x, y, isSpike: Boolean(p.isSpike) }
  })

  const line = points.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '')
  const area = `${line} L ${width} ${height} L 0 ${height} Z`
  const hasSpikes = points.some((p) => p.isSpike)
  const stroke = hasSpikes ? spikeColor : color

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className="w-full overflow-visible"
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.30} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0.08} />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#${id})`}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />
      {points.map((p, i) =>
        p.isSpike ? (
          <motion.circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={2}
            fill={spikeColor}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18, delay: i * 0.01 }}
          />
        ) : null,
      )}
    </svg>
  )
}

function ResourceRow({
  icon: Icon,
  label,
  hintText,
  valueText,
  data,
  color,
  domainMax,
  tone = 'ok',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  hintText?: string
  valueText: string
  data: DataPoint[]
  color: string
  domainMax?: number
  tone?: 'ok' | 'warn' | 'crit'
}) {
  const hasSpikes = data.some((d) => d.isSpike)
  const toneBg =
    tone === 'crit' ? 'bg-red-500/10 border-red-500/25' : tone === 'warn' ? 'bg-amber-500/10 border-amber-500/25' : 'bg-overlay-xs border-default'
  const toneIcon = tone === 'crit' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-dim'
  const toneValue = tone === 'crit' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-secondary'
  const rowColor = tone === 'crit' ? '#ef4444' : tone === 'warn' ? '#f59e0b' : color
  return (
    <motion.div
      className="flex items-center gap-2 p-1.5 rounded-lg transition-colors hover:bg-white/4"
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
    >
      <div
        className={[
          'flex items-center justify-center w-7 h-7 rounded-md border',
          hasSpikes ? 'bg-red-500/10 border-red-500/25' : toneBg,
        ].join(' ')}
      >
        <Icon className={['w-4 h-4', hasSpikes ? 'text-red-400' : toneIcon].join(' ')} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[12px] font-semibold text-primary">{label}</span>
            {hintText ? (
              <span className="text-[11px] font-mono text-secondary truncate" title={hintText}>
                {hintText}
              </span>
            ) : null}
          </div>
          <span className={['text-[13px] font-mono font-semibold', hasSpikes ? 'text-red-300' : toneValue].join(' ')}>
            {valueText}
          </span>
        </div>
        <div className="mt-1">
          <Sparkline data={data} color={rowColor} domainMax={domainMax} />
        </div>
      </div>
    </motion.div>
  )
}

function fmtMb(v?: number | null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${Math.round(v)} MB`
}

function fmtPct(v?: number | null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${v.toFixed(1)}%`
}

function fmtGbNumberFromMb(v?: number | null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return (v / 1024).toFixed(v >= 10240 ? 0 : 1)
}

function fmtGbNumber(v?: number | null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v.toFixed(v >= 100 ? 0 : 1)
}

function fmtMbPerSec(v?: number | null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${v.toFixed(1)} MB/s`
}

function extractRemNodeStatus(payload: any): 'online' | 'offline' | 'unknown' {
  if (!payload || typeof payload !== 'object') return 'unknown'
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

function extractNodesArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    if (Array.isArray((raw as any).response)) return (raw as any).response
    if (Array.isArray((raw as any).nodes)) return (raw as any).nodes
    if (Array.isArray((raw as any).data)) return (raw as any).data
    if (Array.isArray((raw as any).items)) return (raw as any).items
  }
  return []
}

export default function SystemMonitorWidget({
  variant = 'fixed',
}: {
  variant?: 'fixed' | 'embedded'
}) {
  const [enabled, setEnabled] = useState(false)
  const [opts, setOpts] = useState<{
    enabled: boolean
    pollMs: number
    showCpu: boolean
    showRam: boolean
    showSwap: boolean
    showDisk: boolean
    showNetwork: boolean
    showBotRam: boolean
    showBotCpu: boolean
    showPanelRam: boolean
    showPanelCpu: boolean
  }>({
    enabled: true,
    pollMs: 10000,
    showCpu: true,
    showRam: true,
    showSwap: true,
    showDisk: true,
    showNetwork: true,
    showBotRam: true,
    showBotCpu: true,
    showPanelRam: true,
    showPanelCpu: true,
  })
  const [data, setData] = useState<{
    cpu: DataPoint[]
    ram: DataPoint[]
    swap: DataPoint[]
    disk: DataPoint[]
    botRam: DataPoint[]
    botCpu: DataPoint[]
    net: DataPoint[]
    panelRam: DataPoint[]
    panelCpu: DataPoint[]
  }>({ cpu: [], ram: [], swap: [], disk: [], botRam: [], botCpu: [], net: [], panelRam: [], panelCpu: [] })
  const [last, setLast] = useState<ManagementMetrics | null>(null)
  const [panel, setPanel] = useState<{ cpuPct: number | null; rssMb: number | null } | null>(null)
  const [remnawaveNodes, setRemnawaveNodes] = useState<RemnawaveNodesSummary | null>(null)
  const [remnawaveNodesEnabled, setRemnawaveNodesEnabled] = useState(true)
  const lastRemnawaveFetchRef = useRef<number>(0)

  const maxPoints = 22

  useEffect(() => {
    setEnabled(true)
  }, [])

  // Monitoring settings (local JSON) drive widget visibility and metric toggles.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const s = await getMonitoringSettings()
        if (cancelled) return
        const remApi = Boolean((s as any)?.monitorRemnawaveApi ?? true)
        const remNodes = Boolean((s as any)?.monitorRemnawaveNodes ?? true)
        setRemnawaveNodesEnabled(remApi && remNodes)
        const p = (s as any)?.systemWidget || {}
        const pollSecRaw = Number(p.pollSec ?? (p.pollMs ? (Number(p.pollMs) / 1000) : 10))
        const pollSec = Number.isFinite(pollSecRaw) ? Math.max(5, Math.min(300, Math.round(pollSecRaw))) : 10
        setOpts({
          enabled: Boolean(p.enabled ?? true),
          pollMs: pollSec * 1000,
          showCpu: Boolean(p.showCpu ?? true),
          showRam: Boolean(p.showRam ?? true),
          showSwap: Boolean((p as any).showSwap ?? true),
          showDisk: Boolean(p.showDisk ?? true),
          showNetwork: Boolean(p.showNetwork ?? true),
          showBotRam: Boolean(p.showBotRam ?? true),
          showBotCpu: Boolean(p.showBotCpu ?? true),
          showPanelRam: Boolean((p as any).showPanelRam ?? true),
          showPanelCpu: Boolean((p as any).showPanelCpu ?? true),
        })
      } catch {
        // keep defaults
      }
    }
    load()
    const onChanged = () => load()
    window.addEventListener('monitoringSettingsChanged', onChanged)
    return () => {
      cancelled = true
      window.removeEventListener('monitoringSettingsChanged', onChanged)
    }
  }, [])

  useEffect(() => {
    if (!enabled || !opts.enabled) return
    let stopped = false
    let timer: number | null = null

    const tick = async () => {
      try {
        if (document.hidden) return
        if (stopped) return
        const nowTs = Date.now()
        const cfg = await getBotConfigAsync().catch(() => null as any)
        let ts = nowTs

        // Bot server metrics (host) + bot process metrics via module API
        try {
          if (cfg) {
            const m = await getManagementMetrics(cfg)
            if (m?.ok) {
              setLast(m)
              ts = typeof m.ts === 'number' ? m.ts : nowTs

              const cpu = typeof m.system?.cpu_pct === 'number' ? m.system.cpu_pct : 0
              const ram = typeof m.system?.mem_used_pct === 'number' ? m.system.mem_used_pct : 0
              const disk = typeof m.system?.disk_used_pct === 'number' ? m.system.disk_used_pct : 0
              const swap = typeof m.system?.swap_used_pct === 'number' ? m.system.swap_used_pct : 0
              const botRssMb = typeof m.bot?.rss_mb === 'number' ? m.bot.rss_mb : 0
              const botCpuRaw = typeof m.bot?.cpu_pct === 'number' ? m.bot.cpu_pct : 0
              const botCpu = Math.max(0, Math.min(100, botCpuRaw))
              const net =
                (typeof m.network?.rx_mb_s === 'number' ? m.network.rx_mb_s : 0) +
                (typeof m.network?.tx_mb_s === 'number' ? m.network.tx_mb_s : 0)

              setData((prev) => ({
                cpu: [...prev.cpu, toPoint(cpu, ts, { spikeThreshold: 90 })].slice(-maxPoints),
                ram: [...prev.ram, toPoint(ram, ts, { spikeThreshold: 90 })].slice(-maxPoints),
                swap: [...prev.swap, toPoint(swap, ts, { spikeThreshold: 90 })].slice(-maxPoints),
                disk: [...prev.disk, toPoint(disk, ts, { spikeThreshold: 90 })].slice(-maxPoints),
                botRam: [...prev.botRam, { value: Math.max(0, botRssMb), timestamp: ts, isSpike: botRssMb >= 1500 }].slice(-maxPoints),
                botCpu: [...prev.botCpu, toPoint(botCpu, ts, { spikeThreshold: 90 })].slice(-maxPoints),
                net: [...prev.net, { value: Math.max(0, net), timestamp: ts, isSpike: net >= 30 }].slice(-maxPoints),
                panelRam: prev.panelRam,
                panelCpu: prev.panelCpu,
              }))
            } else {
              setLast(null)
            }
          } else {
            setLast(null)
          }
        } catch {
          setLast(null)
        }

        // AdminPanel backend process metrics (this server).
        try {
          const pm: any = await getPanelMetrics()
          const p = pm?.process || {}
          const cpuPct = typeof p.cpu_pct === 'number' && Number.isFinite(p.cpu_pct) ? p.cpu_pct : null
          const rssMb = typeof p.rss_mb === 'number' && Number.isFinite(p.rss_mb) ? p.rss_mb : null
          setPanel({ cpuPct, rssMb })
          setData((prev) => ({
            ...prev,
            panelRam: [...prev.panelRam, { value: Math.max(0, rssMb || 0), timestamp: ts, isSpike: (rssMb || 0) >= 600 }].slice(-maxPoints),
            panelCpu: [...prev.panelCpu, toPoint(Math.max(0, cpuPct || 0), ts, { spikeThreshold: 50 })].slice(-maxPoints),
          }))
        } catch {
          setPanel(null)
        }

        // Remnawave nodes summary (count)
        if (remnawaveNodesEnabled) {
          const now = Date.now()
          const throttleMs = Math.max(30000, Math.min(300000, (opts.pollMs || 10000) * 3))
          if (now - (lastRemnawaveFetchRef.current || 0) >= throttleMs) {
            lastRemnawaveFetchRef.current = now
            try {
              const profilesData: any = await getBotProfiles()
              const activeProfileId = String(profilesData?.activeProfileId || '').trim()
              if (!activeProfileId) {
                setRemnawaveNodes(null)
              } else {
                const rawNodes: any = await getRemnawaveNodes(activeProfileId).catch(() => null)
                const nodesArr = extractNodesArray(rawNodes)
                let total = 0
                let online = 0
                let offline = 0
                let unknown = 0
                for (const n of nodesArr) {
                  if (!n || typeof n !== 'object') continue
                  total += 1
                  const st = extractRemNodeStatus(n)
                  if (st === 'online') online += 1
                  else if (st === 'offline') offline += 1
                  else unknown += 1
                }
                setRemnawaveNodes({ total, online, offline, unknown })
              }
            } catch {
              setRemnawaveNodes(null)
            }
          }
        } else {
          setRemnawaveNodes(null)
        }

      } catch {
        // ignore transient errors
      }
    }

    tick()
    timer = window.setInterval(tick, Math.max(5000, Math.min(300000, opts.pollMs || 10000)))
    return () => {
      stopped = true
      if (timer) window.clearInterval(timer)
    }
  }, [enabled, opts.enabled, opts.pollMs, remnawaveNodesEnabled])

  const current = useMemo(() => {
    const hasBotMetrics = Boolean(last && last.ok)
    const botRssMb = hasBotMetrics ? (last?.bot?.rss_mb ?? null) : null
    const rx = last?.network?.rx_mb_s ?? null
    const tx = last?.network?.tx_mb_s ?? null
    const netText = rx !== null || tx !== null ? fmtMbPerSec((rx || 0) + (tx || 0)) : '—'
    return {
      cpuText: hasBotMetrics ? fmtPct(last?.system?.cpu_pct ?? null) : '—',
      ramPct: hasBotMetrics ? fmtPct(last?.system?.mem_used_pct ?? null) : '—',
      diskPct: hasBotMetrics ? fmtPct(last?.system?.disk_used_pct ?? null) : '—',
      botText: botRssMb !== null ? fmtMb(botRssMb) : '—',
      netText,
    }
  }, [data.cpu, data.ram, data.disk, last])

  const hasSpike = useMemo(() => {
    return [...data.cpu, ...data.ram, ...data.swap, ...data.disk, ...data.botRam, ...data.botCpu, ...data.net, ...data.panelRam, ...data.panelCpu].some(
      (d) => d.isSpike,
    )
  }, [data])

  if (!enabled || !opts.enabled) return null

  const memTotalMb = last?.system?.mem_total_mb ?? null
  const memUsedMb = last?.system?.mem_used_mb ?? null
  const swapTotalMb = (last as any)?.system?.swap_total_mb ?? null
  const swapUsedMb = (last as any)?.system?.swap_used_mb ?? null
  const diskTotalGb = last?.system?.disk_total_gb ?? null
  const diskUsedGb = last?.system?.disk_used_gb ?? null
  const botCpu = last?.bot?.cpu_pct ?? null
  const botCpuText = typeof botCpu === 'number' && Number.isFinite(botCpu) ? `${botCpu.toFixed(1)}%` : '—'

  const cpuPctNum = typeof last?.system?.cpu_pct === 'number' ? last.system.cpu_pct : null
  const ramPctNum = typeof last?.system?.mem_used_pct === 'number' ? last.system.mem_used_pct : null
  const swapPctNum = typeof (last as any)?.system?.swap_used_pct === 'number' ? (last as any).system.swap_used_pct : null
  const diskPctNum = typeof last?.system?.disk_used_pct === 'number' ? last.system.disk_used_pct : null

  const ramHintText = (() => {
    const used = fmtGbNumberFromMb(memUsedMb)
    const total = fmtGbNumberFromMb(memTotalMb)
    if (!used || !total) return undefined
    return `${used}/${total} GB`
  })()
  const swapHintText = (() => {
    const used = fmtGbNumberFromMb(swapUsedMb)
    const total = fmtGbNumberFromMb(swapTotalMb)
    if (!used || !total) return undefined
    return `${used}/${total} GB`
  })()
  const diskHintText = (() => {
    const used = fmtGbNumber(diskUsedGb)
    const total = fmtGbNumber(diskTotalGb)
    if (!used || !total) return undefined
    return `${used}/${total} GB`
  })()

  const containerClass =
    variant === 'fixed'
      ? 'fixed z-[99940] bottom-[calc(1rem+var(--safe-bottom))] right-[calc(1rem+var(--safe-right))]'
      : 'relative z-10 w-full h-full'
  const cardClass =
    variant === 'fixed'
      ? 'w-[min(380px,calc(100vw-1.5rem))] rounded-2xl border border-default bg-overlay-xs overflow-hidden'
      : 'w-full h-full rounded-2xl border border-default bg-overlay-xs overflow-hidden'

  return (
    <motion.div
      className={containerClass}
      initial={variant === 'fixed' ? { y: 100, opacity: 0 } : { opacity: 0 }}
      animate={variant === 'fixed' ? { y: 0, opacity: 1 } : { opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className={cardClass}>
        <motion.div className="p-3 select-none h-full flex flex-col" transition={{ duration: 0.15 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <motion.div animate={{ rotate: hasSpike ? 360 : 0 }} transition={{ duration: 0.55, ease: 'easeInOut' }}>
                <Activity className={['w-4 h-4', hasSpike ? 'text-red-400' : 'text-dim'].join(' ')} />
              </motion.div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-primary truncate">Сервер бота • Метрики</div>
              </div>
              {hasSpike ? (
                <div className="text-[11px] px-2 py-0.5 rounded-full border border-red-500/25 bg-red-500/10 text-red-300">
                  Пик
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2.5 flex-1 flex flex-col">
            {/* Bot server (host) + bot process */}
            <div className="rounded-xl border border-default bg-overlay-xs p-2">
              <div className="flex items-center justify-between px-1 mb-1">
                <div className="text-[11px] font-semibold tracking-wider text-dim">СЕРВЕР БОТА</div>
                <div />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {opts.showCpu ? (
                  <ResourceRow
                    icon={Cpu}
                    label="ЦПУ"
                    valueText={current.cpuText}
                    data={data.cpu}
                    color="#3b82f6"
                    domainMax={100}
                    tone={toneFromPct(cpuPctNum)}
                  />
                ) : null}
                {opts.showRam ? (
                  <ResourceRow
                    icon={HardDrive}
                    label="ОЗУ"
                    hintText={ramHintText}
                    valueText={fmtPct(ramPctNum)}
                    data={data.ram}
                    color="#10b981"
                    domainMax={100}
                    tone={toneFromPct(ramPctNum)}
                  />
                ) : null}
                {opts.showSwap ? (
                  <ResourceRow
                    icon={HardDrive}
                    label="Своп"
                    hintText={swapHintText}
                    valueText={fmtPct(swapPctNum)}
                    data={data.swap}
                    color="#a855f7"
                    domainMax={100}
                    tone={toneFromPct(swapPctNum)}
                  />
                ) : null}
                {opts.showDisk ? (
                  <ResourceRow
                    icon={HardDrive}
                    label="Диск"
                    hintText={diskHintText}
                    valueText={fmtPct(diskPctNum)}
                    data={data.disk}
                    color="#ef4444"
                    domainMax={100}
                    tone={toneFromPct(diskPctNum)}
                  />
                ) : null}
                {opts.showNetwork ? (
                  <ResourceRow icon={Wifi} label="Сеть" valueText={current.netText} data={data.net} color="#8b5cf6" />
                ) : null}

                {/* Bot process metrics (separate from host metrics) */}
                {(opts.showBotRam || opts.showBotCpu) ? (
                  <div className="col-span-2 mt-1 pt-2 border-t border-default">
                    <div className="flex items-center justify-between px-1 mb-1">
                      <div className="text-[11px] font-semibold tracking-wider text-dim">БОТ (ПРОЦЕСС)</div>
                      <div />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {opts.showBotRam ? (
                        <ResourceRow icon={HardDrive} label="ОЗУ бота" valueText={current.botText} data={data.botRam} color="#f59e0b" />
                      ) : null}
                      {opts.showBotCpu ? (
                        <ResourceRow
                          icon={Cpu}
                          label="ЦПУ бота"
                          valueText={botCpuText}
                          data={data.botCpu}
                          color="#60a5fa"
                          domainMax={100}
                          tone={toneFromPct(botCpu)}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Admin panel server/process + nodes */}
            <div className="rounded-xl border border-default bg-white/3 p-2 flex-1 flex flex-col">
              <div className="flex items-center justify-between px-1 mb-1">
                <div className="text-[11px] font-semibold tracking-wider text-dim">ПАНЕЛЬ</div>
                <div />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {panel && opts.showPanelRam ? (
                  <ResourceRow
                    icon={HardDrive}
                    label="ОЗУ панели"
                    valueText={panel.rssMb !== null ? fmtMb(panel.rssMb) : '—'}
                    data={data.panelRam}
                    color="#f97316"
                  />
                ) : null}
                {panel && opts.showPanelCpu ? (
                  <ResourceRow
                    icon={Cpu}
                    label="ЦПУ панели"
                    valueText={panel.cpuPct !== null ? `${panel.cpuPct.toFixed(1)}%` : '—'}
                    data={data.panelCpu}
                    color="#fb7185"
                    domainMax={100}
                    tone={toneFromPct(panel.cpuPct)}
                  />
                ) : null}

                <div className="col-span-2 mt-1 pt-2 border-t border-default">
                  <div className="flex items-center justify-between px-1">
                    <div className="text-[11px] font-semibold tracking-wider text-dim">REMNAWAVE УЗЛЫ</div>
                    {remnawaveNodes ? (
                      <div className="text-[12px] font-mono text-secondary">
                        {remnawaveNodes.online}/{remnawaveNodes.total} online
                      </div>
                    ) : (
                      <div className="text-[12px] font-mono text-dim">—</div>
                    )}
                  </div>
                  {remnawaveNodes ? (
                    <div className="mt-1 px-1 text-[12px] text-secondary">
                      Всего: <span className="font-mono text-secondary">{remnawaveNodes.total}</span> • Online:{' '}
                      <span className="font-mono text-[var(--accent)]">{remnawaveNodes.online}</span> • Offline:{' '}
                      <span className="font-mono text-rose-200">{remnawaveNodes.offline}</span>
                      {remnawaveNodes.unknown ? (
                        <>
                          {' '}
                          • Unknown: <span className="font-mono text-secondary">{remnawaveNodes.unknown}</span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

