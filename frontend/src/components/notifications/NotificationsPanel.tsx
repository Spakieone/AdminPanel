import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import * as Flags from 'country-flag-icons/react/3x2'
import type { NotificationItem } from '../../hooks/useNotifications'
import { formatLocalDateTime } from '../../utils/dateUtils'
import { getProviderColor } from '../../utils/providerColor'

interface NotificationsPanelProps {
  onClose: () => void
  notifications: NotificationItem[]
  readIds: Set<string>
  unreadCount: number
  loading: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onClearAll: () => void
  anchorRect?: { top: number; left: number; right: number; bottom: number; width: number; height: number } | null
}

function FlagEmoji({ code }: { code?: string | null }) {
  const cc = String(code || '').trim().toUpperCase()
  if (!cc) return null
  const FlagComp = (Flags as any)[cc] as React.ComponentType<{ className?: string; title?: string; style?: React.CSSProperties }>
  if (!FlagComp) return <span className="text-xs font-mono text-muted">{cc}</span>
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded" style={{ width: 18, height: 13, minWidth: 18, verticalAlign: 'middle' }}>
      <FlagComp title={cc} style={{ width: 18, height: 13, display: 'block' }} />
    </span>
  )
}

// Color palette — muted, not neon
const TYPE_COLORS = {
  payment: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-l-emerald-500', borderFaded: 'border-l-emerald-500/20', cardBg: 'bg-emerald-500/[0.05]', cardBgHover: 'hover:bg-emerald-500/[0.08]', dot: 'bg-emerald-400', badge: 'bg-emerald-400/10 text-emerald-300' },
  user:    { text: 'text-sky-400',     bg: 'bg-sky-400/10',     border: 'border-l-sky-500',     borderFaded: 'border-l-sky-500/20',     cardBg: 'bg-sky-500/[0.05]',     cardBgHover: 'hover:bg-sky-500/[0.08]',     dot: 'bg-sky-400',     badge: 'bg-sky-400/10 text-sky-300' },
  error:   { text: 'text-rose-400',    bg: 'bg-rose-400/10',    border: 'border-l-rose-500',    borderFaded: 'border-l-rose-500/20',    cardBg: 'bg-rose-500/[0.05]',    cardBgHover: 'hover:bg-rose-500/[0.08]',    dot: 'bg-rose-400',    badge: 'bg-rose-400/10 text-rose-300' },
  success: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-l-emerald-500', borderFaded: 'border-l-emerald-500/20', cardBg: 'bg-emerald-500/[0.05]', cardBgHover: 'hover:bg-emerald-500/[0.08]', dot: 'bg-emerald-400', badge: 'bg-emerald-400/10 text-emerald-300' },
} as const

function getTypeColors(type: string) {
  return TYPE_COLORS[type as keyof typeof TYPE_COLORS] ?? TYPE_COLORS.success
}

