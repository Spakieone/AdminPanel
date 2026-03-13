import Settings from './Settings'

export default function Panel() {
  // Unified panel settings page (no hub tiles; tabs are inside Settings).
  // This prevents UI "disappearing" when switching between sections.
  return <Settings />
}

