import { useEffect } from 'react'
import { createPortal } from 'react-dom'

type ModalShellSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'
type ModalShellTone = 'default' | 'neutral'
type ModalShellCloseTone = 'default' | 'danger'

export const modalPrimaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-[13px] sm:text-sm font-semibold leading-snug ' +
  'whitespace-normal sm:whitespace-nowrap text-center min-w-0 max-w-full ' +
  'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 ' +
  'border border-emerald-500/30 hover:border-emerald-500/50 ' +
  'shadow-sm shadow-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto'

export const modalSecondaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-[13px] sm:text-sm font-semibold leading-snug ' +
  'whitespace-normal sm:whitespace-nowrap text-center min-w-0 max-w-full ' +
  'bg-overlay-sm hover:bg-overlay-md text-primary border border-default ' +
  'disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto'

export const modalDangerButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-[13px] sm:text-sm font-semibold leading-snug ' +
  'whitespace-normal sm:whitespace-nowrap text-center min-w-0 max-w-full ' +
  'bg-red-600 hover:bg-red-700 text-primary shadow-sm shadow-red-500/20 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto'

type ModalShellProps = {
  isOpen?: boolean
  /** Render inline (no portal/backdrop). Helps avoid nested modal stacks. */
  inline?: boolean
  /** Inline styling mode. `transparent` is for embedding inside an existing section. */
  inlineVariant?: 'panel' | 'transparent'
  /** Visual tone for the shell background. */
  shellTone?: ModalShellTone
  title: string
  subtitle?: string
  icon?: React.ReactNode
  headerActions?: React.ReactNode
  banner?: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
  closeOnBackdropClick?: boolean
  closeOnEsc?: boolean
  /** Make close button more visible. */
  closeButtonTone?: ModalShellCloseTone
  size?: ModalShellSize
  zIndexClassName?: string
  children: React.ReactNode
}

function sizeToClass(size: ModalShellSize) {
  switch (size) {
    case 'sm':
      return 'sm:max-w-md'
    case 'md':
      // Было слишком широко: делаем модалки чуть уже по умолчанию
      return 'sm:max-w-2xl'
    case 'lg':
      return 'sm:max-w-3xl'
    case 'xl':
      return 'sm:max-w-5xl'
    case 'full':
      return 'sm:max-w-[1600px]'
    default:
      return 'sm:max-w-2xl'
  }
}

export default function ModalShell({
  isOpen = true,
  inline = false,
  inlineVariant = 'panel',
  shellTone = 'default',
  title,
  subtitle,
  icon,
  headerActions,
  banner,
  footer,
  onClose,
  closeOnBackdropClick = false,
  closeOnEsc = false,
  closeButtonTone = 'default',
  size = 'md',
  zIndexClassName = 'z-[100000]',
  children,
}: ModalShellProps) {
  useEffect(() => {
    if (!isOpen) return
    if (inline) return
    const prevBodyOverflow = document.body.style.overflow
    const prevBodyOverflowX = document.body.style.overflowX
    const prevHtmlOverflow = document.documentElement.style.overflow
    const prevHtmlOverflowX = document.documentElement.style.overflowX
    document.body.style.overflow = 'hidden'
    document.body.style.overflowX = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.documentElement.style.overflowX = 'hidden'
    return () => {
      document.body.style.overflow = prevBodyOverflow
      document.body.style.overflowX = prevBodyOverflowX
      document.documentElement.style.overflow = prevHtmlOverflow
      document.documentElement.style.overflowX = prevHtmlOverflowX
    }
  }, [isOpen, inline])

  useEffect(() => {
    if (!isOpen) return
    if (inline) return
    if (!closeOnEsc) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, inline, closeOnEsc, onClose])

  if (!isOpen) return null

  const shell = (
    <div
      className={`tm-modal-shell ${shellTone === 'neutral' ? 'tm-modal-shell--neutral' : ''} w-full ${sizeToClass(size)} bg-surface border border-default shadow-2xl sm:rounded-2xl overflow-hidden flex flex-col ${
        inline ? (inlineVariant === 'transparent' ? 'tm-modal-inline-transparent' : 'tm-modal-inline-panel') : 'modal-content'
      }`}
      style={{
        maxHeight: inline ? undefined : '100dvh',
        boxShadow: inline ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.2)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
        {/* Header */}
        <div
          className="px-3 sm:px-6 pb-4 border-b border-subtle bg-surface sticky top-0 z-10"
          style={{ paddingTop: 'calc(var(--safe-top, 0px) + 16px)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              {icon ? (
                <div className="w-10 h-10 rounded-lg bg-overlay-sm border border-default flex items-center justify-center flex-shrink-0">
                  {icon}
                </div>
              ) : null}
              <div className="min-w-0">
                <div className="text-primary text-lg sm:text-xl font-bold truncate">{title}</div>
                {subtitle ? <div className="text-muted text-xs sm:text-sm mt-0.5">{subtitle}</div> : null}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {headerActions}
              <button
                onClick={onClose}
                className={
                  closeButtonTone === 'danger'
                    ? 'text-red-300 hover:text-red-200 transition-colors p-2 rounded-lg bg-red-500/10 hover:bg-red-500/18 border border-red-500/20'
                    : 'text-muted hover:text-secondary transition-colors p-2 hover:bg-overlay-sm rounded-lg'
                }
                aria-label="Закрыть"
                title="Закрыть"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {banner ? <div className="mt-3">{banner}</div> : null}
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{
            overscrollBehavior: 'contain' as any,
            WebkitOverflowScrolling: 'touch' as any,
            touchAction: 'pan-y',
          }}
        >
          <div className="px-3 sm:px-6 py-5">{children}</div>
        </div>

        {/* Footer */}
        {footer ? (
          <div
            className="px-3 sm:px-6 pt-4 border-t border-subtle bg-surface sticky bottom-0"
            style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)' }}
          >
            {footer}
          </div>
        ) : null}
    </div>
  )

  if (inline) return shell

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClassName} bg-black/50 backdrop-blur-[3px] flex items-stretch sm:items-center justify-center p-0 sm:p-4 overflow-x-hidden modal-backdrop`}
      onClick={closeOnBackdropClick ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {shell}
    </div>,
    document.body,
  )
}


