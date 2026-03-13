import { useState, useCallback, useEffect } from 'react'
import { getAuthHeaders } from '../api/client'
import { useToastContext } from '../contexts/ToastContext'

const API = '/webpanel/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Violation {
  id: number
  user_email: string
  user_uuid: string | null
  node_uuid: string
  score: number
  severity: string
  recommended_action: string
  confidence: number
  action_taken: string | null
  action_taken_at: number | null
  action_taken_by: string | null
  detected_at: number
  reasons: string[]
  countries: string[]
  ips: string[]
  asn_types: string[]
  temporal_score: number
  geo_score: number
  asn_score: number
  profile_score: number
  device_score: number
}

interface ViolationStats {
  total: number
  critical: number
  high: number
  medium: number
  low: number
  unique_users: number
  avg_score: number
  max_score: number
  by_action: Record<string, number>
}

interface TopViolator {
  user_email: string
  violations_count: number
  max_score: number
  avg_score: number
  last_violation_at: number
}

interface WhitelistItem {
  id: number
  user_email: string
  reason: string | null
  added_by: string | null
  added_at: number
  expires_at: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTs(ts: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtAgo(ts: number | null): string {
  if (!ts) return 'никогда'
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return `${s}с назад`
  if (s < 3600) return `${Math.floor(s / 60)}м назад`
  if (s < 86400) return `${Math.floor(s / 3600)}ч назад`
  return `${Math.floor(s / 86400)}д назад`
}

function sevColor(sev: string): string {
  switch (sev) {
    case 'critical': return 'text-red-400'
    case 'high': return 'text-amber-400'
    case 'medium': return 'text-sky-400'
    default: return 'text-zinc-400'
  }
}

function sevBg(sev: string): string {
  switch (sev) {
    case 'critical': return 'bg-red-500/10 border-red-500/30'
    case 'high': return 'bg-amber-500/10 border-amber-500/30'
    case 'medium': return 'bg-sky-500/10 border-sky-500/30'
    default: return 'bg-zinc-500/10 border-zinc-500/30'
  }
}

function actionLabel(a: string | null): string {
  if (!a) return 'Ожидает'
  const map: Record<string, string> = {
    block: 'Заблокирован', warn: 'Предупреждён', ignore: 'Проигнорировано',
    dismissed: 'Отклонено', annulled: 'Аннулировано',
  }
  return map[a] || a
}

function recActionLabel(a: string): string {
  const map: Record<string, string> = {
    no_action: 'Без действий', monitor: 'Наблюдение', warn: 'Предупреждение',
    soft_block: 'Мягкая блок.', temp_block: 'Врем. блок.', hard_block: 'Жёсткий блок',
  }
  return map[a] || a
}

function recActionColor(a: string): string {
  switch (a) {
    case 'hard_block': return 'text-red-400'
    case 'temp_block': return 'text-red-300'
    case 'soft_block': return 'text-amber-400'
    case 'warn': return 'text-yellow-400'
    case 'monitor': return 'text-sky-400'
    default: return 'text-zinc-400'
  }
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(score, 100)}%`, transition: 'width 0.3s' }} />
      </div>
      <span className="text-xs font-mono w-8 text-right text-muted">{score.toFixed(0)}</span>
    </div>
  )
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function ViolationDetailModal({ v, csrf, onClose, onRefresh }: {
  v: Violation
  csrf: string
  onClose: () => void
  onRefresh: () => void
}) {
  const { showSuccess, showError } = useToastContext()

  async function doAction(action: string) {
    try {
      const h = await getAuthHeaders()
      const res = await fetch(`${API}/violations/${v.id}/resolve`, {
        method: 'POST',
        headers: { ...h, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showSuccess('Готово', actionLabel(action))
      onRefresh(); onClose()
    } catch (e: any) { showError('Ошибка', String(e?.message || e)) }
  }

  async function doAnnul() {
    try {
      const h = await getAuthHeaders()
      const res = await fetch(`${API}/violations/${v.id}/annul`, {
        method: 'POST',
        headers: { ...h, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showSuccess('Аннулировано', '')
      onRefresh(); onClose()
    } catch (e: any) { showError('Ошибка', String(e?.message || e)) }
  }

  const sev = v.severity
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-default bg-[var(--bg-surface)] flex flex-col gap-0 overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b border-default ${sevBg(sev)}`}>
          <div>
            <div className={`text-sm font-bold ${sevColor(sev)}`}>
              {sev.toUpperCase()} — {v.score.toFixed(0)} баллов
            </div>
            <div className="text-xs text-muted mt-0.5 font-mono">{v.user_email}</div>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-primary text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted/60 mb-1">Обнаружено</div>
              <div className="text-primary">{fmtTs(v.detected_at)}</div>
            </div>
            <div>
              <div className="text-muted/60 mb-1">Рекомендация</div>
              <div className={recActionColor(v.recommended_action)}>{recActionLabel(v.recommended_action)}</div>
            </div>
            <div>
              <div className="text-muted/60 mb-1">Действие</div>
              <div className={v.action_taken ? 'text-emerald-400' : 'text-amber-400'}>{actionLabel(v.action_taken)}</div>
            </div>
            <div>
              <div className="text-muted/60 mb-1">Уверенность</div>
              <div className="text-primary">{(v.confidence * 100).toFixed(0)}%</div>
            </div>
          </div>

