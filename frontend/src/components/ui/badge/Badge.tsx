type BadgeColor = 'success' | 'error' | 'info' | 'warning'

const colorMap: Record<BadgeColor, string> = {
  success: 'bg-emerald-500/15 text-emerald-400',
  error:   'bg-red-500/15 text-red-400',
  info:    'bg-sky-500/15 text-sky-400',
  warning: 'bg-amber-500/15 text-amber-400',
}

export default function Badge({ color = 'info', children }: { color?: BadgeColor; children?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[color] ?? colorMap.info}`}>
      {children}
    </span>
  )
}
