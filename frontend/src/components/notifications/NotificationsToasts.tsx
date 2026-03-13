import type { NotificationItem } from '../../hooks/useNotifications'
import { formatLocalDateTime } from '../../utils/dateUtils'
import UiverseToastCard from '../common/UiverseToastCard'
import { getProviderColor } from '../../utils/providerColor'

function toVariant(type: NotificationItem['type']) {
  switch (type) {
    case 'payment':
    case 'success':
      return 'success' as const
    case 'user':
      return 'information' as const
    case 'error':
    default:
      return 'error' as const
  }
}

function formatTime(date: Date) {
  return formatLocalDateTime(date)
}

function PaymentDescription({ n }: { n: NotificationItem }) {
  const provider: string = n.data?.provider || ''
  const amount: number = n.data?.amount || 0
  const tgId = n.data?.tgId || ''

  if (!provider) return <span>{n.message}</span>

  const ps = getProviderColor(provider)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-semibold text-green-400">{amount.toLocaleString('ru-RU')} ₽</span>
      {tgId ? <span className="text-muted">• {tgId}</span> : null}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: '0.15rem 0.5rem',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 500,
          background: ps.bg,
          color: ps.color,
        }}
      >
        {provider}
      </span>
    </span>
  )
}

export default function NotificationsToasts({
  items,
  onDismiss,
  onOpenPanel,
}: {
  items: NotificationItem[]
  onDismiss: (id: string) => void
  onOpenPanel: () => void
}) {
  if (!items.length) return null

  return (
    <div
      className="z-[99960] space-y-2"
      style={{
        position: 'fixed',
        top: 'calc(var(--safe-top,0px) + 70px)',
        right: '16px',
        width: '380px',
        maxWidth: 'calc(100vw - 32px)',
        pointerEvents: 'auto',
      }}
    >
      {items.map((n) => {
        const variant = toVariant(n.type)
        return (
          <div key={n.id} className="animate-fade-in">
            <UiverseToastCard
              variant={variant}
              title={n.title}
              description={n.type === 'payment' ? <PaymentDescription n={n} /> : n.message}
              onClose={() => onDismiss(n.id)}
              footer={
                <button
                  type="button"
                  onClick={onOpenPanel}
                  className="text-muted hover:text-primary transition-colors underline underline-offset-2 decoration-white/20"
                >
                  Открыть уведомления • {formatTime(n.date)}
                </button>
              }
            />
          </div>
        )
      })}
    </div>
  )
}