// Shared message renderer — used in panel and can be reused on page
export function renderNotifMessage(notif: NotificationItem, onCopy?: (id: string) => void): React.ReactNode {
  const msg = String(notif.message || '')
  if (!msg) return null

  const parts = msg.split(' • ')
  const colors = getTypeColors(notif.type)
  const countryCode = (notif.data?.country_code as string | undefined) || ''

  const handleCopy = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    navigator.clipboard.writeText(id).catch(() => {})
    onCopy?.(id)
  }

  const renderPart = (p: string, partIdx: number) => {
    const sep = partIdx > 0 ? <span className="text-faint"> • </span> : null
    const low = p.toLowerCase()

    // Downtime / status — accent color
    if (low.includes('простой:') || low.includes('статус:')) {
      return (
        <span key={partIdx} className={`font-semibold ${colors.text}`}>
          {sep}{p}
        </span>
      )
    }

    // Node part — show flag if available
    if (low.startsWith('нода:') && countryCode) {
      return (
        <span key={partIdx} className="text-muted inline-flex items-center gap-1" style={{ verticalAlign: 'middle' }}>
          {sep}<FlagEmoji code={countryCode} />{p}
        </span>
      )
    }

    // For payment: first part is "Платеж NNN ₽" — highlight amount green
    if (notif.type === 'payment' && partIdx === 0) {
      const amountMatch = p.match(/^Платеж\s+([\d\s,]+)\s*₽$/)
      if (amountMatch) {
        return (
          <span key={partIdx} className="font-semibold text-green-400">
            {p}
          </span>
        )
      }
    }

    // Tokenize: find numeric IDs (≥6 digits) and "ID: NNNN" patterns
    // Also highlight known provider names (overpay_sbp, etc.)
    const tokens: React.ReactNode[] = []
    // Combined regex: "ID:\s*(\d+)" OR standalone \d{6,} OR known_provider
    const re = /(?:ID:\s*(\d+))|(\d{6,})/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(p)) !== null) {
      if (m.index > last) {
        tokens.push(<span key={`pre${m.index}`} className="text-muted">{p.slice(last, m.index)}</span>)
      }
      const idVal = m[1] ?? m[2]
      const rawText = m[0]
      // Always show "ID: " prefix for numeric IDs
      const label = rawText.toLowerCase().startsWith('id:') ? `ID: ${idVal}` : `ID: ${idVal}`
      tokens.push(
        <span
          key={`id${m.index}`}
          role="button"
          tabIndex={0}
          onClick={(e) => handleCopy(idVal, e)}
          onKeyDown={(e) => e.key === 'Enter' && handleCopy(idVal, e as any)}
          className="text-sky-300 font-medium cursor-pointer hover:text-sky-200 transition-colors underline-offset-2 hover:underline"
          title="Нажмите чтобы скопировать"
        >
          {label}
        </span>
      )
      last = m.index + rawText.length
    }
    if (last < p.length) {
      const tail = p.slice(last)
      const trimmed = tail.trim()
      const isProvider = notif.type === 'payment' && /^[a-zA-Z][a-zA-Z0-9_]{2,}$/.test(trimmed)
      if (isProvider) {
        const ps = getProviderColor(trimmed)
        tokens.push(
          <span
            key={`tail${last}`}
            style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '0.1rem 0.45rem', borderRadius: '9999px',
              fontSize: '0.7rem', fontWeight: 500,
              background: ps.bg, color: ps.color,
              verticalAlign: 'middle',
            }}
          >
            {trimmed}
          </span>
        )
      } else {
        tokens.push(<span key={`tail${last}`} className="text-muted">{tail}</span>)
      }
    }

    if (tokens.length === 0) {
      const trimmed = p.trim()
      const isProvider = notif.type === 'payment' && /^[a-zA-Z][a-zA-Z0-9_]{2,}$/.test(trimmed)
      if (isProvider) {
        const ps = getProviderColor(trimmed)
        return (
          <span key={partIdx} style={{ display: 'inline-flex', alignItems: 'center', padding: '0.1rem 0.45rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 500, background: ps.bg, color: ps.color, verticalAlign: 'middle' }}>
            {sep}{trimmed}
          </span>
        )
      }
      return (
        <span key={partIdx} className="text-muted">
          {sep}{p}
        </span>
      )
    }

    return (
      <span key={partIdx}>
        {sep}{tokens}
      </span>
    )
  }

  return <span>{parts.map((p, idx) => renderPart(p, idx))}</span>
}

