import { useMemo, useState } from 'react'
import { useNotificationsContext } from '../contexts/NotificationsContext'
import type { NotificationItem } from '../hooks/useNotifications'
import { formatLocalDateTime } from '../utils/dateUtils'
import { renderNotifMessage } from '../components/notifications/NotificationsPanel'

type FilterKind = 'all' | 'unread' | NotificationItem['type']

function fmt(date: Date) {
  return formatLocalDateTime(date)
}

// Muted color palette, consistent with panel
const TYPE_COLORS = {
  payment: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', badge: 'bg-emerald-400/10 text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-400', filterBorder: 'border-emerald-500/25', filterActive: 'bg-emerald-500/10 text-emerald-200' },
  user:    { text: 'text-sky-400',     bg: 'bg-sky-400/10',     badge: 'bg-sky-400/10 text-sky-300 border-sky-500/20',     dot: 'bg-sky-400',     filterBorder: 'border-sky-500/25',     filterActive: 'bg-sky-500/10 text-sky-200' },
  error:   { text: 'text-rose-400',    bg: 'bg-rose-400/10',    badge: 'bg-rose-400/10 text-rose-300 border-rose-500/20',    dot: 'bg-rose-400',    filterBorder: 'border-rose-500/25',    filterActive: 'bg-rose-500/10 text-rose-200' },
  success: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', badge: 'bg-emerald-400/10 text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-400', filterBorder: 'border-emerald-500/25', filterActive: 'bg-emerald-500/10 text-emerald-200' },
} as const

function getTypeColors(type: string) {
  return TYPE_COLORS[type as keyof typeof TYPE_COLORS] ?? TYPE_COLORS.success
}


function Icon({ type }: { type: NotificationItem['type'] }) {
  const c = getTypeColors(type)
  const icons: Record<string, React.ReactElement> = {
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
    success: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    error: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }
  return (
    <div className={`flex items-center justify-center w-8 h-8 rounded-full ${c.bg} ${c.text} flex-shrink-0 mt-0.5`}>
      {icons[type] ?? icons.error}
    </div>
  )
}

export default function NotificationsPage() {
  const notif = useNotificationsContext()
  const [filter, setFilter] = useState<FilterKind>('all')

  const filtered = useMemo(() => {
    const items = notif.notifications || []
    if (filter === 'all') return items
    if (filter === 'unread') return items.filter((n) => !notif.readIds.has(n.id))
    return items.filter((n) => n.type === filter)
  }, [filter, notif.notifications, notif.readIds])

  const counts = useMemo(() => {
    const items = notif.notifications || []
    const unread = items.filter((n) => !notif.readIds.has(n.id)).length
    const byType = {
      payment: items.filter((n) => n.type === 'payment').length,
      user: items.filter((n) => n.type === 'user').length,
      error: items.filter((n) => n.type === 'error').length,
      success: items.filter((n) => n.type === 'success').length,
    }
    return { unread, total: items.length, byType }
  }, [notif.notifications, notif.readIds])

  const FilterBtn = ({ id, label, count }: { id: FilterKind; label: string; count?: number }) => {
    const active = filter === id
    const c = id === 'payment' ? getTypeColors('payment')
      : id === 'user' ? getTypeColors('user')
      : id === 'error' ? getTypeColors('error')
      : id === 'success' ? getTypeColors('success')
      : null
    return (
      <button
        type="button"
        onClick={() => setFilter(id)}
        className={[
          'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border transition-colors text-sm font-medium touch-manipulation active:opacity-70',
          c ? c.filterBorder : 'border-default',
          active
            ? c ? `${c.filterActive} border-opacity-50` : 'bg-overlay-md text-primary'
            : 'bg-overlay-xs text-muted hover:text-secondary hover:bg-overlay-sm',
        ].join(' ')}
      >
        <span>{label}</span>
        {typeof count === 'number' ? (
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${c ? c.badge : 'bg-overlay-md text-muted border-default'} border`}>
            {count}
          </span>
        ) : null}
      </button>
    )
  }

  const badgeLabels: Record<string, string> = { payment: 'Платёж', user: 'Пользователь', error: 'Ошибка', success: 'Успех' }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 mb-6">
        <div className="text-muted text-xs sm:text-sm">
          Всего: {counts.total} • Непрочитано: {counts.unread}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={notif.markAllAsRead}
            className="px-4 py-2.5 min-h-[44px] rounded-lg transition-colors text-sm font-medium border border-default bg-overlay-sm text-secondary hover:bg-overlay-md hover:text-primary touch-manipulation active:opacity-70"
          >
            Прочитать всё
          </button>
          <button
            type="button"
            onClick={notif.clearAll}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg transition-colors text-sm font-medium border border-rose-500/20 bg-rose-500/[0.07] hover:bg-rose-500/[0.12] text-rose-300 touch-manipulation active:opacity-70"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0V5a2 2 0 012-2h2a2 2 0 012 2v2M4 7h16" />
            </svg>
            Очистить
          </button>
        </div>
      </div>

      <div className="glass-panel p-3 sm:p-4 mb-3 sm:mb-4">
        <div className="flex flex-wrap gap-2">
          <FilterBtn id="all" label="Все" count={counts.total} />
          <FilterBtn id="unread" label="Непрочитанные" count={counts.unread} />
          <FilterBtn id="payment" label="Платежи" count={counts.byType.payment} />
          <FilterBtn id="user" label="Новые пользователи" count={counts.byType.user} />
          <FilterBtn id="error" label="Ошибки" count={counts.byType.error} />
          <FilterBtn id="success" label="Успех" count={counts.byType.success} />
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        {notif.loading ? (
          <div className="px-4 py-10 text-center text-sm text-muted">Загрузка…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">Пока пусто</div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {filtered.map((n) => {
              const isRead = notif.readIds.has(n.id)
              const c = getTypeColors(n.type)
              return (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => notif.markAsRead(n.id)}
                  onKeyDown={(e) => e.key === 'Enter' && notif.markAsRead(n.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 cursor-pointer hover:bg-overlay-xs transition-colors"
                >
                  <Icon type={n.type} />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${c.badge}`}>
                        {badgeLabels[n.type] ?? 'Уведомление'}
                      </span>
                      {!isRead ? <span className={`inline-block size-1.5 rounded-full ${c.dot} opacity-80`} aria-label="Непрочитано" /> : null}
                      <span className="ml-auto text-xs text-faint">{fmt(n.date)}</span>
                    </div>
                    <p className={`text-sm leading-5 ${isRead ? 'text-secondary' : 'text-primary font-medium'}`}>
                      {n.title}{' '}
                      <span className="font-normal">{renderNotifMessage(n)}</span>
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
