import ModalShell, { modalDangerButtonClass, modalSecondaryButtonClass } from './ModalShell'

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  cancelText?: string
  confirmButtonClass?: string
  zIndexClassName?: string
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Да',
  cancelText = 'Нет',
  confirmButtonClass,
  zIndexClassName,
}: ConfirmModalProps) {
  if (!isOpen) return null

  const confirmClass = confirmButtonClass ? `${modalDangerButtonClass} ${confirmButtonClass}` : modalDangerButtonClass

  return (
    <ModalShell
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      closeOnBackdropClick={false}
      closeOnEsc={false}
      closeButtonTone="danger"
      shellTone="neutral"
      size="sm"
      zIndexClassName={zIndexClassName}
      icon={
        <svg className="w-5 h-5 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      }
      footer={
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onCancel} className={modalSecondaryButtonClass}>
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm} className={confirmClass}>
            {confirmText}
          </button>
        </div>
      }
    >
      <div className="text-primary text-sm sm:text-base leading-relaxed">{message}</div>
    </ModalShell>
  )
}

