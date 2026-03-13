import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { getBotProfiles, setActiveBotProfile, getMonitoringSettings, getMonitoringState, getRemnawaveProfiles, getRemnawaveNodes } from '../api/client'
import { clearBotConfigCache } from '../utils/botConfig'
// (no bot module/systemd calls from header statuses)
import { Activity } from 'lucide-react'
import SystemMonitorWidget from './common/SystemMonitorWidget'

type Status = 'online' | 'offline' | 'warning' | 'disabled'

interface StatusIndicatorProps {
  label: string
  status: Status
  details?: string
  lastCheck?: Date
  isChecking?: boolean
  ping?: number | null
}

const StatusIndicator = memo(function StatusIndicator({ label, status, details, lastCheck, isChecking, ping }: StatusIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const canHover = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true
    // On touch devices browsers often emulate hover on tap -> causes accidental popovers.
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches
  }, [])
  
  const statusColor = useMemo(() => {
    switch (status) {
      case 'online':
        return 'bg-green-500'
      case 'warning':
        return 'bg-orange-500'
      case 'offline':
        return 'bg-red-500'
      case 'disabled':
        return 'bg-white/30'
      default:
        return 'bg-white/30'
    }
  }, [status])

  const statusText = useMemo(() => {
    if (isChecking) return 'Проверка…'
    if (status === 'disabled') return 'Отключено'
    if (status === 'online') {
      return 'Работает'
    }
    switch (status) {
      case 'warning':
        return 'Предупреждение'
      case 'offline':
        return 'Не работает'
      default:
        return 'Неизвестно'
    }
  }, [status, isChecking])
  
  const statusTextColor = useMemo(() => {
    switch (status) {
      case 'online':
        return 'text-green-400'
      case 'warning':
        return 'text-orange-400'
      case 'disabled':
        return 'text-dim'
      default:
        return 'text-red-400'
    }
  }, [status])

  const checkingTextColor = 'text-sky-300/90'
  
  const handleMouseEnter = useCallback(() => setShowTooltip(true), [])
  const handleMouseLeave = useCallback(() => setShowTooltip(false), [])

  // Вычисляем позицию для tooltip
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (showTooltip && containerRef.current) {
      const updateTooltipPosition = () => {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          
          const estimatedTooltipWidth = 250
          const estimatedTooltipHeight = 120
          
          let top = rect.bottom + 8
          let left = rect.left
          
          if (left + estimatedTooltipWidth > viewportWidth) {
            left = viewportWidth - estimatedTooltipWidth - 16
          }
          if (left < 16) {
            left = 16
          }
          if (top + estimatedTooltipHeight > viewportHeight) {
            top = rect.top - estimatedTooltipHeight - 8
          }
          if (top < 16) {
            top = rect.bottom + 8
          }
          
          setTooltipStyle({
            position: 'fixed',
            top: `${top}px`,
            left: `${left}px`,
            zIndex: 99999,
            pointerEvents: 'auto',
            transform: 'translateZ(0)',
            willChange: 'transform'
          })
          
          if (tooltipRef.current) {
            requestAnimationFrame(() => {
              if (tooltipRef.current && containerRef.current) {
                const tooltipRect = tooltipRef.current.getBoundingClientRect()
                const containerRect = containerRef.current.getBoundingClientRect()
                
                let finalTop = containerRect.bottom + 8
                let finalLeft = containerRect.left
                
                if (finalLeft + tooltipRect.width > viewportWidth) {
                  finalLeft = viewportWidth - tooltipRect.width - 16
                }
                if (finalLeft < 16) {
                  finalLeft = 16
                }
                if (finalTop + tooltipRect.height > viewportHeight) {
                  finalTop = containerRect.top - tooltipRect.height - 8
                }
                if (finalTop < 16) {
                  finalTop = containerRect.bottom + 8
                }
                
                setTooltipStyle(prev => ({
                  ...prev,
                  top: `${finalTop}px`,
                  left: `${finalLeft}px`
                }))
              }
            })
          }
        }
      }
      
      updateTooltipPosition()
      window.addEventListener('scroll', updateTooltipPosition, true)
      window.addEventListener('resize', updateTooltipPosition)
      
      return () => {
        window.removeEventListener('scroll', updateTooltipPosition, true)
        window.removeEventListener('resize', updateTooltipPosition)
      }
    }
  }, [showTooltip])

  // Touch: close tooltip on outside tap
  useEffect(() => {
    if (!showTooltip) return
    if (canHover) return
    const onDown = (e: Event) => {
      const t = (e as any).target as Node | null
      if (!t) return
      if (containerRef.current?.contains(t)) return
      if (tooltipRef.current?.contains(t)) return
      setShowTooltip(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [showTooltip, canHover])

  // On touch devices show tooltip on tap (we toggle showTooltip via onClick).
  const tooltipContent = showTooltip ? (
    <div 
      ref={tooltipRef}
      className="pointer-events-auto"
      style={{
        ...tooltipStyle,
        isolation: 'isolate'
      }}
      onMouseEnter={canHover ? () => setShowTooltip(true) : undefined}
      onMouseLeave={canHover ? () => setShowTooltip(false) : undefined}
    >
      <div
        className="bg-[var(--bg-surface-hover)] border border-default rounded-lg p-4 shadow-xl w-[min(360px,calc(100vw-2rem))] relative"
        style={{ isolation: 'isolate', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)' }}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-base font-semibold text-primary">{label}</span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Статус:</span>
            <span className={`font-medium ${statusTextColor}`}>
              {status === 'disabled' ? 'Отключено' : status === 'online' ? 'Работает' : status === 'warning' ? 'Предупреждение' : 'Не работает'}
            </span>
          </div>
          {isChecking && (
            <div className="pt-1 border-t border-default">
              <span className={`text-sm ${checkingTextColor}`}>Проверка…</span>
            </div>
          )}
          {ping !== null && ping !== undefined && (
            <div className="flex justify-between pt-1 border-t border-default">
              <span className="text-muted">Пинг:</span>
              <span className="text-primary font-mono">{ping} ms</span>
            </div>
          )}
          {details && (
            <div className="pt-1 border-t border-default">
              <span className="text-primary">{details}</span>
            </div>
          )}
          {lastCheck && (
            <div className="flex justify-between pt-1 border-t border-default">
              <span className="text-muted">Проверено:</span>
              <span className="text-primary">
                {lastCheck.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          )}
        </div>
        <div className="absolute bottom-full left-4 -mb-1 pointer-events-none">
          <div className="w-2 h-2 bg-[var(--bg-surface-hover)] border-l border-t border-default transform rotate-45"></div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <div 
        ref={containerRef}
        className="status-indicator-container relative flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-overlay-sm rounded-lg border border-default hover:bg-overlay-md transition-colors duration-200 whitespace-nowrap w-auto cursor-pointer"
        onMouseEnter={canHover ? handleMouseEnter : undefined}
        onMouseLeave={canHover ? handleMouseLeave : undefined}
        onClick={() => {
          if (!canHover) setShowTooltip((v) => !v)
        }}
      >
      <div className="relative flex-shrink-0 will-change-transform">
        <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${statusColor} ${
          status === 'online' ? 'animate-pulse' : 
          status === 'warning' ? 'animate-pulse' : 
          ''
        }`} style={{ willChange: 'opacity' }} />
        {status === 'online' && (
          <div className={`absolute inset-0 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${statusColor} animate-ping opacity-75`} style={{ willChange: 'transform, opacity' }} />
        )}
        {status === 'warning' && (
          <div className={`absolute inset-0 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${statusColor} animate-ping opacity-50`} style={{ animationDuration: '2s', willChange: 'transform, opacity' }} />
        )}
      </div>
      <div className="flex flex-col min-w-0 flex-1 hidden sm:flex">
        <span className="text-xs font-medium text-primary truncate">{label}</span>
        <span className={`text-xs w-[100px] ${isChecking ? checkingTextColor : statusTextColor}`}>
          {statusText}
        </span>
      </div>
      <div className="sm:hidden">
        <span className="text-[10px] font-medium text-primary truncate">{label}</span>
      </div>
      
      </div>
      {typeof document !== 'undefined' && tooltipContent && createPortal(tooltipContent, document.body)}
    </>
  )
})

interface BotProfile {
  id: string
  name: string
  adminId: string
}

export default function StatusIndicators() {
  const [botStatus, setBotStatus] = useState<Status>('offline')
  const [remnawaveStatus, setRemnawaveStatus] = useState<Status>('offline')
  const [nodesStatus, setNodesStatus] = useState<Status>('offline')
  
  const [botDetails, setBotDetails] = useState<string>('')
  const [remnawaveDetails, setRemnawaveDetails] = useState<string>('')
  const [nodesDetails, setNodesDetails] = useState<string>('')
  
  const [botPing, setBotPing] = useState<number | null>(null)
  const [remnawavePing, setRemnawavePing] = useState<number | null>(null)
  
  const [lastCheck, setLastCheck] = useState<Date | undefined>()
  
  // Предыдущие статусы для отслеживания изменений
  const prevBotStatusRef = useRef<Status | null>(null)
  const prevRemnawaveStatusRef = useRef<Status | null>(null)
  const prevNodesStatusRef = useRef<Status | null>(null)
  const isInitializedRef = useRef<boolean>(false)

  // Track previous statuses per profile (so we can notify even when the profile is not active)
  const prevBotByProfileRef = useRef<Record<string, Status>>({})
  const prevRemByProfileRef = useRef<Record<string, Status>>({})
  const prevNodesByProfileRef = useRef<Record<string, Status>>({})
  
  const [botProfiles, setBotProfiles] = useState<BotProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [showProfileSelector, setShowProfileSelector] = useState(false)
  const profileButtonRef = useRef<HTMLButtonElement | null>(null)
  const [profileDropdownStyle, setProfileDropdownStyle] = useState<React.CSSProperties>({})
  const [profilesLoaded, setProfilesLoaded] = useState<boolean>(false)
  const [remnawaveProfiles, setRemnawaveProfiles] = useState<any[]>([])
  const [remnawaveProfilesLoaded, setRemnawaveProfilesLoaded] = useState<boolean>(false)
  
  const [refreshInterval, setRefreshInterval] = useState(30000)
  const [monitorTargets, setMonitorTargets] = useState({
    botApi: true,
    remnawaveApi: true,
    remnawaveNodes: true,
  })
  const intervalRef = useRef<number | null>(null)

  const [isChecking, setIsChecking] = useState(false)
  const [nodesChecking, setNodesChecking] = useState(false)

  // System metrics popover (opens above the statuses row).
  const metricsBtnRef = useRef<HTMLButtonElement | null>(null)
  const metricsPopoverRef = useRef<HTMLDivElement | null>(null)
  const [showMetrics, setShowMetrics] = useState(false)
  const [metricsPinned, setMetricsPinned] = useState(false)
  const [metricsStyle, setMetricsStyle] = useState<React.CSSProperties>({})
  // (intentionally click-only; hover is disabled)
  
  // Version indicator moved to TopMenu (VersionStatusButton)

  // Status notifications are generated server-side by the monitoring loop now,
  // so incidents appear even if the web panel wasn't open at the time.
  // Keep a no-op here to avoid duplicates (backend is the source of truth).
  const createStatusNotification = useCallback((_title: string, _message: string, _dedupeKey?: string, _type: 'error' = 'error') => {
    return
  }, [])

  // Получаем состояние из /api/monitoring/state/
  const refreshStatuses = useCallback(async () => {
    // BOT API статус не должен зависеть от наличия Remnawave профиля.
    // Иначе при отсутствии Remnawave профиля пользователи видят "нет данных" по BOT API.
    if (!profilesLoaded) return
    
    setIsChecking(true)
    try {
      const state = await getMonitoringState()
      const now = new Date()
      setLastCheck(now)

      // 1. Bot API
      if (!monitorTargets.botApi) {
        setBotStatus('disabled')
        setBotDetails('Отключено в настройках мониторинга')
        setBotPing(null)
        prevBotStatusRef.current = 'disabled'
      } else if (botProfiles.length === 0) {
        setBotStatus('offline')
        setBotDetails('Добавьте профиль бота')
        setBotPing(null)
      } else if (!activeProfileId) {
        setBotStatus('offline')
        setBotDetails('Выберите активный профиль')
        setBotPing(null)
      } else {
        const botKey = `bot_api_status:${activeProfileId}`
        const botData = state[botKey]
        let newBotStatus: Status = 'offline'
        if (botData) {
          const raw = String(botData.status || '').toLowerCase()
          newBotStatus = raw === 'online' ? 'online' : raw === 'warning' ? 'warning' : 'offline'
          setBotDetails(
            botData.error ||
              (newBotStatus === 'online'
                ? 'BOT API доступен'
                : newBotStatus === 'warning'
                  ? 'BOT API отвечает, но есть проблема'
                  : 'BOT API недоступен'),
          )
          setBotPing(typeof botData.ping_ms === 'number' ? botData.ping_ms : null)
        } else {
          setBotDetails('Данные мониторинга отсутствуют')
          setBotPing(null)
        }
        
        // Проверяем изменение статуса BOT API (только после инициализации)
        if (isInitializedRef.current && prevBotStatusRef.current !== null && prevBotStatusRef.current !== newBotStatus) {
          if (newBotStatus === 'offline' && prevBotStatusRef.current !== 'offline') {
            createStatusNotification('BOT API недоступен', 'BOT API перестал отвечать')
          } else if (newBotStatus === 'online' && prevBotStatusRef.current === 'offline') {
            createStatusNotification('BOT API восстановлен', 'BOT API снова работает')
          }
        }
        setBotStatus(newBotStatus)
        prevBotStatusRef.current = newBotStatus
      }

      // 2. Remnawave API
      if (!monitorTargets.remnawaveApi) {
        setRemnawaveStatus('disabled')
        setRemnawaveDetails('Отключено в настройках мониторинга')
        setRemnawavePing(null)
      } else if (!remnawaveProfilesLoaded) {
        // Avoid false "offline" during initial load: Remnawave profiles can arrive slightly later.
        setRemnawaveStatus('warning')
        setRemnawaveDetails('Загрузка профилей Remnawave…')
        setRemnawavePing(null)
      } else
      if (remnawaveProfiles.length === 0) {
        setRemnawaveStatus('warning')
        setRemnawaveDetails('Remnawave не настроен')
        setRemnawavePing(null)
      } else if (!activeProfileId) {
        setRemnawaveStatus('warning')
        setRemnawaveDetails('Выберите активный профиль')
        setRemnawavePing(null)
      } else {
        const remKey = `api_status:${activeProfileId}`
        const remData = state[remKey]
        let newRemnawaveStatus: Status = 'warning'
        if (remData) {
          newRemnawaveStatus = remData.status === 'online' ? 'online' : 'offline'
          setRemnawaveDetails(remData.error || (remData.status === 'online' ? 'Remnawave API доступен' : 'Remnawave API недоступен'))
          setRemnawavePing(typeof remData.ping_ms === 'number' ? remData.ping_ms : null)
        } else {
          setRemnawaveDetails('Ожидание данных мониторинга...')
          setRemnawavePing(null)
        }
        
        // Проверяем изменение статуса Remnawave API (только после инициализации)
        if (isInitializedRef.current && prevRemnawaveStatusRef.current !== null && prevRemnawaveStatusRef.current !== newRemnawaveStatus) {
          if (newRemnawaveStatus === 'offline' && prevRemnawaveStatusRef.current !== 'offline') {
            createStatusNotification('Remnawave API недоступен', 'Remnawave API перестал отвечать')
          } else if (newRemnawaveStatus === 'online' && prevRemnawaveStatusRef.current === 'offline') {
            createStatusNotification('Remnawave API восстановлен', 'Remnawave API снова работает')
          }
        }
        setRemnawaveStatus(newRemnawaveStatus)
        prevRemnawaveStatusRef.current = newRemnawaveStatus
      }

      // 3. Nodes (фильтруем по activeProfileId)
      if (!monitorTargets.remnawaveApi || !monitorTargets.remnawaveNodes) {
        setNodesStatus('disabled')
        setNodesDetails('Отключено в настройках мониторинга')
        prevNodesStatusRef.current = 'disabled'
        isInitializedRef.current = true
        return
      }
      if (!remnawaveProfilesLoaded) {
        setNodesStatus('warning')
        setNodesDetails('Загрузка профилей Remnawave…')
        prevNodesStatusRef.current = 'warning'
        isInitializedRef.current = true
        return
      }
      if (remnawaveProfiles.length === 0 || !activeProfileId) {
        setNodesStatus('warning')
        setNodesDetails('Remnawave не настроен')
        prevNodesStatusRef.current = 'warning'
        isInitializedRef.current = true
        return
      }

      // Если Remnawave API сейчас не online — узлы НЕ считаем "работают".
      // Иначе в UI можно увидеть "Узлы работают" по старым данным, пока API уже оффлайн.
      const remKeyForNodes = `api_status:${activeProfileId}`
      const remDataForNodes = state[remKeyForNodes]
      const remApiOnline = remDataForNodes && remDataForNodes.status === 'online'
      if (!remApiOnline) {
        setNodesStatus('warning')
        setNodesDetails('Remnawave API недоступен — узлы не проверяются')
        prevNodesStatusRef.current = 'warning'
        isInitializedRef.current = true
        return
      }

      // ВАЖНО: отображаем актуальные данные, как во вкладке "Узлы" (Remnawave page):
      // берём текущий список узлов напрямую через /api/remnawave/nodes/ (а не из monitoring_state, где могут копиться старые ключи).
      setNodesChecking(true)
      setNodesDetails('Проверка узлов…')
      const rawNodes = await getRemnawaveNodes(activeProfileId || undefined).catch(() => null as any)
      setNodesChecking(false)
      const nodesArr: any[] =
        Array.isArray(rawNodes) ? rawNodes
          : Array.isArray((rawNodes as any)?.response) ? (rawNodes as any).response
          : Array.isArray((rawNodes as any)?.nodes) ? (rawNodes as any).nodes
          : Array.isArray((rawNodes as any)?.data) ? (rawNodes as any).data
          : []

      const getNodeStatus = (node: any): 'online' | 'offline' | 'unknown' => {
        if (!node || typeof node !== 'object') return 'unknown'
        if (node.isDisabled === true) return 'offline'
        if (node.isConnected === true) return 'online'
        if (node.isConnected === false) return 'offline'
        const status = String(node.status || '').toLowerCase()
        if (status === 'online') return 'online'
        if (status === 'offline') return 'offline'
        if (node.online === true || node.is_online === true) return 'online'
        if (node.online === false || node.is_online === false) return 'offline'
        return 'unknown'
      }

      let newNodesStatus: Status = 'warning'
      let offlineCount = 0
      let onlineCount = 0
      let unknownCount = 0
      const total = nodesArr.length
      if (total === 0) {
        setNodesDetails('Узлы не найдены или данные обновляются')
      } else {
        for (const n of nodesArr) {
          const s = getNodeStatus(n)
          if (s === 'online') onlineCount += 1
          else if (s === 'offline') offlineCount += 1
          else unknownCount += 1
        }

        if (offlineCount === 0 && unknownCount === 0) {
          newNodesStatus = 'online'
          setNodesDetails(`Все узлы онлайн (${onlineCount}/${total})`)
        } else if (onlineCount > 0) {
          newNodesStatus = 'warning'
          const extra = unknownCount > 0 ? `, ${unknownCount} неизвестно` : ''
          setNodesDetails(`Часть узлов оффлайн: ${onlineCount} онлайн, ${offlineCount} оффлайн${extra}`)
        } else if (offlineCount > 0) {
          newNodesStatus = 'offline'
          setNodesDetails(`Все узлы оффлайн (${total})`)
        } else {
          newNodesStatus = 'warning'
          setNodesDetails(`Статус узлов неизвестен (${unknownCount}/${total})`)
        }
      }
      
      // Проверяем изменение статуса узлов (только после инициализации)
      if (isInitializedRef.current && prevNodesStatusRef.current !== null && prevNodesStatusRef.current !== newNodesStatus) {
        if (newNodesStatus === 'offline' && prevNodesStatusRef.current !== 'offline') {
          createStatusNotification('Все узлы Remnawave оффлайн', 'Все узлы перестали отвечать')
        } else if (newNodesStatus === 'online' && prevNodesStatusRef.current === 'offline') {
          createStatusNotification('Узлы Remnawave восстановлены', 'Все узлы снова работают')
        } else if (newNodesStatus === 'warning' && prevNodesStatusRef.current === 'online') {
          const message = total > 0 
            ? `Часть узлов оффлайн: ${onlineCount} онлайн, ${offlineCount} оффлайн`
            : 'Некоторые узлы перестали отвечать'
          createStatusNotification('Часть узлов Remnawave оффлайн', message)
        }
      }
      setNodesStatus(newNodesStatus)
      prevNodesStatusRef.current = newNodesStatus
      
      // После первой загрузки отмечаем как инициализированное
      if (!isInitializedRef.current) {
        isInitializedRef.current = true
      }

      // NOTE:
      // Do NOT call systemd/module endpoints from header statuses.
      // It creates background polling noise in the bot logs even when the admin isn't in /management.

      // ---- Also create status notifications for NON-active profiles ----
      // This helps when multiple bot profiles exist: statuses/notifications should not depend on which one is active.
      if (isInitializedRef.current && botProfiles.length > 0) {
        const otherProfiles = botProfiles.filter((p) => p && p.id && p.id !== activeProfileId)

        // Pre-aggregate node states per profile id in one pass.
        const nodeAgg: Record<string, { total: number; offline: number }> = {}
        for (const [k, v] of Object.entries(state || {})) {
          if (typeof k !== 'string') continue
          if (k.startsWith('api_status:') || k.startsWith('bot_api_status:')) continue
          if (!v || typeof v !== 'object') continue
          // Only count node entries (created by backend monitoring loop)
          if (!('status' in (v as any)) || !('node_name' in (v as any))) continue
          const idx = k.indexOf(':')
          if (idx <= 0) continue
          const pid = k.slice(0, idx)
          if (!pid) continue
          if (!nodeAgg[pid]) nodeAgg[pid] = { total: 0, offline: 0 }
          nodeAgg[pid].total += 1
          if ((v as any)?.status === 'offline') nodeAgg[pid].offline += 1
        }

        for (const p of otherProfiles) {
          const pid = String(p.id)
          const pname = String(p.name || pid)

          // BOT API status
          const botData = (state as any)[`bot_api_status:${pid}`]
          if (botData) {
            const newBotStatus: Status = botData.status === 'online' ? 'online' : 'offline'
            const prev = prevBotByProfileRef.current[pid]
            if (prev && prev !== newBotStatus) {
              if (newBotStatus === 'offline') {
                createStatusNotification('BOT API недоступен', `Профиль: ${pname} • BOT API перестал отвечать`, `bot:${pid}:offline`)
              } else if (newBotStatus === 'online' && prev === 'offline') {
                createStatusNotification('BOT API восстановлен', `Профиль: ${pname} • BOT API снова работает`, `bot:${pid}:online`)
              }
            }
            prevBotByProfileRef.current[pid] = newBotStatus
          }

          // Remnawave API status
          const remData = (state as any)[`api_status:${pid}`]
          if (remData) {
            const newRemStatus: Status = remData.status === 'online' ? 'online' : 'offline'
            const prev = prevRemByProfileRef.current[pid]
            if (prev && prev !== newRemStatus) {
              if (newRemStatus === 'offline') {
                createStatusNotification('Remnawave API недоступен', `Профиль: ${pname} • Remnawave API перестал отвечать`, `rem:${pid}:offline`)
              } else if (newRemStatus === 'online' && prev === 'offline') {
                createStatusNotification('Remnawave API восстановлен', `Профиль: ${pname} • Remnawave API снова работает`, `rem:${pid}:online`)
              }
            }
            prevRemByProfileRef.current[pid] = newRemStatus

            // Nodes status (only meaningful when Remnawave API is online)
            const remApiOnline = remData.status === 'online'
            if (remApiOnline) {
              const agg = nodeAgg[pid]
              const total = agg?.total || 0
              const offline = agg?.offline || 0
              let newNodesStatus: Status = 'warning'
              if (total > 0) {
                if (offline === 0) newNodesStatus = 'online'
                else if (offline === total) newNodesStatus = 'offline'
                else newNodesStatus = 'warning'
              }
              const prevN = prevNodesByProfileRef.current[pid]
              if (prevN && prevN !== newNodesStatus) {
                if (newNodesStatus === 'offline') {
                  createStatusNotification('Все узлы Remnawave оффлайн', `Профиль: ${pname} • все узлы перестали отвечать`, `nodes:${pid}:offline`)
                } else if (newNodesStatus === 'online' && prevN === 'offline') {
                  createStatusNotification('Узлы Remnawave восстановлены', `Профиль: ${pname} • все узлы снова работают`, `nodes:${pid}:online`)
                } else if (newNodesStatus === 'warning' && prevN === 'online') {
                  createStatusNotification(
                    'Часть узлов Remnawave оффлайн',
                    `Профиль: ${pname} • часть узлов оффлайн (${total - offline}/${total} онлайн)`,
                    `nodes:${pid}:partial`
                  )
                }
              }
              prevNodesByProfileRef.current[pid] = newNodesStatus
            }
          }
        }
      }

    } catch (e) {
      console.error('Failed to fetch monitoring state:', e)
    } finally {
      setIsChecking(false)
    }
  }, [profilesLoaded, remnawaveProfilesLoaded, activeProfileId, botProfiles, remnawaveProfiles, monitorTargets, createStatusNotification])

  const loadBotProfiles = async () => {
    try {
      const data = await getBotProfiles()
      if (data && data.profiles) {
        setBotProfiles(data.profiles)
        const activeId = data.activeProfileId || (data.profiles.length > 0 ? data.profiles[0].id : null)
        setActiveProfileId(activeId)
      }
    } catch {
      setBotProfiles([])
    } finally {
      setProfilesLoaded(true)
    }
  }
  
  const loadRemnawaveProfiles = async () => {
    try {
      const data = await getRemnawaveProfiles()
      if (Array.isArray(data)) {
        setRemnawaveProfiles(data)
      } else {
        setRemnawaveProfiles([])
      }
    } catch {
      setRemnawaveProfiles([])
    } finally {
      setRemnawaveProfilesLoaded(true)
    }
  }

  const handleProfileSwitch = async (profileId: string) => {
    try {
      await setActiveBotProfile(profileId)
      setActiveProfileId(profileId)
      clearBotConfigCache()
      setShowProfileSelector(false)
      window.location.reload()
    } catch {
      // ignore
    }
  }

  const loadMonitoringUiSettings = async () => {
    try {
      const settings = await getMonitoringSettings()
      if (settings && settings.refreshInterval) {
        setRefreshInterval(Math.max(5000, settings.refreshInterval))
      }
      const botApi = (settings as any)?.monitorBotApi !== undefined ? Boolean((settings as any).monitorBotApi) : true
      const remApi =
        (settings as any)?.monitorRemnawaveApi !== undefined ? Boolean((settings as any).monitorRemnawaveApi) : true
      const remNodes =
        (settings as any)?.monitorRemnawaveNodes !== undefined ? Boolean((settings as any).monitorRemnawaveNodes) : true
      setMonitorTargets({
        botApi,
        remnawaveApi: remApi,
        remnawaveNodes: remApi ? remNodes : false,
      })
    } catch {
      // ignore
    }
  }
  
  // Init
  useEffect(() => {
    loadBotProfiles()
    loadRemnawaveProfiles()
    loadMonitoringUiSettings()
  }, [])

  // Monitoring settings can be changed in Settings page (interval, targets).
  useEffect(() => {
    const onChanged = () => {
      loadMonitoringUiSettings()
      setTimeout(() => {
        try {
          refreshStatuses()
        } catch {
          // ignore
        }
      }, 0)
    }
    window.addEventListener('monitoringSettingsChanged', onChanged as EventListener)
    window.addEventListener('refreshIntervalChanged', onChanged as EventListener)
    return () => {
      window.removeEventListener('monitoringSettingsChanged', onChanged as EventListener)
      window.removeEventListener('refreshIntervalChanged', onChanged as EventListener)
    }
  }, [refreshStatuses])

  // If profiles were changed in Settings, refresh immediately (no waiting for interval).
  useEffect(() => {
    const onChanged = () => {
      loadBotProfiles()
      loadRemnawaveProfiles()
      // run once right away after data updates
      setTimeout(() => {
        try {
          refreshStatuses()
        } catch {
          // ignore
        }
      }, 0)
    }
    window.addEventListener('botProfilesChanged', onChanged as EventListener)
    window.addEventListener('remnawaveProfilesChanged', onChanged as EventListener)
    return () => {
      window.removeEventListener('botProfilesChanged', onChanged as EventListener)
      window.removeEventListener('remnawaveProfilesChanged', onChanged as EventListener)
    }
  }, [refreshStatuses])
  
  // Обновляем профили Remnawave при изменении
  useEffect(() => {
    if (profilesLoaded) {
      loadRemnawaveProfiles()
    }
  }, [profilesLoaded])

  // Polling
  useEffect(() => {
    // Run once after we have at least BOT profiles. If Remnawave profiles arrive later,
    // run again so the Remnawave indicator doesn't get stuck in a "loading/offline" placeholder.
    if (profilesLoaded) {
      refreshStatuses()
    }
  }, [profilesLoaded, remnawaveProfilesLoaded, activeProfileId, refreshStatuses])

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!profilesLoaded || refreshInterval <= 0) return

    intervalRef.current = window.setInterval(refreshStatuses, refreshInterval) as unknown as number
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [refreshInterval, refreshStatuses, profilesLoaded])

  // Update on visibility/focus
  useEffect(() => {
    const handleRefresh = () => {
      if (!document.hidden && profilesLoaded) refreshStatuses()
    }
    document.addEventListener('visibilitychange', handleRefresh)
    window.addEventListener('focus', handleRefresh)
    return () => {
      document.removeEventListener('visibilitychange', handleRefresh)
      window.removeEventListener('focus', handleRefresh)
    }
  }, [profilesLoaded, refreshStatuses])

  // Position the profile dropdown relative to the button (rendered in a portal to avoid clipping)
  useEffect(() => {
    if (!showProfileSelector) return
    if (typeof window === 'undefined') return

    const update = () => {
      const btn = profileButtonRef.current
      if (!btn) return

      const rect = btn.getBoundingClientRect()
      const vw = window.innerWidth
      const menuW = Math.min(280, vw - 16) // keep 8px padding from edges
      let left = rect.right - menuW
      left = Math.max(8, Math.min(left, vw - menuW - 8))
      const top = rect.bottom + 8

      setProfileDropdownStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${menuW}px`,
        zIndex: 99999,
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [showProfileSelector])

  const activeProfile = botProfiles.find(p => p.id === activeProfileId)

  const remnawaveCombined = useMemo(() => {
    // Combine "Remnawave API" + "Nodes" into one indicator.
    // - If API is offline => whole Remnawave is offline
    // - If API is online but nodes have issues => warning
    // - If both online => online
    const api = remnawaveStatus
    const nodes = nodesStatus

    let status: Status = 'warning'
    if (api === 'disabled') status = 'disabled'
    else if (api === 'offline') status = 'offline'
    else if (nodes === 'disabled') status = api
    else if (api === 'online' && nodes === 'online') status = 'online'
    else if (api === 'online' && nodes === 'offline') status = 'warning'
    else if (api === 'warning' || nodes === 'warning') status = 'warning'
    else status = api

    // UX: during узлы-check, don't flash "warning" when API is online.
    // We'll show green dot with "Проверка…" (handled by isChecking in StatusIndicator).
    if (api === 'online' && nodesChecking) {
      status = 'online'
    }

    // Compact, useful details for tooltip
    const parts: string[] = []
    if (remnawaveDetails) parts.push(remnawaveDetails)
    if (nodesDetails) parts.push(nodesDetails)

    return {
      status,
      details: parts.filter(Boolean).join(' • '),
      ping: remnawavePing,
    }
  }, [remnawaveStatus, nodesStatus, remnawaveDetails, nodesDetails, remnawavePing, nodesChecking])

  const updateMetricsPosition = useCallback(() => {
    const btn = metricsBtnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(620, Math.max(380, vw - 16))
    const estimatedH = 520

    const nav = document.querySelector('nav[aria-label="Навигация"]') as HTMLElement | null
    const navRect = nav?.getBoundingClientRect()
    const minTop = Math.max(8, (navRect?.bottom ?? 0) + 8)

    let left = rect.left + rect.width / 2 - w / 2
    if (left + w > vw - 8) left = vw - w - 8
    if (left < 8) left = 8

    // Prefer ABOVE the button (as requested). If no space, place below.
    let top = rect.top - estimatedH - 10
    if (top < minTop) top = Math.max(rect.bottom + 12, minTop)

    setMetricsStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${w}px`,
      zIndex: 100000,
      pointerEvents: 'auto',
      transform: 'translateZ(0)',
      willChange: 'transform',
    })

    // Refine with real popover height.
    requestAnimationFrame(() => {
      const pop = metricsPopoverRef.current
      if (!pop) return
      const pr = pop.getBoundingClientRect()
      let finalTop = rect.top - pr.height - 10
      if (finalTop < minTop) finalTop = Math.max(rect.bottom + 12, minTop)
      if (finalTop + pr.height > vh - 8) finalTop = Math.max(minTop, vh - pr.height - 8)

      let finalLeft = rect.left + rect.width / 2 - pr.width / 2
      if (finalLeft + pr.width > vw - 8) finalLeft = vw - pr.width - 8
      if (finalLeft < 8) finalLeft = 8

      setMetricsStyle((prev) => ({
        ...prev,
        top: `${finalTop}px`,
        left: `${finalLeft}px`,
      }))
    })
  }, [])

  const openMetrics = useCallback(
    (opts?: { pin?: boolean }) => {
      if (opts?.pin) setMetricsPinned(true)
      setShowMetrics(true)
      // Position after state update.
      setTimeout(() => {
        try {
          updateMetricsPosition()
        } catch {
          // ignore
        }
      }, 0)
    },
    [updateMetricsPosition],
  )

  const closeMetrics = useCallback((force = false) => {
    if (!force && metricsPinned) return
    setShowMetrics(false)
    setMetricsPinned(false)
  }, [metricsPinned])

  // Keep popover positioned on scroll/resize.
  useEffect(() => {
    if (!showMetrics) return
    const onAny = () => updateMetricsPosition()
    window.addEventListener('resize', onAny)
    window.addEventListener('scroll', onAny, true)
    return () => {
      window.removeEventListener('resize', onAny)
      window.removeEventListener('scroll', onAny, true)
    }
  }, [showMetrics, updateMetricsPosition])

  // Close on outside click / ESC
  useEffect(() => {
    if (!showMetrics) return
    const onDown = (e: Event) => {
      const t = (e as any).target as Node | null
      if (!t) return
      if (metricsBtnRef.current?.contains(t)) return
      if (metricsPopoverRef.current?.contains(t)) return
      closeMetrics(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMetrics(true)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showMetrics, closeMetrics])

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap flex-shrink-0">
      {/* Mobile: single row (scroll handled by parent container in TopMenu). Desktop: same row. */}
      <div className="flex flex-row items-center gap-1.5 sm:gap-2 flex-nowrap w-auto">
        {/* Metrics button (before BOT API) */}
        <button
          ref={metricsBtnRef}
          type="button"
          className={[
            'status-indicator-container relative flex items-center justify-center',
            'px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-default',
            'bg-overlay-sm hover:bg-overlay-md transition-colors duration-200',
            'cursor-pointer select-none',
          ].join(' ')}
          title="Метрики"
          onClick={() => {
            // Click-only open/close (no hover).
            if (showMetrics) closeMetrics(true)
            else openMetrics({ pin: true })
          }}
          aria-label="Метрики"
        >
          <Activity className="w-4 h-4 text-secondary" />
          <span className="sr-only">Метрики</span>
        </button>

        <StatusIndicator 
          label="BOT API" 
          status={botStatus} 
          details={botDetails}
          lastCheck={lastCheck}
          isChecking={isChecking}
          ping={botPing}
        />
        {botProfiles.length > 0 && (
          <>
            <StatusIndicator
              label="Remnawave"
              status={remnawaveCombined.status}
              details={remnawaveCombined.details}
              lastCheck={lastCheck}
              isChecking={isChecking}
              ping={remnawaveCombined.ping}
            />
          </>
        )}
        
        {botProfiles.length > 0 && (
          <div className="relative w-auto">
            <button
              ref={profileButtonRef}
              onClick={() => setShowProfileSelector(!showProfileSelector)}
              className="status-indicator-container relative flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-orange-500/20 rounded-lg border border-orange-500/50 hover:border-orange-400/70 transition-colors duration-200 cursor-pointer group w-auto max-w-[200px]"
              title="Переключить профиль бота"
            >
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-300 group-hover:text-orange-200 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            <div className="flex flex-col min-w-0 hidden sm:flex">
              <span className="text-xs font-medium text-primary truncate">
                {activeProfile?.name || 'Профиль'}
              </span>
              <span className="text-xs text-orange-300/80 truncate">
                Профиль
              </span>
            </div>
            <div className="sm:hidden">
              <span className="text-[10px] font-medium text-primary truncate max-w-[60px] block">
                {activeProfile?.name || 'Профиль'}
              </span>
            </div>
            <svg className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-300 group-hover:text-orange-200 transition-transform duration-200 flex-shrink-0 will-change-transform ${showProfileSelector ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {showProfileSelector && (
            typeof document !== 'undefined'
              ? createPortal(
                  <>
                    <div
                      className="fixed inset-0 z-[99998]"
                      onClick={() => setShowProfileSelector(false)}
                    />
                    <div
                      className="bg-[var(--bg-surface-hover)] border border-default rounded-lg shadow-xl overflow-hidden"
                      style={profileDropdownStyle}
                    >
                      <div className="px-3 py-2.5 border-b border-default bg-overlay-md">
                        <span className="text-xs font-semibold text-primary">Выберите профиль бота</span>
                      </div>
                      <div className="max-h-[300px] overflow-y-auto">
                        {botProfiles.map((profile) => (
                          <button
                            key={profile.id}
                            onClick={() => handleProfileSwitch(profile.id)}
                            className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2.5 ${
                              profile.id === activeProfileId
                                ? 'bg-orange-500/20 text-orange-300 border-l-2 border-orange-400'
                                : 'text-primary hover:bg-overlay-md'
                            }`}
                          >
                            {profile.id === activeProfileId ? (
                              <svg className="w-4 h-4 flex-shrink-0 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <div className="w-4 h-4 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div
                                className={`font-medium truncate ${
                                  profile.id === activeProfileId ? 'text-orange-300' : 'text-primary'
                                }`}
                              >
                                {profile.name}
                              </div>
                              <div className="text-xs text-muted truncate mt-0.5">
                                Admin ID: {profile.adminId}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>,
                  document.body
                )
              : null
          )}
        </div>
      )}
      </div>

      {showMetrics && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={metricsPopoverRef}
              style={metricsStyle}
              className="pointer-events-auto"
            >
              <div className="relative w-full max-h-[min(82vh,760px)] overflow-y-auto rounded-2xl">
                <SystemMonitorWidget variant="embedded" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
