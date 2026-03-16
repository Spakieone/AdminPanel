
interface MetricCardsProps {
  users: { total: number; day: number; yesterday: number; week: number; month: number; prev_month: number }
  finances: { total: number; day: number; yesterday: number; week: number; month: number; prev_month: number }
  subs: { total: number; active: number; paid_active: number; trial_active: number; expired: number }
  banned?: number
}



const fmt = (n: number) => Number(n).toLocaleString('ru-RU')
const fmtR = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export default function MetricCards({ users, finances, subs, banned = 0 }: MetricCardsProps) {
  const C = 'rounded-2xl border border-default bg-overlay-xs p-5 md:p-6'

  const row = 'flex items-center justify-between py-1'
  const rowLabel = 'text-sm text-muted'
  const rowVal = 'text-sm font-mono font-medium text-primary'
  const rowValAccent = 'text-sm font-mono font-medium text-[var(--accent)]'
  const indent1 = 'flex items-center justify-between py-1 pl-4'

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">
      {/* Users */}
      <div className={C}>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center justify-center w-10 h-10 bg-overlay-md rounded-xl shrink-0 text-2xl">
            👥
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-muted">Пользователи</span>
              <span className="text-2xl font-bold text-primary font-mono">{fmt(users.total)}</span>
            </div>
          </div>
        </div>
        <div className="pt-3 border-t border-default space-y-0.5">
          <div className={row}><span className={rowLabel}>🗓️ За день</span><span className={rowValAccent}>+{fmt(users.day)}</span></div>
          <div className={row}><span className={rowLabel}>🗓️ Вчера</span><span className={rowVal}>+{fmt(users.yesterday)}</span></div>
          <div className={row}><span className={rowLabel}>📆 За неделю</span><span className={rowVal}>+{fmt(users.week)}</span></div>
          <div className={row}><span className={rowLabel}>🗓️ За месяц</span><span className={rowVal}>+{fmt(users.month)}</span></div>
          <div className={row}><span className={rowLabel}>📅 Прошлый месяц</span><span className={rowVal}>+{fmt(users.prev_month)}</span></div>
          <div className="pt-2 mt-1 border-t border-default">
            <div className={row}><span className={rowLabel}>🚫 Забаненых</span><span className="text-sm font-mono font-bold text-red-400">{fmt(banned)}</span></div>
          </div>
        </div>
      </div>

      {/* Finance */}
      <div className={C}>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center justify-center w-10 h-10 bg-overlay-md rounded-xl shrink-0 text-2xl">
            💰
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-muted">Финансы</span>
              <span className="text-2xl font-bold text-primary font-mono">{fmtR(finances.total)}</span>
            </div>
          </div>
        </div>
        <div className="pt-3 border-t border-default space-y-0.5">
          <div className={row}><span className={rowLabel}>📅 За день</span><span className={rowValAccent}>{fmtR(finances.day)}</span></div>
          <div className={row}><span className={rowLabel}>📆 Вчера</span><span className={rowVal}>{fmtR(finances.yesterday)}</span></div>
          <div className={row}><span className={rowLabel}>📆 За неделю</span><span className={rowVal}>{fmtR(finances.week)}</span></div>
          <div className={row}><span className={rowLabel}>📆 За месяц</span><span className="text-sm font-mono font-medium text-emerald-400">{fmtR(finances.month)}</span></div>
          <div className={row}><span className={rowLabel}>📆 Прошлый месяц</span><span className={rowVal}>{fmtR(finances.prev_month)}</span></div>
        </div>
      </div>

      {/* Subscriptions */}
      <div className={C}>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center justify-center w-10 h-10 bg-overlay-md rounded-xl shrink-0 text-2xl">
            📊
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-muted">Подписки</span>
              <span className="text-2xl font-bold text-primary font-mono">{fmt(subs.total)}</span>
            </div>
          </div>
        </div>
        <div className="pt-3 border-t border-default space-y-0.5">
          <div className={row}><span className={rowLabel}>📦 Всего сгенерировано</span><span className={rowVal}>{fmt(subs.total)}</span></div>
          <div className={row}><span className={rowLabel}>✅ Активных</span><span className={rowValAccent}>{fmt(subs.active)}</span></div>
          <div className={indent1}><span className={rowLabel}>💰 Платных</span><span className="text-sm font-mono font-medium text-emerald-400">{fmt(subs.paid_active)}</span></div>
          <div className={indent1}><span className={rowLabel}>🧪 Триальных</span><span className={rowVal}>{fmt(subs.trial_active)}</span></div>
          <div className={row}><span className={rowLabel}>❌ Просроченных</span><span className="text-sm font-mono font-medium text-red-400">{fmt(subs.expired)}</span></div>
        </div>
      </div>

    </div>
  )
}
