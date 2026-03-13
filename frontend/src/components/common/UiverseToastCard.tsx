import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type UiverseToastVariant = 'success' | 'error' | 'warning' | 'information'

type VariantMeta = {
  Icon: typeof CheckCircle
  accentClass: string
  titleClass: string
  bgClass: string
  progressColor: string
}

function variantMeta(variant: UiverseToastVariant): VariantMeta {
  switch (variant) {
    case 'success':
      return { Icon: CheckCircle,    accentClass: 'toast-accent-success', titleClass: 'toast-title-success', bgClass: 'toast-bg-success', progressColor: '#22c55e' }
    case 'warning':
      return { Icon: AlertTriangle,  accentClass: 'toast-accent-warning', titleClass: 'toast-title-warning', bgClass: 'toast-bg-warning', progressColor: '#f59e0b' }
    case 'information':
      return { Icon: Info,           accentClass: 'toast-accent-info',    titleClass: 'toast-title-info',    bgClass: 'toast-bg-info',    progressColor: '#38bdf8' }
    case 'error':
    default:
      return { Icon: AlertCircle,    accentClass: 'toast-accent-error',   titleClass: 'toast-title-error',   bgClass: 'toast-bg-error',   progressColor: '#ef4444' }
  }
}

export default function UiverseToastCard({
  variant,
  title,
  description,
  onClose,
  footer,
  duration = 4000,
}: {
  variant: UiverseToastVariant
  title: string
  description?: string | ReactNode
  onClose?: () => void
  footer?: ReactNode
  duration?: number
}) {
  const v = variantMeta(variant)
  const { Icon } = v
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClose = () => {
    if (exiting) return
    setExiting(true)
    timerRef.current && clearTimeout(timerRef.current)
    setTimeout(() => onClose?.(), 280)
  }

  useEffect(() => {
    return () => { timerRef.current && clearTimeout(timerRef.current) }
  }, [])

  return (
    <div
      className={cn('tabler-toast', v.bgClass, v.accentClass)}
      style={{
        animation: exiting
          ? 'toast-out 0.28s ease-in forwards'
          : 'toast-in 0.3s cubic-bezier(0.21,1.02,0.73,1) forwards',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Icon className={cn('tabler-toast-icon', v.accentClass)} />

      <div className="tabler-toast-body">
        {title ? <div className={cn('tabler-toast-title', v.titleClass)}>{title}</div> : null}
        {description ? (
          <div className="tabler-toast-desc">
            {description}
          </div>
        ) : null}
        {footer ? <div className="tabler-toast-desc">{footer}</div> : null}
      </div>

      {onClose ? (
        <button
          type="button"
          onClick={handleClose}
          className="tabler-toast-close"
          aria-label="Закрыть"
          title="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      {/* Progress bar */}
      {duration > 0 && (
        <div
          className="tabler-toast-progress"
          style={{
            backgroundColor: v.progressColor,
            animationDuration: `${duration}ms`,
          }}
        />
      )}
    </div>
  )
}
