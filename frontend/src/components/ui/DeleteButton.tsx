import { cn } from '@/lib/utils'

type DeleteButtonProps = {
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  className?: string
  containerClassName?: string
  title?: string
  ariaLabel?: string
  // kept for compatibility with previous calls
  size?: 'sm' | 'md'
  label?: string
  variant?: 'big' | 'small' | 'responsive'
}

export default function DeleteButton({
  onClick,
  disabled,
  className,
  containerClassName,
  title = 'Удалить',
  ariaLabel = 'Удалить',
  label = 'Удалить',
  variant = 'responsive',
  size = 'md',
}: DeleteButtonProps) {
  const base = cn('btn-delete', size === 'sm' && 'btn-delete-sm', className)
  const iconOnly = cn('btn-delete btn-delete-icon', className)

  const FullBtn = (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} className={base}>
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      <span>{label}</span>
    </button>
  )

  const IconBtn = (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} className={iconOnly}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  )

  return (
    <div className={cn('flex items-center', containerClassName)}>
      {variant === 'big' ? (
        FullBtn
      ) : variant === 'small' ? (
        IconBtn
      ) : (
        <>
          <div className="hidden md:block">{FullBtn}</div>
          <div className="md:hidden">{IconBtn}</div>
        </>
      )}
    </div>
  )
}

