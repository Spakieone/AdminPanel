import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBotConfigAsync } from '../utils/botConfig'
import { getCachedUsers, getCachedPayments } from '../api/client'
import { parseMskDate, parseMskDateLocal } from '../utils/dateUtils'

type NotificationType = 'payment' | 'user' | 'error' | 'success'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  message: string
  date: Date
  data?: any
}

const SERVER_STATE_ENABLED = true

const RETENTION_MS: Record<NotificationType, number> = {
  // Для payment/user держим "последние N" (счётчиком), а не по времени.
  // RETENTION оставляем большим, чтобы они не исчезали сами по себе.
  payment: 7 * 24 * 60 * 60 * 1000, // 7 дней
  user: 7 * 24 * 60 * 60 * 1000, // 7 дней
  error: 24 * 60 * 60 * 1000, // 24 часа (статусы/ошибки)
  success: 24 * 60 * 60 * 1000, // 24 часа (восстановления/успешные статусы)
}

function stableHash(input: string): string {
  // Small deterministic hash (djb2) for stable IDs when backend doesn't provide them.
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i)
  // make it short, url-safe-ish
  return (h >>> 0).toString(36)
}

function stableId(prefix: string, parts: any[]): string {
  const raw = parts
    .map((p) => {
      if (p === null || p === undefined) return ''
      if (typeof p === 'string' || typeof p === 'number' || typeof p === 'boolean') return String(p)
      try {
        return JSON.stringify(p)
      } catch {
        return String(p)
      }
    })
    .join('|')
  return `${prefix}${stableHash(raw)}`
}

async function tryPersistReadIdsToServer(ids: Set<string>, dismissed_before?: number) {
  if (!SERVER_STATE_ENABLED) return
  try {
    const { saveNotificationsState } = await import('../api/client')
    await saveNotificationsState({
      mode: 'merge',
      read_ids: Array.from(ids),
      dismissed_before,
    })
  } catch {
    // ignore (offline / not authenticated / older backend)
  }
}

function parseAnyDate(d: any): Date {
  if (d instanceof Date) return d
  if (typeof d === 'string' || typeof d === 'number') {
    const dt = new Date(d)
    if (!Number.isNaN(dt.getTime())) return dt
  }
  return new Date()
}

// Parse dates that come in UTC from backend (users, keys)
function parseCreatedAtMsUtc(v: any): number {
  return parseMskDate(v).getTime()
}

// Parse dates that come in MSK from backend (payments)
function parseCreatedAtMsLocal(v: any): number {
  return parseMskDateLocal(v).getTime()
}

function parseAnyToDateUtc(v: any): Date {
  return parseMskDate(v)
}

function parseAnyToDateLocal(v: any): Date {
  return parseMskDateLocal(v)
}

function extractItems(data: any): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    if (Array.isArray((data as any).items)) return (data as any).items
    if (Array.isArray((data as any).data)) return (data as any).data
    if (Array.isArray((data as any).response)) return (data as any).response
  }
  return []
}

function isSuccessPaymentStatus(raw: any): boolean {
  const s = String(raw ?? '').toLowerCase().trim()
  return s === 'success' || s === 'successful' || s === 'completed' || s === 'успешно'
}

export interface NotificationsState {
  loading: boolean
  enabled: boolean
  notifications: NotificationItem[]
  readIds: Set<string>
  unreadCount: number
  toasts: NotificationItem[]
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearAll: () => void
  dismissToast: (id: string) => void
  refresh: () => void
}

