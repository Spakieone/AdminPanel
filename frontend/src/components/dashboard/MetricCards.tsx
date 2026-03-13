import Badge from '../ui/badge/Badge'

interface MetricCardsProps {
  users: { total: number; day: number; yesterday: number; week: number; month: number; prev_month: number }
  finances: { total: number; day: number; yesterday: number; week: number; month: number; prev_month: number }
  subs: { total: number; active: number; paid_active: number; trial_active: number; expired: number }
}

function calcChange(current: number, previous: number): { pct: string; up: boolean } {
  if (!previous) return { pct: '0%', up: true }
  const diff = ((current - previous) / previous) * 100
  return { pct: `${Math.abs(diff).toFixed(1)}%`, up: diff >= 0 }
}

function ArrowUp() {
  return (
    <svg className="fill-current" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.45 0.5L0.983333 4.025C0.816667 4.19167 0.816667 4.44167 0.983333 4.60833C1.15 4.775 1.4 4.775 1.56667 4.60833L4.58333 1.53333V9.16667C4.58333 9.39167 4.775 9.58333 5 9.58333C5.225 9.58333 5.41667 9.39167 5.41667 9.16667V1.53333L8.43333 4.60833C8.51667 4.69167 8.625 4.73333 8.73333 4.73333C8.84167 4.73333 8.95 4.69167 9.03333 4.60833C9.2 4.44167 9.2 4.19167 9.03333 4.025L5.56667 0.5C5.4 0.333333 5.15 0.333333 4.98333 0.5H4.45Z" />
    </svg>
  )
}

function ArrowDown() {
  return (
    <svg className="fill-current" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.55 9.5L9.01667 5.975C9.18333 5.80833 9.18333 5.55833 9.01667 5.39167C8.85 5.225 8.6 5.225 8.43333 5.39167L5.41667 8.46667V0.833333C5.41667 0.608333 5.225 0.416667 5 0.416667C4.775 0.416667 4.58333 0.608333 4.58333 0.833333V8.46667L1.56667 5.39167C1.48333 5.30833 1.375 5.26667 1.26667 5.26667C1.15833 5.26667 1.05 5.30833 0.966667 5.39167C0.8 5.55833 0.8 5.80833 0.966667 5.975L4.43333 9.5C4.6 9.66667 4.85 9.66667 5.01667 9.5H5.55Z" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg className="text-primary" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg className="text-primary" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg className="text-primary" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v-5.5m3 5.5V8.25m3 3v-2" />
    </svg>
  )
}

function DollarIcon() {
  return (
    <svg className="text-primary" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

const fmt = (n: number) => Number(n).toLocaleString('ru-RU')
const fmtR = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export default function MetricCards({ users, finances, subs }: MetricCardsProps) {
  const userChange = calcChange(users.month, users.prev_month)
  const financeChange = calcChange(finances.month, finances.prev_month)

  const C = 'rounded-2xl border border-default bg-overlay-xs p-5 md:p-6'
  const subLabel = 'text-xs text-muted'
  const subVal = 'text-xs font-mono text-secondary'

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">
      {/* Users */}
      <div className={C}>
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-center w-12 h-12 bg-overlay-md rounded-xl">
            <UsersIcon />
          </div>
          <Badge color={userChange.up ? 'success' : 'error'}>
            {userChange.up ? <ArrowUp /> : <ArrowDown />}
            {userChange.pct}
          </Badge>
        </div>
        <div className="mt-4">
          <span className="text-sm text-muted">Пользователи</span>
          <h4 className="mt-1 text-2xl font-bold text-primary font-mono">
            {fmt(users.total)}
          </h4>
        </div>
        <div className="mt-3 pt-3 border-t border-default grid grid-cols-3 gap-2">
          <div><span className={subLabel}>Сегодня</span><div className={subVal}>+{fmt(users.day)}</div></div>
          <div><span className={subLabel}>Неделя</span><div className={subVal}>+{fmt(users.week)}</div></div>
          <div><span className={subLabel}>Месяц</span><div className={subVal}>+{fmt(users.month)}</div></div>
        </div>
      </div>

      {/* Finance */}
      <div className={C}>
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-center w-12 h-12 bg-overlay-md rounded-xl">
            <WalletIcon />
          </div>
          <Badge color={financeChange.up ? 'success' : 'error'}>
            {financeChange.up ? <ArrowUp /> : <ArrowDown />}
            {financeChange.pct}
          </Badge>
        </div>
        <div className="mt-4">
          <span className="text-sm text-muted">Финансы</span>
          <h4 className="mt-1 text-2xl font-bold text-primary font-mono">
            {fmtR(finances.total)}
          </h4>
        </div>
        <div className="mt-3 pt-3 border-t border-default grid grid-cols-3 gap-2">
          <div><span className={subLabel}>Сегодня</span><div className={subVal}>{fmtR(finances.day)}</div></div>
          <div><span className={subLabel}>Неделя</span><div className={subVal}>{fmtR(finances.week)}</div></div>
          <div><span className={subLabel}>Месяц</span><div className={subVal}>{fmtR(finances.month)}</div></div>
        </div>
      </div>

      {/* Active subs */}
      <div className={C}>
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-center w-12 h-12 bg-overlay-md rounded-xl">
            <ChartIcon />
          </div>
          <Badge color="success">
            <ArrowUp />
            {fmt(subs.paid_active)} платных
          </Badge>
        </div>
        <div className="mt-4">
          <span className="text-sm text-muted">Активные подписки</span>
          <h4 className="mt-1 text-2xl font-bold text-primary font-mono">
            {fmt(subs.active)}
          </h4>
        </div>
        <div className="mt-3 pt-3 border-t border-default grid grid-cols-3 gap-2">
          <div><span className={subLabel}>Платные</span><div className={subVal}>{fmt(subs.paid_active)}</div></div>
          <div><span className={subLabel}>Пробные</span><div className={subVal}>{fmt(subs.trial_active)}</div></div>
          <div><span className={subLabel}>Истекшие</span><div className={subVal}>{fmt(subs.expired)}</div></div>
        </div>
      </div>

      {/* Today */}
      <div className={C}>
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-center w-12 h-12 bg-overlay-md rounded-xl">
            <DollarIcon />
          </div>
          <Badge color="info">
            +{fmt(users.day)} юзеров
          </Badge>
        </div>
        <div className="mt-4">
          <span className="text-sm text-muted">За сегодня</span>
          <h4 className="mt-1 text-2xl font-bold text-primary font-mono">
            {fmtR(finances.day)}
          </h4>
        </div>
        <div className="mt-3 pt-3 border-t border-default grid grid-cols-3 gap-2">
          <div><span className={subLabel}>Вчера</span><div className={subVal}>{fmtR(finances.yesterday)}</div></div>
          <div><span className={subLabel}>Юзеры</span><div className={subVal}>+{fmt(users.day)}</div></div>
          <div><span className={subLabel}>Вчера</span><div className={subVal}>+{fmt(users.yesterday)}</div></div>
        </div>
      </div>
    </div>
  )
}
