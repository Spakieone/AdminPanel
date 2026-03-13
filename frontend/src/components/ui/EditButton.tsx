import { cn } from '@/lib/utils'

type EditButtonProps = {
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  className?: string
  containerClassName?: string
  title?: string
  ariaLabel?: string
  // kept for compatibility with previous calls
  size?: 'sm' | 'md'
  variant?: 'big' | 'small' | 'responsive'
}

export default function EditButton({
  onClick,
  disabled,
  className,
  containerClassName,
  title = 'Редактировать',
  ariaLabel = 'Редактировать',
  variant = 'responsive',
  size = 'md',
}: EditButtonProps) {
  const btnClass = cn('btn-edit', size === 'sm' && 'btn-edit-sm', className)
  const iconOnly = cn('btn-edit btn-edit-icon', size === 'sm' && 'btn-edit-sm', className)

  const FullBtn = (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} className={btnClass}>
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
      <span>Редактировать</span>
    </button>
  )

  const IconBtn = (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} className={iconOnly}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
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

