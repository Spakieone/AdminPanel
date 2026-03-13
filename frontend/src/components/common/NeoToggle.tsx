import { useId, useMemo, useState } from 'react'
import '../../styles/neoToggle.css'

function rgbaFromHex(hexOrRgb: string, alpha: number): string | null {
  const s = String(hexOrRgb || '').trim()
  if (!s) return null
  if (!s.startsWith('#')) return null
  let h = s.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6) return null
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  if (![r, g, b].every((n) => Number.isFinite(n))) return null
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default function NeoToggle({
  checked,
  onChange,
  disabled,
  width = 80,
  height = 38,
  showStatus = true,
  statusOn = 'Включен',
  statusOff = 'Выключен',
  onColor,
  offColor,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  width?: number
  height?: number
  showStatus?: boolean
  statusOn?: string
  statusOff?: string
  onColor?: string
  offColor?: string
}) {
  const id = useId()
  const [activated, setActivated] = useState(false)

  const style = useMemo(() => {
    const h = Number(height)
    // For small toggles reduce internal paddings so thumb stays proportional
    const thumbOffset = h <= 30 ? 3 : 4
    const thumbCoreInset = h <= 30 ? 4 : 5
    const st: React.CSSProperties = {
      ['--toggle-width' as any]: `${width}px`,
      ['--toggle-height' as any]: `${height}px`,
      ['--thumb-offset' as any]: `${thumbOffset}px`,
      ['--thumb-core-inset' as any]: `${thumbCoreInset}px`,
    }

    if (onColor) {
      ;(st as any)['--toggle-on-color'] = String(onColor)
      const border = rgbaFromHex(onColor, 0.3)
      const shadow = rgbaFromHex(onColor, 0.5)
      const highlight = rgbaFromHex(onColor, 0.2)
      if (border) (st as any)['--toggle-on-border'] = border
      if (shadow) (st as any)['--toggle-on-shadow'] = shadow
      if (highlight) (st as any)['--toggle-on-highlight'] = highlight
    }
    if (offColor) {
      ;(st as any)['--toggle-off-color'] = String(offColor)
    }
    return st
  }, [height, offColor, onColor, width])

  return (
    <div className={`neo-toggle-container ${checked ? 'is-on' : 'is-off'} ${disabled ? 'is-disabled' : ''}`} style={style}>
      <input
        id={id}
        className="neo-toggle-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.checked
          onChange(next)
        }}
      />
      <label
        htmlFor={id}
        className={`neo-toggle ${activated ? 'neo-activated' : ''}`}
        onClick={() => {
          if (disabled) return
          setActivated(true)
          window.setTimeout(() => setActivated(false), 650)
        }}
        aria-label={checked ? 'Включено' : 'Выключено'}
      >
        <div className="neo-track">
          <div className="neo-background-layer" />
          <div className="neo-grid-layer" />
          <div className="neo-track-highlight" />
          <div className="neo-spectrum-analyzer" aria-hidden="true">
            <div className="neo-spectrum-bar" />
            <div className="neo-spectrum-bar" />
            <div className="neo-spectrum-bar" />
            <div className="neo-spectrum-bar" />
            <div className="neo-spectrum-bar" />
          </div>
        </div>

        <div className="neo-thumb">
          <div className="neo-thumb-ring" />
          <div className="neo-thumb-core">
            <div className="neo-thumb-icon" aria-hidden="true">
              <div className="neo-thumb-wave" />
              <div className="neo-thumb-pulse" />
            </div>
          </div>
        </div>

        <div className="neo-interaction-feedback" aria-hidden="true">
          <div className="neo-ripple" />
          <div className="neo-progress-arc" />
        </div>
        <div className="neo-gesture-area" aria-hidden="true" />
      </label>

      {showStatus && (
        <div className="neo-status" aria-hidden="true">
          <div className="neo-status-indicator">
            <div
              className="neo-status-dot"
              style={{
                backgroundColor: checked ? (onColor ?? '#22c55e') : (offColor ?? '#ef4444'),
                boxShadow: checked ? `0 0 8px ${onColor ?? '#22c55e'}` : 'none',
              }}
            />
            <div
              className="neo-status-text"
              style={{ color: checked ? (onColor ?? '#22c55e') : (offColor ?? '#ef4444') }}
            >{checked ? statusOn : statusOff}</div>
          </div>
        </div>
      )}
    </div>
  )
}


