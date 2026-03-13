import { cn } from '@/lib/utils'

type NeonCheckboxProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  ariaLabel?: string
  size?: number
}

export default function NeonCheckbox({
  checked,
  onChange,
  disabled = false,
  className,
  ariaLabel = 'checkbox',
  size = 18,
}: NeonCheckboxProps) {
  return (
    <label
      className={cn('checkbox', className)}
      style={
        disabled
          ? {
              opacity: 0.55,
              cursor: 'not-allowed',
            }
          : undefined
      }
      aria-label={ariaLabel}
    >
      <input
        className="checkbox-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <svg
        className="checkbox-check"
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </label>
  )
}