export function useNotifications(): NotificationsState {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set())
  const [toasts, setToasts] = useState<NotificationItem[]>([])
  const [dismissedBefore, setDismissedBefore] = useState<number>(0)
  const [serverStatusNotifications, setServerStatusNotifications] = useState<any[]>([])
  const [enabled, setEnabled] = useState<boolean>(true)
  const [panelPrefs, setPanelPrefs] = useState({
    onDown: true,
    onRecovery: true,
    payments: true,
    users: true,
  })

  const readIdsRef = useRef<Set<string>>(readIds)
  const prevIdsRef = useRef<Set<string>>(new Set())
  const hydratedRef = useRef(false)
  const suppressNextToastRef = useRef(true) // suppress on initial load + after tab becomes visible
  const profileIdRef = useRef<string | null>(null)
  const toastTimersRef = useRef<Record<string, number>>({})
  const dismissedBeforeRef = useRef<number>(dismissedBefore)
  const serverStatusNotificationsRef = useRef<any[]>(serverStatusNotifications)
  const enabledRef = useRef<boolean>(enabled)
  const panelPrefsRef = useRef(panelPrefs)
  const isRunningRef = useRef(false) // prevent concurrent loadNotifications calls

  const scheduleToastDismiss = useCallback((id: string) => {
    if (toastTimersRef.current[id]) return
    toastTimersRef.current[id] = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      window.clearTimeout(toastTimersRef.current[id])
      delete toastTimersRef.current[id]
    }, 5000)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    if (toastTimersRef.current[id]) {
      window.clearTimeout(toastTimersRef.current[id])
      delete toastTimersRef.current[id]
    }
  }, [])

  // Hydrate readIds from server (if available). Fallback to localStorage.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!SERVER_STATE_ENABLED) return
      try {
        const { getNotificationsState } = await import('../api/client')
        const state = await getNotificationsState()
        const serverIds = Array.isArray((state as any)?.read_ids) ? (state as any).read_ids : []
        const serverDismissed = typeof (state as any)?.dismissed_before === 'number' ? (state as any).dismissed_before : 0
        const statusNotifs = Array.isArray((state as any)?.status_notifications) ? (state as any).status_notifications : []
        if (cancelled) return
        setDismissedBefore(serverDismissed > 0 ? serverDismissed : 0)
        setReadIds(new Set(serverIds.filter((x: any) => typeof x === 'string')))
        setServerStatusNotifications(statusNotifs.filter((x: any) => x && typeof x === 'object'))
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // keep ref in sync so refresh doesn't depend on readIds state (and doesn't re-run on "read all")
  useEffect(() => {
    readIdsRef.current = readIds
  }, [readIds])
  useEffect(() => {
    dismissedBeforeRef.current = dismissedBefore
  }, [dismissedBefore])
  useEffect(() => {
    serverStatusNotificationsRef.current = serverStatusNotifications
  }, [serverStatusNotifications])
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])
  useEffect(() => {
    panelPrefsRef.current = panelPrefs
  }, [panelPrefs])

  // Read "panel notifications enabled" from monitoring settings
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { getMonitoringSettings } = await import('../api/client')
        const s: any = await getMonitoringSettings()
        const panelEnabled = s?.panelNotificationsEnabled !== undefined ? Boolean(s.panelNotificationsEnabled) : true
        const prefs = {
          onDown: s?.panelNotifyOnDown !== undefined ? Boolean(s.panelNotifyOnDown) : true,
          onRecovery: s?.panelNotifyOnRecovery !== undefined ? Boolean(s.panelNotifyOnRecovery) : true,
          payments: s?.panelNotifyPayments !== undefined ? Boolean(s.panelNotifyPayments) : true,
          users: s?.panelNotifyUsers !== undefined ? Boolean(s.panelNotifyUsers) : true,
        }
        if (cancelled) return
        setEnabled(panelEnabled)
        setPanelPrefs(prefs)
        if (!panelEnabled) {
          // Hide everything immediately (avoid stale bell + sideways updates)
          setNotifications([])
          setToasts([])
          setLoading(false)
        }
      } catch {
        // ignore -> default enabled
      }
    }
    load()
    const onChanged = () => load()
    window.addEventListener('monitoringSettingsChanged', onChanged as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener('monitoringSettingsChanged', onChanged as EventListener)
    }
  }, [])

  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      void tryPersistReadIdsToServer(next)
      return next
    })
  }, [])

  const markAllAsRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev)
      for (const n of notifications) next.add(n.id)
      void tryPersistReadIdsToServer(next)
      return next
    })
    // user action should not trigger toasts
    setToasts([])
    for (const id of Object.keys(toastTimersRef.current)) {
      window.clearTimeout(toastTimersRef.current[id])
    }
    toastTimersRef.current = {}
    suppressNextToastRef.current = true
  }, [notifications])

  const clearAll = useCallback(() => {
    const now = Date.now()
    setDismissedBefore(now)

    setReadIds(() => {
      const empty = new Set<string>()
      // replace on server: drop read ids + clear status notifications + set dismissed_before
      void (async () => {
        try {
          const { saveNotificationsState } = await import('../api/client')
          await saveNotificationsState({
            mode: 'replace',
            read_ids: [],
            dismissed_before: now,
            clear_status_notifications: true,
          })
        } catch {
          // ignore
        }
      })()
      return empty
    })
    setServerStatusNotifications([])

    setNotifications([])
    prevIdsRef.current = new Set()
    setToasts([])
    for (const id of Object.keys(toastTimersRef.current)) {
      window.clearTimeout(toastTimersRef.current[id])
    }
    toastTimersRef.current = {}
    suppressNextToastRef.current = true
  }, [])

  const unreadCount = useMemo(() => {
    return notifications.reduce((acc, n) => (readIds.has(n.id) ? acc : acc + 1), 0)
  }, [notifications, readIds])

  const loadNotifications = useCallback(async () => {
    if (!enabledRef.current) {
      setLoading(false)
      return
    }
    if (isRunningRef.current) return
    isRunningRef.current = true
    try {
      // keep server-side state in sync (readIds + dismissed_before + status notifications)
      try {
        const { getNotificationsState } = await import('../api/client')
        const state = await getNotificationsState()
        if (Array.isArray((state as any)?.read_ids)) {
          setReadIds(new Set((state as any).read_ids.filter((x: any) => typeof x === 'string')))
        }
        if (typeof (state as any)?.dismissed_before === 'number') {
          setDismissedBefore((state as any).dismissed_before > 0 ? (state as any).dismissed_before : 0)
        }
        if (Array.isArray((state as any)?.status_notifications)) {
          setServerStatusNotifications((state as any).status_notifications.filter((x: any) => x && typeof x === 'object'))
        }
      } catch {
        // ignore
      }

      // Detect active profile id (needed to scope bot-based notifications)
      let activeProfileId: string | null = profileIdRef.current
      try {
        const { getBotProfiles } = await import('../api/client')
        const profilesData: any = await getBotProfiles()
        const profiles = Array.isArray(profilesData?.profiles) ? profilesData.profiles : []
        const effectiveProfileId = profilesData?.activeProfileId
          ? String(profilesData.activeProfileId)
          : profiles[0]?.id
            ? String(profiles[0].id)
            : null
        // keep previous on weird empty responses
        if (effectiveProfileId) {
          activeProfileId = effectiveProfileId
        }
      } catch {
        // ignore
      }

      // If profile changed, reset in-memory state and suppress toasts once
      if (profileIdRef.current !== activeProfileId) {
        profileIdRef.current = activeProfileId
        prevIdsRef.current = new Set()
        suppressNextToastRef.current = true
      }

      const config = await getBotConfigAsync()
      if (!config) return

      const prefs = panelPrefsRef.current
      // IMPORTANT: use paginated endpoints with small limit to avoid loading 100k+ records.
      // We only need the most recent items for notifications.
      const [paymentsResp, usersResp] = await Promise.all([
        prefs.payments ? getCachedPayments({ page: 1, per_page: 50, status: 'success' }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] } as any),
        prefs.users ? getCachedUsers({ page: 1, per_page: 50 }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] } as any),
      ])

      const paymentsList = extractItems(paymentsResp.items || paymentsResp)
      const usersList = extractItems(usersResp.items || usersResp)

      const next: NotificationItem[] = []
      const profilePrefix = activeProfileId ? `p:${activeProfileId}:` : 'p:unknown:'

      // Payments: последние 20 успешных (как на странице Платежи)
      // Backend sends payments in MSK timezone
      const recentPayments = paymentsList
        .filter((p: any) => {
          return isSuccessPaymentStatus(p.status ?? p.payment_status)
        })
        .sort((a: any, b: any) => parseCreatedAtMsLocal(b.created_at) - parseCreatedAtMsLocal(a.created_at))
        .slice(0, 20)

      for (const p of recentPayments) {
        const amount = p.amount || p.sum || p.total || 0
        const provider = p.provider || p.payment_provider || p.payment_system || 'неизвестно'
        const tgId = p.tg_id || p.user_id || 'неизвестно'
        const paymentId =
          p.id ||
          p.payment_id ||
          stableId(`${profilePrefix}payment-`, [p.created_at || p.created || p.date, tgId, amount, provider])
        next.push({
          id: `${profilePrefix}payment-${paymentId}`,
          type: 'payment',
          title: 'Новый платеж',
          message: `Платеж ${typeof amount === 'number' ? amount.toLocaleString('ru-RU') : amount} ₽ • ${tgId} • ${provider}`,
          date: parseAnyToDateLocal(p.created_at || p.created || p.date || Date.now()),
          data: { amount, provider, tgId, paymentId: p.id || p.payment_id || paymentId },
        })
      }

      // Users: последние 50 (без часового фильтра — старые вытесняются новыми)
      // Backend sends users in UTC timezone
      const recentUsers = usersList
        .sort((a: any, b: any) => {
          const aMs = parseCreatedAtMsUtc(a.created_at || a.created || a.createdAt || a.registered_at || a.registeredAt || a.date)
          const bMs = parseCreatedAtMsUtc(b.created_at || b.created || b.createdAt || b.registered_at || b.registeredAt || b.date)
          return bMs - aMs
        })
        .slice(0, 50)

      for (const u of recentUsers) {
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Без имени'
        const username = u.username ? `@${u.username}` : ''
        const userId =
          u.tg_id ||
          u.id ||
          stableId(`${profilePrefix}user-`, [u.created_at || u.created || u.createdAt || u.registered_at || u.registeredAt || u.date, u.username, fullName])
        next.push({
          id: `${profilePrefix}user-${userId}`,
          type: 'user',
          title: 'Новый пользователь',
          message: `${fullName} ${username ? `(${username})` : ''} • ID: ${u.tg_id || u.id}`,
          date: parseAnyToDateUtc(u.created_at || u.created || u.createdAt || u.registered_at || u.registeredAt || u.date || Date.now()),
          data: { tgId: u.tg_id || u.id, username: u.username, fullName },
        })
      }

      // Expiring subscriptions notifications removed (by request)

      // Status notifications from server state
      const statusList = serverStatusNotificationsRef.current
      if (Array.isArray(statusList) && statusList.length) {
        const nowMs = Date.now()
        for (const n of statusList) {
          if (!n?.id) continue
          const dt = parseAnyDate(n.date)
          if (nowMs - dt.getTime() > RETENTION_MS.error) continue
          const data = (n as any).data && typeof (n as any).data === 'object' ? (n as any).data : {}
          const kind = String(data.kind || (n as any).kind || '').toLowerCase()
          const isRecovery = kind.endsWith('_up') || kind === 'node_up' || kind === 'bot_api_up' || kind === 'rem_api_up'
          const isDown = kind.endsWith('_down') || kind.includes('offline') || kind === 'node_down' || kind === 'node_stable_offline' || kind === 'bot_api_down' || kind === 'rem_api_down'
          // Respect panel incident toggles
          if (isRecovery && !prefs.onRecovery) continue
          if (isDown && !prefs.onDown) continue
          next.push({
            id: String(n.id),
            type: (String(n.type || 'error') as NotificationType) || 'error',
            title: String(n.title || 'Уведомление'),
            message: String(n.message || ''),
            date: dt,
            data: (n as any).data,
          })
        }
      }

      next.sort((a, b) => b.date.getTime() - a.date.getTime())
      // удаляем старые уведомления из ленты (live-feed)
      const nowMs = Date.now()
      const retained = next.filter((n) => nowMs - n.date.getTime() <= (RETENTION_MS[n.type] ?? RETENTION_MS.error))
      const dismissed = dismissedBeforeRef.current
      const visibleRetained = dismissed > 0 ? retained.filter((n) => n.date.getTime() > dismissed) : retained
      const visibleNow = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
      const prevIds = prevIdsRef.current
      // Detect new arrivals by "first seen" (prevIds), NOT by created_at timestamp.
      // This makes toasts reliable even if the backend time format/timezone differs.
      // Also: we intentionally do NOT depend on readIds here — read state affects bell count,
      // but the realtime popup should still appear when an event is first observed.
      const currentReadIds = readIdsRef.current
      const newArrivals = visibleRetained.filter((n) => !prevIds.has(n.id) && !currentReadIds.has(n.id))
      const toastCandidates = newArrivals.filter((n) => n.type === 'payment' || n.type === 'user')

      const shouldToast = hydratedRef.current && visibleNow && suppressNextToastRef.current === false
      if (shouldToast && toastCandidates.length) {
        setToasts((cur) => {
          const curIds = new Set(cur.map((t) => t.id))
          const merged = [...toastCandidates.filter((t) => !curIds.has(t.id)), ...cur].slice(0, 3)
          for (const t of merged) scheduleToastDismiss(t.id)
          return merged
        })
      }

      const trimmed = visibleRetained.slice(0, 200)
      setNotifications(trimmed)
      prevIdsRef.current = new Set(trimmed.map((n) => n.id))
      hydratedRef.current = true
      suppressNextToastRef.current = false
    } finally {
      setLoading(false)
      isRunningRef.current = false
    }
  }, [scheduleToastDismiss])

  useEffect(() => {
    loadNotifications()
    // Lightweight polling so new users/payments appear without manual refresh.
    // Kept moderate to avoid excessive load (each poll requests only small pages).
    const pollMs = 30_000
    const t = window.setInterval(() => {
      // Don't poll while tab is hidden.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      loadNotifications()
    }, pollMs)

    const onStatusNotificationAdded = () => loadNotifications()
    window.addEventListener('statusNotificationAdded', onStatusNotificationAdded as EventListener)
    return () => {
      window.removeEventListener('statusNotificationAdded', onStatusNotificationAdded as EventListener)
      window.clearInterval(t)
    }
  }, [loadNotifications])

  // If user was away (tab hidden), suppress the first toast batch after return
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      suppressNextToastRef.current = true
      // next successful refresh will clear it
      loadNotifications()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [loadNotifications])

  // cleanup timers
  useEffect(() => {
    return () => {
      for (const id of Object.keys(toastTimersRef.current)) {
        window.clearTimeout(toastTimersRef.current[id])
      }
      toastTimersRef.current = {}
    }
  }, [])

  return {
    loading,
    enabled,
    notifications,
    readIds,
    unreadCount,
    toasts,
    markAsRead,
    markAllAsRead,
    clearAll,
    dismissToast,
    refresh: loadNotifications,
  }
}


