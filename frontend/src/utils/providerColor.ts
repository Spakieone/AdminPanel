export type ProviderStyle = { bg: string; color: string; dot: string }

// Returns black or white depending on background color luminance
// Accepts hex (#rrggbb), rgb(...), rgba(...), hsl(...)
export function getContrastColor(bg: string): string {
  // Try hex
  const hex = bg.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const r = parseInt(hex[1].slice(0,2),16)
    const g = parseInt(hex[1].slice(2,4),16)
    const b = parseInt(hex[1].slice(4,6),16)
    const lum = 0.299*r + 0.587*g + 0.114*b
    return lum > 160 ? '#000000' : '#ffffff'
  }
  // Try rgb/rgba
  const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgb) {
    const lum = 0.299*+rgb[1] + 0.587*+rgb[2] + 0.114*+rgb[3]
    return lum > 160 ? '#000000' : '#ffffff'
  }
  return '#ffffff'
}

// Known providers — exact match, curated colors
const EXACT: Record<string, ProviderStyle> = {
  yookassa:    { bg: 'rgba(168,85,247,0.15)',  color: 'rgb(192,132,252)', dot: 'rgb(168,85,247)' },
  kassai:      { bg: 'rgba(139,92,246,0.15)',  color: 'rgb(167,139,250)', dot: 'rgb(139,92,246)' },
  kassai_plus: { bg: 'rgba(109,40,217,0.15)',  color: 'rgb(196,181,253)', dot: 'rgb(109,40,217)' },
  overpay_sbp: { bg: 'rgba(34,197,94,0.15)',   color: 'rgb(74,222,128)',  dot: 'rgb(34,197,94)'  },
  admin:       { bg: 'rgba(14,165,233,0.15)',  color: 'rgb(56,189,248)',  dot: 'rgb(14,165,233)' },
  balance:     { bg: 'rgba(6,182,212,0.15)',   color: 'rgb(34,211,238)',  dot: 'rgb(6,182,212)'  },
  coupon:      { bg: 'rgba(236,72,153,0.15)',  color: 'rgb(244,114,182)', dot: 'rgb(236,72,153)' },
  referral:    { bg: 'rgba(251,146,60,0.15)',  color: 'rgb(253,186,116)', dot: 'rgb(249,115,22)' },
  stars:       { bg: 'rgba(234,179,8,0.15)',   color: 'rgb(250,204,21)',  dot: 'rgb(234,179,8)'  },
  stripe:      { bg: 'rgba(99,102,241,0.15)',  color: 'rgb(129,140,248)', dot: 'rgb(99,102,241)' },
  tinkoff:     { bg: 'rgba(234,179,8,0.15)',   color: 'rgb(250,204,21)',  dot: 'rgb(234,179,8)'  },
  sber:        { bg: 'rgba(34,197,94,0.15)',   color: 'rgb(74,222,128)',  dot: 'rgb(34,197,94)'  },
  sbp:         { bg: 'rgba(20,184,166,0.15)',  color: 'rgb(45,212,191)',  dot: 'rgb(20,184,166)' },
  qiwi:        { bg: 'rgba(249,115,22,0.15)',  color: 'rgb(251,146,60)',  dot: 'rgb(249,115,22)' },
  paypal:      { bg: 'rgba(59,130,246,0.15)',  color: 'rgb(96,165,250)',  dot: 'rgb(59,130,246)' },
  crypto:      { bg: 'rgba(245,158,11,0.15)',  color: 'rgb(251,191,36)',  dot: 'rgb(245,158,11)' },
  free:        { bg: 'rgba(20,184,166,0.15)',  color: 'rgb(45,212,191)',  dot: 'rgb(20,184,166)' },
  trial:       { bg: 'rgba(20,184,166,0.15)',  color: 'rgb(45,212,191)',  dot: 'rgb(20,184,166)' },
  manual:      { bg: 'rgba(14,165,233,0.15)',  color: 'rgb(56,189,248)',  dot: 'rgb(14,165,233)' },
}

// Stable 32-bit hash of a string
function strHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h
}

// Generate a unique HSL-based color from any string.
// Hue spread: skip ~30° bands around pure red (sickness) and yellow-green (clash).
// Saturation/lightness kept vivid but readable.
function hashToStyle(name: string): ProviderStyle {
  const h = strHash(name)
  // Map hash to hue, skipping muddy 60-80° band
  const raw = (h & 0xFFFF) / 0xFFFF  // 0..1
  // Spread across 300° (skip red 350-60 band for visual clarity) — golden ratio spacing
  const hue = Math.round((raw * 360 + 137.5) % 360)
  const s = 70 + (h >> 24 & 0xF)          // 70-85%
  const lDot = 52 + (h >> 20 & 0x7)        // 52-59% — dot
  const lText = 72 + (h >> 16 & 0x7)       // 72-79% — text
  const dot  = `hsl(${hue}, ${s}%, ${lDot}%)`
  const color = `hsl(${hue}, ${s}%, ${lText}%)`
  const bg    = `hsla(${hue}, ${s}%, ${lDot}%, 0.15)`
  return { bg, color, dot }
}

export function getProviderColor(provider: string): ProviderStyle {
  const p = provider.toLowerCase().trim()

  // 1. Exact match
  if (EXACT[p]) return EXACT[p]

  // 2. Substring match — longest key first to avoid short keys stealing matches
  const keys = Object.keys(EXACT).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (p.includes(key)) return EXACT[key]
  }

  // 3. Infinite unique colors — derived from the provider name itself
  return hashToStyle(p)
}
