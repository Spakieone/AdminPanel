import * as React from 'react'

type AlertVariant = 'information' | 'success' | 'warning' | 'error'

interface GradientAlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: AlertVariant
  title: string
  description: string | React.ReactNode
  onClose?: () => void
}

// Иконки как SVG компоненты
const InfoIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const CheckCircleIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const AlertTriangleIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
)

const XCircleIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const XIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const ICONS = {
  information: <InfoIcon className="h-5 w-5" />,
  success: <CheckCircleIcon className="h-5 w-5" />,
  warning: <AlertTriangleIcon className="h-5 w-5" />,
  error: <XCircleIcon className="h-5 w-5" />,
}

// Утилита для объединения классов
function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

// Стили для вариантов
const alertStyles: Record<AlertVariant, string> = {
  information: 'border-blue-900/60 bg-blue-500/[0.06]',
  success: 'border-green-900/60 bg-green-500/[0.06]',
  warning: 'border-yellow-900/60 bg-yellow-500/[0.06]',
  error: 'border-red-900/60 bg-red-500/[0.06]',
}

const iconContainerStyles: Record<AlertVariant, string> = {
  information: 'bg-blue-500/20 text-blue-400',
  success: 'bg-green-500/20 text-green-400',
  warning: 'bg-yellow-500/20 text-yellow-400',
  error: 'bg-red-500/20 text-red-400',
}

const gradientColors: Record<AlertVariant, string> = {
  information: 'rgba(59, 130, 246, 0.15)',
  success: 'rgba(34, 197, 94, 0.15)',
  warning: 'rgba(234, 179, 8, 0.15)',
  error: 'rgba(239, 68, 68, 0.15)',
}

export const GradientAlert = React.forwardRef<HTMLDivElement, GradientAlertProps>(
  ({ className, variant, title, description, onClose, ...props }, ref) => {
    if (!variant) return null

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          'relative w-full rounded-lg border p-4 pl-12 shadow-sm transition-all overflow-hidden',
          alertStyles[variant],
          className
        )}
        {...props}
      >
        {/* Subtle gradient glow */}
        <div
          className="absolute left-0 top-0 h-full w-full opacity-20 pointer-events-none"
          style={{
            background: `radial-gradient(circle at 40px 40px, ${gradientColors[variant]} 0%, transparent 40%)`
          }}
          aria-hidden="true"
        />

        {/* Icon container */}
        <div className={cn('absolute left-0 top-0 h-full w-10 flex items-center justify-center', iconContainerStyles[variant])}>
          {ICONS[variant]}
        </div>

        {/* Text Content */}
        <div className="flex-grow">
          <h5 className="font-medium text-primary mb-1">{title}</h5>
          {typeof description === 'string' ? (
            <p className="text-sm text-muted">{description}</p>
          ) : (
            <div className="text-sm text-muted">{description}</div>
          )}
        </div>

        {/* Close Button */}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="absolute right-3 top-3 p-1 rounded-full text-muted/50 transition-colors hover:text-dim hover:bg-overlay-xs"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }
)

GradientAlert.displayName = 'GradientAlert'

