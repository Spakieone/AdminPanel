import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAuthHeaders,
  getRemnawaveNodes,
  getRemnawaveSystemStats,
} from '../api/client'
import { useToastContext } from '../contexts/ToastContext'
import type { RemnawaveNode } from '../api/types'

const API = '/webpanel/api'

// ─── types ───────────────────────────────────────────────────────────────────

interface AgentMetrics {
  cpu_percent?: number
  cpu_cores?: number
  memory_percent?: number
  memory_total_bytes?: number
  memory_used_bytes?: number
  disk_percent?: number
  disk_total_bytes?: number
  disk_used_bytes?: number
  disk_read_speed_bps?: number
  disk_write_speed_bps?: number
  uptime_seconds?: number
  net_upload_bps?: number
  net_download_bps?: number
  xray_running?: boolean
  xray_version?: string
}

interface AgentData {
  uuid: string
  agent_token: string
  last_seen: number | null
  metrics: AgentMetrics | null
  connection_count: number
  online: boolean
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  if (b >= 1e3) return `${Math.round(b / 1024)} KB`
  return `${b} B`
}

function fmtSpeed(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} KB/s`
  return `${bps} B/s`
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}д ${h}ч`
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м`
}

function onlineAgo(ts: number | null): string {
  if (!ts) return 'никогда'
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return `${s}с назад`
  if (s < 3600) return `${Math.floor(s / 60)}м назад`
  if (s < 86400) return `${Math.floor(s / 3600)}ч назад`
  return `${Math.floor(s / 86400)}д назад`
}

function nodeId(n: RemnawaveNode): string {
  return (n.uuid || n.id || '') as string
}
function nodeName(n: RemnawaveNode): string {
  return (n.name || nodeId(n).slice(0, 8)) as string
}
function nodeAddress(n: RemnawaveNode): string {
  return (n.address || '') as string
}

// ─── SVG circular gauge ───────────────────────────────────────────────────────

function CircleGauge({ pct, label, value, size = 72 }: {
  pct: number; label: string; value: string; size?: number
}) {
  const r = size / 2 - 6
  const circ = 2 * Math.PI * r
  const filled = circ * Math.min(Math.max(pct, 0), 100) / 100
  const color = pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : '#34d399'
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeLinecap="round" strokeDasharray={`${filled} ${circ - filled}`}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
        <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
          fill="white" fontSize={size > 64 ? 13 : 11} fontWeight="600"
          style={{ transform: `rotate(90deg)`, transformOrigin: `${size / 2}px ${size / 2}px`, fontFamily: 'inherit' }}>
          {value}
        </text>
      </svg>
      <span className="text-[10px] text-muted uppercase tracking-wide leading-none">{label}</span>
    </div>
  )
}

// ─── agent token modal ────────────────────────────────────────────────────────

function AgentTokenModal({ nodeUuid, nodeName: name, onClose, onTokenChange }: {
  nodeUuid: string
  nodeName: string
  onClose: () => void
  onTokenChange: () => void
}) {
  const { showSuccess, showError } = useToastContext()

  const [hasToken, setHasToken] = useState(false)
  const [maskedToken, setMaskedToken] = useState('')
  const [statusLoading, setStatusLoading] = useState(true)
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [installCmd, setInstallCmd] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'generate' | 'revoke' | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [generating, setGenerating] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    getAuthHeaders().then(h =>
      fetch(`${API}/nodes/${nodeUuid}/agent-token`, { headers: h, credentials: 'include' })
        .then(r => r.json())
        .then(d => { setHasToken(!!d.has_token); setMaskedToken(d.masked_token || ''); setStatusLoading(false) })
        .catch(() => setStatusLoading(false))
    )
    return () => { if (copyTimer.current) clearTimeout(copyTimer.current) }
  }, [nodeUuid])

  const backendUrl = window.location.origin
  const wsUrl = backendUrl.replace(/^http/, 'ws')
  const envConfig = generatedToken
    ? `AGENT_NODE_UUID=${nodeUuid}\nAGENT_AUTH_TOKEN=${generatedToken}\nAGENT_COLLECTOR_URL=${backendUrl}\nAGENT_WS_URL=${wsUrl}\nAGENT_COMMAND_ENABLED=true`
    : null

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text) } catch {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  async function doGenerate() {
    setConfirmAction(null); setGenerating(true)
    try {
      const h = await getAuthHeaders()
      const r = await fetch(`${API}/nodes/${nodeUuid}/agent-token/generate`, { method: 'POST', headers: h, credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Ошибка')
      setGeneratedToken(d.token); setHasToken(true)
      setMaskedToken(d.token.slice(0, 8) + '...' + d.token.slice(-4))
      setInstallCmd(null); onTokenChange()
      showSuccess('Токен сгенерирован', '')
    } catch (e: unknown) {
      showError('Ошибка', e instanceof Error ? e.message : 'Ошибка')
    } finally { setGenerating(false) }
  }

  async function doRevoke() {
    setConfirmAction(null); setRevoking(true)
    try {
      const h = await getAuthHeaders()
      await fetch(`${API}/nodes/${nodeUuid}/agent-token/revoke`, { method: 'POST', headers: h, credentials: 'include' })
      setHasToken(false); setMaskedToken(''); setGeneratedToken(null); setInstallCmd(null)
      onTokenChange(); showSuccess('Токен отозван', '')
    } catch { showError('Ошибка', 'Не удалось отозвать токен') }
    finally { setRevoking(false) }
  }

  async function doInstall() {
    setInstalling(true)
    try {
      const h = await getAuthHeaders()
      const r = await fetch(`${API}/nodes/${nodeUuid}/agent-install`, { method: 'POST', headers: h, credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Ошибка')
      setInstallCmd(d.install_command || '')
      if (d.token) { setGeneratedToken(d.token); setHasToken(true); setMaskedToken(d.token.slice(0, 8) + '...' + d.token.slice(-4)); onTokenChange() }
    } catch (e: unknown) { showError('Ошибка', e instanceof Error ? e.message : 'Ошибка') }
    finally { setInstalling(false) }
  }

  const busy = generating || revoking || installing

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
        <div className="w-full max-w-lg rounded-2xl border border-default bg-[var(--bg-surface)] p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent)]">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              <h2 className="text-base font-bold text-primary">Токен агента</h2>
              <button type="button" onClick={onClose} className="ml-auto text-muted hover:text-primary text-lg leading-none">✕</button>
            </div>
            <p className="text-sm text-muted ml-7">Нода: <span className="text-primary font-medium">{name}</span></p>
          </div>

          {statusLoading ? (
            <div className="py-6 flex justify-center"><div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Статус */}
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/8">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Статус</span>
                  {hasToken ? (
                    <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                      Установлен
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm text-amber-400">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                      Не установлен
                    </span>
                  )}
                </div>
                {maskedToken && !generatedToken && <p className="text-xs text-muted font-mono mt-2">{maskedToken}</p>}
              </div>

              {/* Новый токен */}
              {generatedToken && (
                <div className="p-3 rounded-lg bg-[var(--accent)]/5 border border-[var(--accent)]/20 flex flex-col gap-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-amber-400">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    Сохраните токен — он показывается только один раз!
                  </div>
                  <div className="relative">
                    <pre className="text-xs text-[var(--accent)] font-mono bg-overlay-md p-2.5 rounded overflow-x-auto whitespace-pre-wrap break-all">{generatedToken}</pre>
                    <button type="button" onClick={() => copy(generatedToken)} className="absolute top-1.5 right-1.5 h-6 w-6 flex items-center justify-center rounded text-muted hover:text-primary bg-overlay-xs hover:bg-overlay-sm">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    </button>
                  </div>
                  {envConfig && (
                    <>
                      <p className="text-xs text-muted">Конфигурация .env:</p>
                      <div className="relative">
                        <pre className="text-[11px] text-dim font-mono bg-overlay-md p-2.5 rounded overflow-x-auto whitespace-pre-wrap break-all">{envConfig}</pre>
                        <button type="button" onClick={() => copy(envConfig)} className="absolute top-1.5 right-1.5 h-6 w-6 flex items-center justify-center rounded text-muted hover:text-primary bg-overlay-xs hover:bg-overlay-sm">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        </button>
                      </div>
                    </>
                  )}
                  {copied && <p className="text-xs text-emerald-400">Скопировано!</p>}
                </div>
              )}

              {/* Команда установки */}
              {installCmd && (
                <div className="p-3 rounded-lg bg-white/[0.03] border border-emerald-500/20 flex flex-col gap-2">
                  <p className="text-xs text-muted">Выполните на сервере ноды (требуется Docker):</p>
                  <div className="relative">
                    <pre className="text-[11px] text-emerald-300 font-mono bg-overlay-md p-2.5 rounded overflow-x-auto whitespace-pre-wrap break-all">{installCmd}</pre>
                    <button type="button" onClick={() => copy(installCmd)} className="absolute top-1.5 right-1.5 h-6 w-6 flex items-center justify-center rounded text-muted hover:text-primary bg-overlay-xs hover:bg-overlay-sm">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    </button>
                  </div>
                  {copied && <p className="text-xs text-emerald-400">Скопировано!</p>}
                </div>
              )}

              {/* Кнопки */}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <button type="button" onClick={doInstall} disabled={busy}
                  className="h-8 px-3 rounded-lg border border-default text-xs text-secondary hover:text-primary hover:border-white/30 disabled:opacity-50 flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
                  {installing ? '…' : 'Установить агента'}
                </button>
                <button type="button"
                  onClick={() => hasToken && !generatedToken ? setConfirmAction('generate') : doGenerate()}
                  disabled={busy}
                  className="h-8 px-3 rounded-lg bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)] text-xs font-semibold disabled:opacity-50 hover:bg-[rgb(var(--accent-rgb)/0.18)] flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
                  {generating ? '…' : hasToken ? 'Перегенерировать' : 'Создать токен'}
                </button>
                {hasToken && (
                  <button type="button" onClick={() => setConfirmAction('revoke')} disabled={busy}
                    className="h-8 px-3 rounded-lg border border-default text-red-400 text-xs hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50">
                    {revoking ? '…' : 'Отозвать'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-default bg-[var(--bg-surface)] p-5 flex flex-col gap-3">
            <h3 className="text-sm font-bold text-primary">
              {confirmAction === 'generate' ? 'Перегенерировать токен?' : 'Отозвать токен?'}
            </h3>
            <p className="text-xs text-muted">
              {confirmAction === 'generate'
                ? 'Старый токен станет недействительным. Агент потеряет соединение до перезапуска.'
                : 'Агент потеряет доступ и перестанет отправлять данные.'}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setConfirmAction(null)} className="h-8 px-3 rounded-lg border border-default text-xs text-secondary hover:text-primary">Отмена</button>
              <button type="button"
                onClick={() => confirmAction === 'generate' ? doGenerate() : doRevoke()}
                className={`h-8 px-3 rounded-lg text-xs font-semibold ${confirmAction === 'revoke' ? 'bg-red-900/40 text-red-400 border border-red-700/40 hover:bg-red-900/60' : 'bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)] hover:bg-[rgb(var(--accent-rgb)/0.18)]'}`}>
                {confirmAction === 'generate' ? 'Перегенерировать' : 'Отозвать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── node card ────────────────────────────────────────────────────────────────

function NodeCard({ rmNode, agent, onToken }: {
  rmNode: RemnawaveNode
  agent: AgentData | null
  onToken: () => void
}) {
  const uuid = nodeId(rmNode)
  const name = nodeName(rmNode)
  const address = nodeAddress(rmNode)
  const m = agent?.metrics ?? null
  const agentOnline = agent?.online ?? false
  const [expanded, setExpanded] = useState(false)

  // Статус подключения из remnawave
  const rmStatus = rmNode.status
  const rmConnected = rmStatus === 'active' || rmStatus === 'enabled'
  const rmDisabled = rmStatus === 'disabled' || rmStatus === 'paused' || rmStatus === 'inactive'

  const cpuPct = m?.cpu_percent ?? 0
  const ramPct = m?.memory_percent ?? 0
  const diskPct = m?.disk_percent ?? 0

  return (
    <div className={`rounded-xl border ${rmDisabled ? 'border-white/5 opacity-60' : 'border-default'} bg-[var(--bg-surface)] flex flex-col overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${agentOnline ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : rmConnected ? 'bg-sky-400' : 'bg-zinc-600'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-primary truncate">{name}</span>
            {rmDisabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-muted">отключена</span>}
            {rmConnected && !agentOnline && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">Remnawave</span>}
            {agentOnline && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Агент</span>}
          </div>
          <div className="text-[11px] text-muted mt-0.5 flex items-center gap-2">
            {address && <span className="font-mono text-muted">{address}{rmNode.port ? `:${rmNode.port}` : ''}</span>}
            {agentOnline
              ? <span className="text-emerald-400">Агент онлайн</span>
              : agent?.last_seen
              ? <span>{onlineAgo(agent.last_seen)}</span>
              : <span className="text-muted/50">агент не подключался</span>
            }
          </div>
        </div>
        {/* Кнопки */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={onToken} title="Токен агента"
            className="h-7 w-7 rounded-lg text-sm bg-sky-500/10 text-sky-400 hover:bg-sky-500/25 border border-sky-500/20 flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Метрики агента */}
      {m ? (
        <div className="px-4 pb-3">
          <div className="flex justify-around items-end py-2">
            <CircleGauge pct={cpuPct} label="CPU" value={`${cpuPct.toFixed(0)}%`} />
            <CircleGauge pct={ramPct} label="RAM" value={`${ramPct.toFixed(0)}%`} />
            <CircleGauge pct={diskPct} label="Disk" value={`${diskPct.toFixed(0)}%`} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
            <div className="bg-white/3 rounded-lg px-3 py-1.5 flex items-center justify-between">
              <span className="text-muted">↑ Upload</span>
              <span className="font-mono text-emerald-300">{fmtSpeed(m.net_upload_bps ?? 0)}</span>
            </div>
            <div className="bg-white/3 rounded-lg px-3 py-1.5 flex items-center justify-between">
              <span className="text-muted">↓ Download</span>
              <span className="font-mono text-sky-300">{fmtSpeed(m.net_download_bps ?? 0)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
            <div className="bg-white/3 rounded-lg px-3 py-1.5 flex items-center justify-between">
              <span className="text-muted">Xray</span>
              {m.xray_running
                ? <span className="text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />{m.xray_version || 'running'}</span>
                : <span className="text-red-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />stopped</span>
              }
            </div>
            <div className="bg-white/3 rounded-lg px-3 py-1.5 flex items-center justify-between">
              <span className="text-muted">Uptime</span>
              <span className="font-mono text-dim">{fmtUptime(m.uptime_seconds ?? 0)}</span>
            </div>
          </div>
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="w-full mt-2 text-[10px] text-muted hover:text-primary flex items-center justify-center gap-1 py-0.5">
            {expanded ? '▲ Скрыть' : '▼ Подробнее'}
          </button>
          {expanded && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-white/5 pt-2">
              <div className="flex justify-between text-muted"><span>CPU ядра</span><span className="text-primary">{m.cpu_cores ?? '—'}</span></div>
              <div className="flex justify-between text-muted"><span>RAM</span><span className="text-primary">{fmtBytes(m.memory_used_bytes ?? 0)} / {fmtBytes(m.memory_total_bytes ?? 0)}</span></div>
              <div className="flex justify-between text-muted"><span>Диск</span><span className="text-primary">{fmtBytes(m.disk_used_bytes ?? 0)} / {fmtBytes(m.disk_total_bytes ?? 0)}</span></div>
              <div className="flex justify-between text-muted"><span>Соединений</span><span className="text-primary">{(agent?.connection_count ?? 0).toLocaleString()}</span></div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 pb-3 text-xs text-muted/50 italic">
          {agentOnline ? 'Ожидание метрик…' : 'Агент не подключён — нажмите ключ для установки'}
        </div>
      )}

      {/* Footer: xray version от remnawave + uuid */}
      <div className="border-t border-white/5 px-4 py-2 flex items-center gap-2">
        <span className="text-[10px] text-muted/50 font-mono truncate flex-1" title={uuid}>{uuid.slice(0, 8)}…</span>
        {rmNode.xrayVersion && (
          <span className="text-[10px] text-faint flex items-center gap-1">
            <span className="text-yellow-400/60">⚡</span>{rmNode.xrayVersion}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function Fleet() {
  const { showError } = useToastContext()

  // Remnawave nodes
  const [rmNodes, setRmNodes] = useState<RemnawaveNode[]>([])
  const [systemStats, setSystemStats] = useState<any>(null)
  const [rmLoading, setRmLoading] = useState(true)

  // Agent data map: uuid → AgentData
  const [agents, setAgents] = useState<Record<string, AgentData>>({})

  // Modals
  const [tokenNode, setTokenNode] = useState<RemnawaveNode | null>(null)

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadAgents = useCallback(async () => {
    try {
      const h = await getAuthHeaders()
      const r = await fetch(`${API}/nodes`, { headers: h, credentials: 'include', cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) return
      const map: Record<string, AgentData> = {}
      for (const n of (d.nodes || [])) {
        map[n.uuid] = n
      }
      setAgents(map)
    } catch { /* игнорируем */ }
  }, [])

  const loadRmNodes = useCallback(async () => {
    setRmLoading(true)
    try {
      const [n, s] = await Promise.allSettled([
        getRemnawaveNodes(undefined),
        getRemnawaveSystemStats(undefined),
      ])
      if (n.status === 'fulfilled') {
        const raw = n.value as any
        const arr: RemnawaveNode[] = Array.isArray(raw) ? raw
          : Array.isArray(raw?.response) ? raw.response
          : Array.isArray(raw?.nodes) ? raw.nodes
          : Array.isArray(raw?.data) ? raw.data : []
        setRmNodes(arr)
      } else {
        showError('Ошибка загрузки нод', '')
      }
      if (s.status === 'fulfilled') setSystemStats(s.value)
    } finally { setRmLoading(false) }
  }, [showError])

  const loadAll = useCallback(async () => {
    await Promise.all([loadRmNodes(), loadAgents()])
  }, [loadRmNodes, loadAgents])

  useEffect(() => {
    void loadAll()
    refreshTimer.current = setInterval(() => void loadAgents(), 15_000)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [loadAll, loadAgents])

  const agentOnlineCount = Object.values(agents).filter(a => a.online).length
  const stats = systemStats?.response || systemStats?.data || systemStats

  return (
    <div className="p-4 sm:p-6 max-w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-primary">Fleet</h1>
          <p className="text-sm text-muted mt-0.5">
            Ноды remnawave ·{' '}
            <span className="text-emerald-400 font-medium">{agentOnlineCount}</span> агентов онлайн
            <span className="ml-2 text-muted/50 text-xs">агенты обновляются каждые 15с</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void loadAll()} disabled={rmLoading}
            className="h-8 px-3 rounded-lg border border-default text-xs text-secondary hover:text-primary disabled:opacity-50">
            {rmLoading ? '⟳' : '↻ Обновить'}
          </button>
        </div>
      </div>

      {/* Системная статистика */}
      {stats?.onlineStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Онлайн сейчас', value: stats.onlineStats.onlineNow ?? 0 },
            { label: 'За день', value: stats.onlineStats.lastDay ?? 0 },
            { label: 'За неделю', value: stats.onlineStats.lastWeek ?? 0 },
            { label: 'Нод онлайн', value: stats.nodes?.totalOnline ?? 0 },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="text-xs text-muted mb-1">{s.label}</div>
              <div className="text-xl font-bold text-primary">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Ноды */}
      {rmLoading && rmNodes.length === 0 ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rmNodes.length === 0 ? (
        <div className="text-center text-muted py-20">
          <p>Нет нод. Проверьте подключение к Remnawave в Настройках.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rmNodes.map(n => {
            const uid = nodeId(n)
            return (
              <NodeCard
                key={uid}
                rmNode={n}
                agent={agents[uid] ?? null}
                onToken={() => setTokenNode(n)}
              />
            )
          })}
        </div>
      )}

      {/* Модалка токена */}
      {tokenNode && (
        <AgentTokenModal
          nodeUuid={nodeId(tokenNode)}
          nodeName={nodeName(tokenNode)}
          onClose={() => setTokenNode(null)}
          onTokenChange={() => void loadAgents()}
        />
      )}
    </div>
  )
}