          {/* Score breakdown */}
          <div>
            <div className="text-xs text-muted/60 uppercase tracking-wide mb-2">Разбивка по анализаторам</div>
            <div className="flex flex-col gap-2">
              <div><div className="text-xs text-muted mb-1">Временной</div><ScoreBar score={v.temporal_score} color="bg-orange-400" /></div>
              <div><div className="text-xs text-muted mb-1">Гео</div><ScoreBar score={v.geo_score} color="bg-sky-400" /></div>
              <div><div className="text-xs text-muted mb-1">ASN / Провайдер</div><ScoreBar score={v.asn_score} color="bg-violet-400" /></div>
              <div><div className="text-xs text-muted mb-1">Профиль</div><ScoreBar score={v.profile_score} color="bg-emerald-400" /></div>
              <div><div className="text-xs text-muted mb-1">Устройство</div><ScoreBar score={v.device_score} color="bg-rose-400" /></div>
            </div>
          </div>

          {/* Reasons */}
          {v.reasons.length > 0 && (
            <div>
              <div className="text-xs text-muted/60 uppercase tracking-wide mb-2">Причины</div>
              <ul className="space-y-1">
                {v.reasons.map((r, i) => (
                  <li key={i} className="text-xs text-muted flex gap-2">
                    <span className="text-amber-400 flex-shrink-0">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Countries + IPs */}
          <div className="grid grid-cols-2 gap-3">
            {v.countries.length > 0 && (
              <div>
                <div className="text-xs text-muted/60 uppercase tracking-wide mb-1">Страны</div>
                <div className="flex flex-wrap gap-1">
                  {v.countries.map(c => (
                    <span key={c} className="text-xs px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 font-mono">{c}</span>
                  ))}
                </div>
              </div>
            )}
            {v.ips.length > 0 && (
              <div>
                <div className="text-xs text-muted/60 uppercase tracking-wide mb-1">IP-адреса</div>
                <div className="flex flex-col gap-0.5 max-h-20 overflow-y-auto">
                  {v.ips.slice(0, 10).map(ip => (
                    <span key={ip} className="text-[11px] font-mono text-muted/70">{ip}</span>
                  ))}
                  {v.ips.length > 10 && <span className="text-[11px] text-muted/40">+{v.ips.length - 10} ещё</span>}
                </div>
              </div>
            )}
          </div>

          {/* ASN types */}
          {v.asn_types.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {v.asn_types.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 rounded bg-violet-500/10 text-violet-300">{t}</span>
              ))}
            </div>
          )}
        </div>

        {/* Actions footer */}
        {!v.action_taken && (
          <div className="border-t border-default px-5 py-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => doAction('block')}
              className="h-8 px-3 rounded-lg text-xs font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30">
              Заблокировать
            </button>
            <button type="button" onClick={() => doAction('warn')}
              className="h-8 px-3 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/30">
              Предупредить
            </button>
            <button type="button" onClick={() => doAction('ignore')}
              className="h-8 px-3 rounded-lg text-xs font-semibold bg-zinc-500/15 text-zinc-400 hover:bg-zinc-500/25 border border-zinc-500/30">
              Игнорировать
            </button>
            <button type="button" onClick={doAnnul}
              className="h-8 px-3 rounded-lg text-xs font-semibold bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 border border-sky-500/30 ml-auto">
              Аннулировать
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Whitelist Panel ──────────────────────────────────────────────────────────

function WhitelistPanel({ csrf }: { csrf: string }) {
  const { showSuccess, showError } = useToastContext()
  const [items, setItems] = useState<WhitelistItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addReason, setAddReason] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const h = await getAuthHeaders()
      const res = await fetch(`${API}/violations/whitelist/list`, { headers: h, credentials: 'include' })
      const d = await res.json()
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleAdd() {
    if (!addEmail.trim()) return
    try {
      const h = await getAuthHeaders()
      const res = await fetch(`${API}/violations/whitelist`, {
        method: 'POST',
        headers: { ...h, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user_email: addEmail.trim(), reason: addReason.trim() || null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showSuccess('Добавлен в белый список', addEmail)
      setAddEmail(''); setAddReason(''); setShowAdd(false)
      void load()
    } catch (e: any) { showError('Ошибка', String(e?.message || e)) }
  }

  async function handleRemove(email: string) {
    if (!confirm(`Удалить ${email} из белого списка?`)) return
    try {
      const h = await getAuthHeaders()
      const res = await fetch(`${API}/violations/whitelist/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: { ...h, 'X-CSRF-Token': csrf },
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showSuccess('Удалён', email)
      void load()
    } catch (e: any) { showError('Ошибка', String(e?.message || e)) }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-primary">Белый список</div>
          <div className="text-xs text-muted mt-0.5">Пользователи исключённые из Anti-Abuse проверок</div>
        </div>
        <button type="button" onClick={() => setShowAdd(v => !v)}
          className="h-8 px-3 rounded-lg text-xs font-semibold bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)] hover:bg-[rgb(var(--accent-rgb)/0.18)]">
          + Добавить
        </button>
      </div>

      {showAdd && (
        <div className="bg-[var(--bg-surface)] rounded-xl border border-default p-4 flex flex-col gap-3">
          <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)}
            placeholder="Email пользователя" autoFocus
            className="w-full px-3 py-2 rounded-lg border border-default bg-overlay-sm text-primary text-sm" />
          <input type="text" value={addReason} onChange={e => setAddReason(e.target.value)}
            placeholder="Причина (опционально)"
            className="w-full px-3 py-2 rounded-lg border border-default bg-overlay-sm text-primary text-sm" />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAdd(false)} className="h-8 px-3 rounded-lg border border-default text-sm text-secondary">Отмена</button>
            <button type="button" onClick={() => void handleAdd()} disabled={!addEmail.trim()}
              className="h-8 px-3 rounded-lg bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)] text-sm font-semibold disabled:opacity-50 hover:bg-[rgb(var(--accent-rgb)/0.18)]">Добавить</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-muted text-sm py-8">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="text-center text-muted text-sm py-8">Белый список пуст</div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 bg-[var(--bg-surface)] rounded-xl border border-default px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-primary font-mono truncate">{item.user_email}</div>
                {item.reason && <div className="text-xs text-muted mt-0.5">{item.reason}</div>}
                <div className="text-xs text-muted/50 mt-0.5">Добавил: {item.added_by} — {fmtTs(item.added_at)}</div>
              </div>
              <button type="button" onClick={() => void handleRemove(item.user_email)}
                className="h-7 w-7 rounded-lg text-red-400 hover:bg-red-500/10 border border-red-500/20 flex items-center justify-center text-sm">
                ✕
              </button>
            </div>
          ))}
          {total > items.length && (
            <div className="text-center text-xs text-muted py-1">Ещё {total - items.length}…</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabId = 'list' | 'pending' | 'top' | 'whitelist'

export default function Violations() {
  const { showError } = useToastContext()
  const [tab, setTab] = useState<TabId>('list')
  const [violations, setViolations] = useState<Violation[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<ViolationStats | null>(null)
  const [topViolators, setTopViolators] = useState<TopViolator[]>([])
  const [selected, setSelected] = useState<Violation | null>(null)
  const [csrf, setCsrf] = useState('')

  // Filters
  const [days, setDays] = useState(7)
  const [severity, setSeverity] = useState('')
  const [minScore, setMinScore] = useState(0)
  const [showPendingOnly, setShowPendingOnly] = useState(false)

  const PER_PAGE = 20

  useEffect(() => {
    fetch(`${API}/auth/check`, { credentials: 'include', cache: 'no-store' })
      .then(r => r.json()).then(d => setCsrf(d.csrf_token || '')).catch(() => {})
  }, [])

  const loadViolations = useCallback(async (pg = 1) => {
    setLoading(true)
    try {
      const h = await getAuthHeaders()
      const params = new URLSearchParams({
        days: String(days),
        page: String(pg),
        per_page: String(PER_PAGE),
      })
      if (severity) params.set('severity', severity)
      if (minScore > 0) params.set('min_score', String(minScore))
      if (showPendingOnly) params.set('resolved', 'false')
      const res = await fetch(`${API}/violations?${params}`, { headers: h, credentials: 'include' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || `HTTP ${res.status}`)
      setViolations(d.items || [])
      setTotal(d.total || 0)
      setPages(d.pages || 1)
      setPage(pg)
    } catch (e: any) { showError('Ошибка', String(e?.message || e)) } finally { setLoading(false) }
  }, [days, severity, minScore, showPendingOnly, showError])

  const loadStats = useCallback(async () => {
    try {
      const h = await getAuthHeaders()
      const [statsRes, topRes] = await Promise.all([
        fetch(`${API}/violations/stats?days=${days}`, { headers: h, credentials: 'include' }),
        fetch(`${API}/violations/top-violators?days=${days}&limit=10`, { headers: h, credentials: 'include' }),
      ])
      const [s, t] = await Promise.all([statsRes.json(), topRes.json()])
      setStats(s)
      setTopViolators(Array.isArray(t) ? t : [])
    } catch { /* ignore */ }
  }, [days])

  useEffect(() => {
    void loadViolations(1)
    void loadStats()
  }, [loadViolations, loadStats])

  const TABS: { id: TabId; label: string }[] = [
    { id: 'list', label: 'Все нарушения' },
    { id: 'top', label: 'Топ нарушителей' },
    { id: 'whitelist', label: 'Белый список' },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-primary">Anti-Abuse — Нарушения</h1>
          <p className="text-sm text-muted mt-0.5">Мониторинг подозрительной активности пользователей</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30].map(d => (
            <button key={d} type="button" onClick={() => setDays(d)}
              className={`h-8 px-3 rounded-lg text-xs border ${days === d ? 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent)] border-[rgb(var(--accent-rgb)/0.35)] font-semibold' : 'border-default text-secondary hover:text-primary'}`}>
              {d}д
            </button>
          ))}
          <button type="button" onClick={() => void loadViolations(1)} disabled={loading}
            className="h-8 px-3 rounded-lg border border-default text-xs text-secondary hover:text-primary disabled:opacity-50">
            {loading ? '⟳' : '↻ Обновить'}
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          {[
            { label: 'Всего', value: stats.total, color: 'text-primary' },
            { label: 'Критических', value: stats.critical, color: 'text-red-400' },
            { label: 'Высоких', value: stats.high, color: 'text-amber-400' },
            { label: 'Средних', value: stats.medium, color: 'text-sky-400' },
            { label: 'Низких', value: stats.low, color: 'text-zinc-400' },
            { label: 'Пользователей', value: stats.unique_users, color: 'text-emerald-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-[var(--bg-surface)] rounded-xl border border-default p-3 text-center">
              <div className="text-xs text-muted mb-1">{label}</div>
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-white/3 p-0.5 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs rounded-md transition-all ${tab === t.id ? 'bg-[var(--bg-surface)] text-primary shadow' : 'text-muted hover:text-secondary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── List Tab ── */}
      {tab === 'list' && (
        <div className="flex flex-col gap-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <select value={severity} onChange={e => setSeverity(e.target.value)}
              className="h-8 px-3 rounded-lg border border-default bg-[var(--bg-surface)] text-xs text-primary">
              <option value="">Все severity</option>
              <option value="critical">Критический</option>
              <option value="high">Высокий</option>
              <option value="medium">Средний</option>
              <option value="low">Низкий</option>
            </select>
            <select value={minScore} onChange={e => setMinScore(Number(e.target.value))}
              className="h-8 px-3 rounded-lg border border-default bg-[var(--bg-surface)] text-xs text-primary">
              <option value={0}>Любой балл</option>
              <option value={30}>≥ 30</option>
              <option value={50}>≥ 50</option>
              <option value={65}>≥ 65</option>
              <option value={80}>≥ 80</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={showPendingOnly} onChange={e => setShowPendingOnly(e.target.checked)}
                className="rounded" />
              Только ожидающие действия
            </label>
            <span className="ml-auto text-xs text-muted">{total} нарушений</span>
          </div>

          {loading ? (
            <div className="text-center text-muted text-sm py-12">Загрузка…</div>
          ) : violations.length === 0 ? (
            <div className="text-center text-muted text-sm py-16 flex flex-col items-center gap-3">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              Нарушений не обнаружено
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {violations.map(v => (
                  <div
                    key={v.id}
                    onClick={() => setSelected(v)}
                    className={`cursor-pointer rounded-xl border px-4 py-3 hover:border-white/20 transition-colors flex items-center gap-3 ${sevBg(v.severity)}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold ${sevColor(v.severity)}`}>{v.severity.toUpperCase()}</span>
                        <span className="text-sm text-primary font-mono truncate">{v.user_email}</span>
                        {v.countries.length > 0 && (
                          <span className="text-xs text-muted">{v.countries.join(', ')}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted flex-wrap">
                        <span>{fmtAgo(v.detected_at)}</span>
                        <span className={recActionColor(v.recommended_action)}>{recActionLabel(v.recommended_action)}</span>
                        {v.reasons.slice(0, 1).map((r, i) => (
                          <span key={i} className="truncate max-w-xs">{r}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-2xl font-bold ${sevColor(v.severity)}`}>{v.score.toFixed(0)}</div>
                      <div className={`text-[10px] ${v.action_taken ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {actionLabel(v.action_taken)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {pages > 1 && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <button type="button" disabled={page <= 1} onClick={() => void loadViolations(page - 1)}
                    className="h-8 px-3 rounded-lg border border-default text-xs text-secondary disabled:opacity-40">
                    ← Пред
                  </button>
                  <span className="text-xs text-muted">{page} / {pages}</span>
                  <button type="button" disabled={page >= pages} onClick={() => void loadViolations(page + 1)}
                    className="h-8 px-3 rounded-lg border border-default text-xs text-secondary disabled:opacity-40">
                    След →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Top Violators Tab ── */}
      {tab === 'top' && (
        <div className="flex flex-col gap-2">
          {topViolators.length === 0 ? (
            <div className="text-center text-muted text-sm py-12">Нет данных</div>
          ) : topViolators.map((u, i) => (
            <div key={u.user_email} className="bg-[var(--bg-surface)] rounded-xl border border-default px-4 py-3 flex items-center gap-3">
              <span className="text-xl font-bold text-muted/30 w-7 text-center flex-shrink-0">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-primary font-mono truncate">{u.user_email}</div>
                <div className="text-xs text-muted mt-0.5">
                  Последнее: {fmtAgo(u.last_violation_at)}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-lg font-bold text-amber-400">{u.violations_count}</div>
                <div className="text-xs text-muted">нарушений</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-bold text-red-400">{u.max_score.toFixed(0)}</div>
                <div className="text-xs text-muted">макс. балл</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Whitelist Tab ── */}
      {tab === 'whitelist' && <WhitelistPanel csrf={csrf} />}

      {/* Detail modal */}
      {selected && (
        <ViolationDetailModal
          v={selected}
          csrf={csrf}
          onClose={() => setSelected(null)}
          onRefresh={() => { void loadViolations(page); void loadStats() }}
        />
      )}
    </div>
  )
}
