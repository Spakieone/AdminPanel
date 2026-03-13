import { createPortal } from 'react-dom'
import UiverseToastCard from './UiverseToastCard'

export type ToastVariant = 'information' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  variant: ToastVariant
  title: string
  description: string
  duration?: number
}

interface ToastContainerProps {
  toasts: Toast[]
  onRemove: (id: string) => void
}

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  // SPA only, но оставляем guard на случай окружений без DOM
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed z-[60] pointer-events-none top-[86px] right-4 w-[380px] max-w-[calc(100vw-2rem)]"
    >
      <div className="space-y-2 flex flex-col items-end">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-full">
            <UiverseToastCard
              variant={toast.variant}
              title={toast.title}
              description={toast.description}
              duration={toast.duration ?? 4000}
              onClose={() => onRemove(toast.id)}
            />
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}

