import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Settings } from 'lucide-react'
import '../../styles/topActionButtons.css'

export default function OpenPanelSettingsButton({
  className,
  label = 'Настройки',
}: {
  className?: string
  label?: string
}) {
  const navigate = useNavigate()
  const location = useLocation()

  const onClick = useCallback(() => {
    // Already there: no-op.
    if (location.pathname === '/settings' || location.pathname.startsWith('/settings/')) return
    navigate('/settings')
  }, [location.pathname, navigate])

  return (
    <button
      type="button"
      className={cn('topActionBtn topActionBtn--text topActionBtn--settings', className)}
      onClick={onClick}
      aria-label="Настройки"
      title="Настройки"
    >
      <Settings className="topActionBtnIcon w-5 h-5" strokeWidth={2.5} />
      <span>{label}</span>
    </button>
  )
}