export default function NotificationsPanel({
  onClose,
  notifications,
  readIds,
  unreadCount,
  loading,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  anchorRect,
}: NotificationsPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  useEffect(() => {
    const onDown = (e: Event) => {
      const el = panelRef.current
      if (!el) return
      const target = (e as any).target as HTMLElement | null
      if (!target) return
      if (el.contains(target)) return
      if (target.closest('button.uiv-notif-btn')) return
      if (target.closest('.notifications-button')) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onClose])

  const formatTime = (date: Date) => formatLocalDateTime(date)

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const n of notifications) {
      const t = n.type === 'success' ? 'payment' : n.type
      counts[t] = (counts[t] ?? 0) + 1
    }
    return counts
  }, [notifications])

  const visible = useMemo(() => {
    let base = tab === 'unread' ? notifications.filter((n) => !readIds.has(n.id)) : notifications
    if (typeFilter !== 'all') {
      const tf = typeFilter
      base = base.filter((n) => {
        const t = n.type === 'success' ? 'payment' : n.type
        return t === tf
      })
    }
    return base.slice(0, 200)
  }, [notifications, readIds, tab, typeFilter])

  const getNotificationIcon = (type: string) => {
    const c = getTypeColors(type)
    const iconSvg: Record<string, React.ReactElement> = {
      payment: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
      user: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
      error: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      success: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    }
    return (
      <div className={`flex items-center justify-center w-8 h-8 rounded-full ${c.bg} ${c.text} flex-shrink-0`}>
        {iconSvg[type] || iconSvg.success}
      </div>
    )
  }

  const getBadge = (type: string) => {
    const c = getTypeColors(type)
    const labels: Record<string, string> = { payment: 'Платёж', user: 'Пользователь', error: 'Ошибка', success: 'Успех' }
    return { text: labels[type] ?? 'Уведомление', cls: c.badge }
  }

  const content = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[99999] bg-black/20 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="z-[100000]"
        style={{
          position: 'fixed',
          ...(anchorRect
            ? (() => {
                const vw = typeof window !== 'undefined' ? window.innerWidth : 0
                const vh = typeof window !== 'undefined' ? window.innerHeight : 0
                const w = typeof window !== 'undefined' ? Math.min(520, Math.max(400, vw - 16)) : 520
                const left = typeof window !== 'undefined'
                  ? Math.max(8, Math.min(anchorRect.right - w, vw - w - 8))
                  : 8
                const top = anchorRect.bottom + 8
                const maxH = typeof window !== 'undefined'
                  ? Math.max(260, Math.min(Math.floor(vh * 0.85), vh - top - 12))
                  : undefined
                return {
                  top: `${top}px`,
                  left: `${left}px`,
                  width: `${w}px`,
                  height: maxH ? `${maxH}px` : undefined,
                  maxHeight: maxH ? `${maxH}px` : undefined,
                }
              })()
            : {
                top: '80px',
                right: '16px',
                width: 'min(520px, calc(100vw - 2rem))',
                maxHeight: '80vh',
              }),
          animation: 'popIn 0.2s ease-out forwards',
        }}
      >
        <div className="flex flex-col h-full rounded-2xl border border-default bg-surface shadow-theme-lg overflow-hidden">
          {/* Header */}
          <div className="px-5 pt-4 pb-3 border-b border-subtle">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-primary">
                  Уведомления
                </h3>
                {unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--accent)] text-black">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg text-secondary hover:text-primary border border-default hover:border-strong hover:bg-overlay-md transition-colors"
                  >
                    Прочитать всё
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClearAll}
                  className="p-1.5 rounded-lg text-rose-400/70 hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
                  title="Очистить"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0V5a2 2 0 012-2h2a2 2 0 012 2v2M4 7h16" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-rose-400/70 hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
                  title="Закрыть"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tab buttons */}
            <div className="flex items-center gap-1 p-0.5 bg-overlay-sm rounded-lg">
              <button
                type="button"
                onClick={() => setTab('all')}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === 'all'
                    ? 'bg-overlay-md text-primary shadow-sm'
                    : 'text-muted hover:text-dim'
                }`}
              >
                Все
              </button>
              <button
                type="button"
                onClick={() => setTab('unread')}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === 'unread'
                    ? 'bg-overlay-md text-primary shadow-sm'
                    : 'text-muted hover:text-dim'
                }`}
              >
                Непрочитанные
                {unreadCount > 0 && (
                  <span className="ml-1.5 text-xs font-medium text-muted">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
              </button>
            </div>

            {/* Type filter pills */}
            {notifications.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {([
                  { key: 'all', label: 'Все' },
                  { key: 'payment', label: 'Платежи' },
                  { key: 'user', label: 'Юзеры' },
                  { key: 'error', label: 'Ошибки' },
                ] as const).map(({ key, label }) => {
                  const count = key === 'all' ? notifications.length : (typeCounts[key] ?? 0)
                  if (key !== 'all' && count === 0) return null
                  const active = typeFilter === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTypeFilter(key)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                        active
                          ? 'bg-accent-10 text-[var(--accent)] border-[var(--accent)]/30'
                          : 'bg-overlay-xs text-muted border-default hover:border-strong hover:text-dim'
                      }`}
                    >
                      {label}
                      <span className={`text-[10px] ${active ? 'text-[var(--accent)]/70' : 'text-faint'}`}>{count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* List */}
          <div
            className="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-muted">Загрузка…</div>
            ) : visible.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted">Нет уведомлений</div>
            ) : (
              <ul className="py-1">
                {visible.map((notif, index) => {
                  const isRead = readIds.has(notif.id)
                  const badge = getBadge(notif.type)
                  const c = getTypeColors(notif.type)
                  return (
                    <li key={`${notif.id}-${index}`} className="mx-2 mb-1">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onMarkRead(notif.id)}
                        onKeyDown={(e) => e.key === 'Enter' && onMarkRead(notif.id)}
                        className={`w-full text-left flex gap-2.5 px-3 py-2.5 rounded-xl transition-colors cursor-pointer border-l-[3px] border border-t-transparent border-r-transparent border-b-transparent ${
                          isRead
                            ? `bg-overlay-xs ${c.borderFaded} hover:bg-overlay-sm`
                            : `${c.cardBg} ${c.border} ${c.cardBgHover}`
                        }`}
                      >
                        {getNotificationIcon(notif.type)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium ${badge.cls}`}>
                              {badge.text}
                            </span>
                            {!isRead && (
                              <span className={`w-1.5 h-1.5 rounded-full ${c.dot} opacity-80`} />
                            )}
                            <span className="ml-auto text-[11px] text-faint whitespace-nowrap">
                              {formatTime(notif.date)}
                            </span>
                          </div>
                          <div className={`text-sm leading-5 ${isRead ? 'text-dim' : 'font-medium text-secondary'}`}>
                            {notif.title}
                          </div>
                          <div className="mt-0.5 text-xs leading-4 text-muted">
                            {renderNotifMessage(notif)}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-subtle">
            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/notifications')
              }}
              className="w-full py-2 rounded-lg text-sm font-medium text-[var(--accent)] hover:bg-accent-10 transition-colors"
            >
              Все уведомления
            </button>
          </div>
        </div>

        <style>{`
        @keyframes popIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      </div>
    </>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null
}
