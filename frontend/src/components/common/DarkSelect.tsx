import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type DarkSelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

export type DarkSelectGroup = {
  groupLabel?: string
  options: DarkSelectOption[]
}

type MenuPosition =
  | { direction: 'down'; top: number; left: number; width: number }
  | { direction: 'up'; bottom: number; left: number; width: number }

export default function DarkSelect({
  value,
  onChange,
  groups,
  disabled,
  buttonClassName = '',
  buttonStyle,
  menuClassName = '',
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  groups: DarkSelectGroup[]
  disabled?: boolean
  buttonClassName?: string
  buttonStyle?: React.CSSProperties
  menuClassName?: string
  placeholder?: string
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPosition | null>(null)

  const flatOptions = useMemo(() => groups.flatMap((g) => g.options), [groups])
  const selected = useMemo(() => flatOptions.find((o) => o.value === value), [flatOptions, value])

  const computePosition = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const gap = 6
    const spaceBelow = window.innerHeight - r.bottom
    const spaceAbove = r.top
    const shouldOpenUp = spaceBelow < 240 && spaceAbove > spaceBelow
    const left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8))
    const width = Math.max(160, r.width)
    if (shouldOpenUp) {
      setPos({ direction: 'up', bottom: Math.max(8, window.innerHeight - r.top + gap), left, width })
    } else {
      setPos({ direction: 'down', top: Math.min(window.innerHeight - 8, r.bottom + gap), left, width })
    }
  }, [])

  // Open/close helpers
  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const toggle = useCallback(() => {
    if (disabled) return
    setOpen((v) => !v)
  }, [disabled])

  // Keep menu positioned and close on outside click / ESC.
  useEffect(() => {
    if (!open) return
    computePosition()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t) return
      const root = rootRef.current
      const menu = menuRef.current
      if (root && root.contains(t)) return
      if (menu && menu.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onReposition = () => computePosition()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    // capture scroll from any ancestor (including overflow containers)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [close, computePosition, open])

  // When opening, ensure we have a position.
  useEffect(() => {
    if (!open) return
    computePosition()
  }, [computePosition, open])

  const currentLabel = selected?.label ?? placeholder ?? ''

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onPointerDown={(e) => {
          // Prevent focus loss + allow fast toggles
          e.preventDefault()
          toggle()
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-darkselect-btn=""
        className={[
          'relative flex w-full items-center justify-between gap-3',
          'text-left',
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
          buttonClassName,
        ].join(' ')}
        style={buttonStyle}
      >
        <span className="min-w-0 flex-1 truncate">{currentLabel}</span>
        <svg
          className={['h-4 w-4 flex-shrink-0 transition-transform duration-200', open ? 'rotate-180' : ''].join(' ')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              className={[
                'dark-select-menu',
                'fixed z-[200000] rounded-xl border border-default',
                'bg-[var(--bg-surface-hover)] shadow-2xl',
                'backdrop-blur-xl',
                'overflow-hidden',
                'text-left',
                menuClassName,
              ].join(' ')}
              style={
                pos.direction === 'down'
                  ? { top: pos.top, left: pos.left, width: pos.width }
                  : { bottom: pos.bottom, left: pos.left, width: pos.width }
              }
              role="listbox"
              aria-label="Выбор"
            >
              <div className="dark-select-scroll max-h-[320px] overflow-auto py-1">
                {groups.map((g, gi) => {
                  if (!g.options || g.options.length === 0) return null
                  return (
                    <div key={`${g.groupLabel || 'group'}-${gi}`} className="py-0.5">
                      {!!String(g.groupLabel || '').trim() && (
                        <div className="px-3 py-1 text-[12px] font-semibold text-muted uppercase tracking-wide">
                          {g.groupLabel}
                        </div>
                      )}
                      {g.options.map((opt) => {
                        const isActive = opt.value === value
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            disabled={opt.disabled}
                            onClick={() => {
                              if (opt.disabled) return
                              onChange(opt.value)
                              close()
                            }}
                            className={[
                              'w-full px-3 py-2 text-sm',
                              'flex items-center justify-between gap-3',
                              'text-left',
                              'border-l-2 border-l-transparent',
                              'transition-colors duration-150',
                              opt.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                              isActive
                                ? 'bg-accent-10 text-primary border-l-[var(--accent)]/70'
                                : 'text-secondary hover:text-primary hover:border-l-[var(--accent)]/50 hover:bg-overlay-md',
                            ].join(' ')}
                            title={typeof opt.label === 'string' ? opt.label : undefined}
                          >
                            <span className="min-w-0 flex-1 truncate text-left">{opt.label}</span>
                            {isActive && (
                              <svg className="h-4 w-4 flex-shrink-0 text-[var(--accent)]" viewBox="0 0 20 20" fill="currentColor">
                                <path
                                  fillRule="evenodd"
                                  d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.415.005L3.296 9.228a1 1 0 011.408-1.42l3.037 3.01 6.543-6.528a1 1 0 011.42 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

