import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '../../context/ThemeContext'

const ACCENT_COLORS = [
  { id: 'red',    hex: '#ef4444', label: 'Красный' },
  { id: 'blue',   hex: '#3b82f6', label: 'Синий' },
  { id: 'amber',  hex: '#f59e0b', label: 'Жёлтый' },
  { id: 'green',  hex: '#22c55e', label: 'Зелёный' },
  { id: 'cyan',   hex: '#06b6d4', label: 'Голубой' },
] as const

type AccentId = typeof ACCENT_COLORS[number]['id']

function getStoredAccent(): AccentId {
  try {
    return (localStorage.getItem('panel_accent_color') as AccentId) || 'blue'
  } catch {
    return 'blue'
  }
}

function applyAccent(id: AccentId) {
  document.documentElement.setAttribute('data-accent', id)
  try { localStorage.setItem('panel_accent_color', id) } catch {}
}

interface Props {
  onClose: () => void
  anchorRect?: DOMRect | null
}

export default function ThemeSettingsPanel({ onClose, anchorRect }: Props) {
  const [accent, setAccent] = useState<AccentId>(getStoredAccent)
  const panelRef = useRef<HTMLDivElement>(null)
  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!panelRef.current) return
      if (panelRef.current.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [onClose])

  const selectAccent = (id: AccentId) => {
    setAccent(id)
    applyAccent(id)
  }

  // Position: below anchor button, right-aligned
  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 8,
        right: window.innerWidth - anchorRect.right,
        zIndex: 100000,
      }
    : {
        position: 'fixed',
        top: 80,
        right: 16,
        zIndex: 100000,
      }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99999]" onClick={onClose} />
      <div
        ref={panelRef}
        style={{ ...style, zIndex: 100000 }}
        className="w-72 rounded-2xl border border-default bg-surface shadow-theme-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
          <span className="text-sm font-semibold text-primary">Настройки темы</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-faint hover:text-secondary hover:bg-overlay-md transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Theme toggle */}
        <div className="px-4 pt-4 pb-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">Тема</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { if (theme !== 'light') toggleTheme() }}
              className={`flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-medium transition-all duration-150 ${
                theme === 'light'
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-subtle bg-overlay-xs text-muted hover:text-secondary hover:bg-overlay-sm'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 100 10A5 5 0 0012 7z" />
              </svg>
              Светлая
            </button>
            <button
              type="button"
              onClick={() => { if (theme !== 'dark') toggleTheme() }}
              className={`flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-medium transition-all duration-150 ${
                theme === 'dark'
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-subtle bg-overlay-xs text-muted hover:text-secondary hover:bg-overlay-sm'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
              Тёмная
            </button>
          </div>
        </div>

        {/* Accent color */}
        <div className="px-4 py-4">
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">Акцентный цвет</p>
          <div className="grid grid-cols-5 gap-2">
            {ACCENT_COLORS.map((c) => {
              const active = accent === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectAccent(c.id)}
                  title={c.label}
                  className="relative flex items-center justify-center w-10 h-10 rounded-xl border-2 transition-all duration-150"
                  style={{
                    backgroundColor: c.hex + '20',
                    borderColor: active ? c.hex : 'transparent',
                    boxShadow: active ? `0 0 0 1px ${c.hex}40` : 'none',
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-full"
                    style={{ backgroundColor: c.hex }}
                  />
                  {active && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {/* Current color preview */}
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-overlay-xs border border-subtle">
            <span
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: ACCENT_COLORS.find(c => c.id === accent)?.hex }}
            />
            <span className="text-sm text-dim">{ACCENT_COLORS.find(c => c.id === accent)?.label}</span>
            <span className="ml-auto text-xs text-faint font-mono">
              {ACCENT_COLORS.find(c => c.id === accent)?.hex}
            </span>
          </div>
        </div>

        {/* Reset */}
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => selectAccent('blue')}
            className="w-full py-2 text-xs font-medium text-faint hover:text-dim border border-subtle rounded-lg hover:bg-overlay-sm transition-colors"
          >
            Сбросить по умолчанию
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

// Hook for easy use
export function useThemeSettings() {
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  const toggle = (e: React.MouseEvent<HTMLElement>) => {
    setAnchorRect(e.currentTarget.getBoundingClientRect())
    setOpen(v => !v)
  }

  return { open, anchorRect, toggle, close: () => setOpen(false) }
}
