import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react'
import { getProviderColor } from '../utils/providerColor'
import { useSessionFilters } from '../hooks/useSessionFilters'
// Layout теперь применяется на уровне роутера (LayoutRoute)
import { getBotConfigAsync, clearBotConfigCache } from '../utils/botConfig'
import { getBotTariffs, getBotBannedCounts, getAllBotManualBans, getAllBotBlockedUsers, deleteBotManualBan, deleteBotBlockedUser, deleteBotKeyByEmail, getBotTrackingSources } from '../api/botApi'
import { getAllRemnawaveSettings, getBotProfiles, getRemnawaveNodes, getRemnawaveUsersBulkByIdentifier, getCachedUsers, getCachedKeys } from '../api/client'
import UserDetailModal from '../components/users/UserDetailModal'
import KeyEditModal from '../components/users/KeyEditModal'
import GlassTabs from '../components/common/GlassTabs'
import CapybaraLoader from '../components/common/CapybaraLoader'
import { GradientAlert } from '../components/common/GradientAlert'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import { formatMskDateTime, formatMskDateTimeShort } from '../utils/dateUtils'
import * as Flags from 'country-flag-icons/react/3x2'
import DeleteButton from '../components/ui/DeleteButton'
import EditButton from '../components/ui/EditButton'
import DarkSelect, { type DarkSelectGroup } from '../components/common/DarkSelect'
import CopyText from '../components/ui/CopyText'

interface User {
  tg_id: number
  username?: string
  first_name?: string
  last_name?: string
  created_at?: string
  [key: string]: any
}

interface Key {
  id?: string
  name?: string
  email?: string
  tg_id?: number
  tariff_name?: string
  server_name?: string
  cluster_name?: string
  expiry_time?: string
  status?: string
  [key: string]: any
}


type ViewMode = 'users' | 'keys' | 'banned'

interface BannedUser {
  tg_id: number
  username?: string
  first_name?: string
  last_name?: string
  reason?: string
  banned_at?: string | Date
  banned_by?: number
  is_permanent?: boolean
  expires_at?: string | Date | null
  until?: string | Date | null
  [key: string]: any
}

export default function Users({
  initialViewMode = 'users',
  showTabs = true,
}: {
  initialViewMode?: ViewMode
  showTabs?: boolean
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [users, setUsers] = useState<User[]>([])
  const [keys, setKeys] = useState<Key[]>([])
  const [bannedUsers, setBannedUsers] = useState<BannedUser[]>([])
  const [bannedCount, setBannedCount] = useState<number>(0)
  const [tariffs, setTariffs] = useState<any[]>([])
  const [trackingSources, setTrackingSources] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const missingProfile = Boolean(error && error.includes('Нет активного профиля'))
  const [currentPage, setCurrentPage] = useState(1)
  const [remoteTotal, setRemoteTotal] = useState(0)
  const [remoteTotalPages, setRemoteTotalPages] = useState(1)

  const [uFilters, setUFilter] = useSessionFilters('users-filters', {
    searchQuery: '',
    pageSize: 25,
    selectedTariff: 'all',
    sourceFilter: 'all',
    usersSortDir: 'desc',
  })
  const searchQuery = uFilters.searchQuery
  const setSearchQuery = (v: string) => { setUFilter('searchQuery', v); setCurrentPage(1) }
  const pageSize = uFilters.pageSize as number
  const setPageSize = (v: number) => { setUFilter('pageSize', v); setCurrentPage(1) }
  const selectedTariff = uFilters.selectedTariff
  const setSelectedTariff = (v: string) => { setUFilter('selectedTariff', v); setCurrentPage(1) }
  const sourceFilter = uFilters.sourceFilter
  const setSourceFilter = (v: string) => { setUFilter('sourceFilter', v); setCurrentPage(1) }
  const usersSortDir = uFilters.usersSortDir as 'desc' | 'asc'
  const setUsersSortDir = (v: 'desc' | 'asc') => { setUFilter('usersSortDir', v); setCurrentPage(1) }
  const [selectedUser, setSelectedUser] = useState<number | null>(null)
  const [editingKey, setEditingKey] = useState<Key | null>(null)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{isOpen: boolean, user: BannedUser | null, key: Key | null}>({isOpen: false, user: null, key: null})

  // Remnawave enrich (for subscriptions table)
  const [rmwEnabled, setRmwEnabled] = useState(false)
  const [rmwChecking, setRmwChecking] = useState(true) // true until we know if rmw is configured
  const [rmwProfileId, setRmwProfileId] = useState<string | undefined>(undefined)
  const [rmwNodesByUuid, setRmwNodesByUuid] = useState<Record<string, { name: string; countryCode: string | null }>>({})
  const [rmwUsersByName, setRmwUsersByName] = useState<Record<string, { user: any | null; fetchedAt: number }>>({})

  useEffect(() => {
    setViewMode(initialViewMode)
  }, [initialViewMode])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      let config = await getBotConfigAsync()
      if (!config) {
        // Пробуем еще раз загрузить профили, возможно кэш устарел
        clearBotConfigCache()
        config = await getBotConfigAsync()
        if (!config) {
          setError('Нет активного профиля. Создайте профиль в настройках.')
          setLoading(false)
          return
        }
      }
      // Используем серверную пагинацию (быстро на больших БД)
      const sourceParam = sourceFilter !== 'all' ? sourceFilter : undefined
      const [usersResp, sourcesResp] = await Promise.all([
        getCachedUsers({ page: currentPage, per_page: pageSize, search: searchQuery || undefined, source: sourceParam }),
        getBotTrackingSources(config).catch(() => []),
      ])
      const usersItems = Array.isArray((usersResp as any)?.items) ? (usersResp as any).items : []
      setUsers(usersItems)
      setRemoteTotal(Number((usersResp as any)?.total || 0))
      setRemoteTotalPages(Number((usersResp as any)?.total_pages || 1))
      setTrackingSources(Array.isArray(sourcesResp) ? sourcesResp : [])
    } catch (err: any) {
      // IMPORTANT: do NOT fallback to full-list loading on large DBs.
      setError(err.message || 'Ошибка загрузки пользователей (проверь работу Bot API модуля и серверную пагинацию)')
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, searchQuery, sourceFilter])

  const loadKeys = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setLoading(false)
        return
      }

      // Determine tariff_id for server-side filtering
      let tariffIdParam: number | undefined = undefined
      if (selectedTariff !== 'all' && selectedTariff !== 'no_tariff') {
        const parsed = parseInt(selectedTariff, 10)
        if (!isNaN(parsed)) tariffIdParam = parsed
      }

      // Серверная пагинация (не грузим 100k записей)
      const [keysResponse, tariffsData] = await Promise.all([
        getCachedKeys({ 
          page: currentPage, 
          per_page: pageSize, 
          search: searchQuery || undefined, 
          status: 'all',
          tariff_id: tariffIdParam,
          force: force ? true : undefined,
        }).catch(() => ({ items: [], total: 0, total_pages: 1 })),
        getBotTariffs(config).catch(() => [])
      ])
      
      const cachedKeys: any = keysResponse as any
      let keysList =
        Array.isArray(cachedKeys)
          ? cachedKeys
          : Array.isArray(cachedKeys?.items)
            ? cachedKeys.items
            : []
      setRemoteTotal(Number((cachedKeys as any)?.total || 0))
      setRemoteTotalPages(Number((cachedKeys as any)?.total_pages || 1))
      const tariffsList = Array.isArray(tariffsData) ? tariffsData : []
      
      // Client-side filter for "no_tariff" (can't filter on server easily)
      if (selectedTariff === 'no_tariff') {
        keysList = keysList.filter((key: any) => {
          const hasTariffId = key.tariff_id || key.tariffId
          return !hasTariffId
        })
      }

      // Обогащаем ключи данными о тарифах
      const enrichedKeys = keysList.map((key: any) => {
        if (key.tariff_id || key.tariffId) {
          const tariff = tariffsList.find((t: any) => 
            (t.id || t.tariff_id) === (key.tariff_id || key.tariffId)
          )
          if (tariff) {
            return { ...key, tariff_name: tariff.name || tariff.tariff_name || key.tariff_id || key.tariffId }
          }
        }
        return key
      })
      
      setKeys(enrichedKeys)
      setTariffs(Array.isArray(tariffsData) ? tariffsData : [])
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки подписок')
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, searchQuery, selectedTariff])

  // Загрузка счётчика забаненных (быстрый запрос)
  const loadBannedUsersForCounter = useCallback(async () => {
    try {
      const config = await getBotConfigAsync()
      if (!config) return

      const counts = await getBotBannedCounts(config)
      setBannedCount(counts.manualBans + counts.blockedUsers)
    } catch {
      // Игнорируем ошибки при загрузке для счетчика
    }
  }, [])

  const loadBannedUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setLoading(false)
        return
      }

      // Загружаем ВСЕ баны постранично (blocked-users может быть 1500+)
      const [manualBansData, blockedUsersData] = await Promise.all([
        getAllBotManualBans(config).catch(() => []),
        getAllBotBlockedUsers(config).catch(() => []),
      ])

      // Объединяем manual bans и blocked users
      const manualBans = Array.isArray(manualBansData) ? manualBansData : []
      const blockedUsers = Array.isArray(blockedUsersData) ? blockedUsersData : []
      
      // Преобразуем manual bans в формат BannedUser
      const bannedList: BannedUser[] = manualBans.map((ban: any) => ({
        tg_id: ban.tg_id,
        username: ban.username || undefined,
        first_name: ban.first_name || undefined,
        last_name: ban.last_name || undefined,
        reason: ban.reason || '',
        banned_at: ban.banned_at,
        banned_by: ban.banned_by,
        is_permanent: !ban.until,
        expires_at: ban.until || null,
        until: ban.until || null
      }))

      // Добавляем blocked users (если они не в manual bans)
      const blockedTgIds = new Set(bannedList.map(b => b.tg_id))
      blockedUsers.forEach((blocked: any) => {
        if (!blockedTgIds.has(blocked.tg_id)) {
          bannedList.push({
            tg_id: blocked.tg_id,
            username: blocked.username || undefined,
            first_name: blocked.first_name || undefined,
            last_name: blocked.last_name || undefined,
            reason: 'Заблокировал бота',
            // blocked-users historically may not have a reliable ban date, so don't fake it.
            banned_at: (blocked.banned_at || blocked.blocked_at) ?? null,
            is_permanent: true,
            expires_at: null
          })
        }
      })

      // Сортируем: свежие сверху
      bannedList.sort((a, b) => {
        const av = a.banned_at ? new Date(a.banned_at as any).getTime() : 0
        const bv = b.banned_at ? new Date(b.banned_at as any).getTime() : 0
        return bv - av
      })

      setBannedUsers(bannedList)
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки банов')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDeleteKey = useCallback(async (key: Key) => {
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        return
      }

      if (!key.email) {
        setError('Не удалось определить email ключа')
        return
      }

      await deleteBotKeyByEmail(config, key.email)
      await loadKeys()
      setDeleteConfirm({ isOpen: false, user: null, key: null })
    } catch (err: any) {
      setError(err.message || 'Ошибка удаления ключа')
      setDeleteConfirm({ isOpen: false, user: null, key: null })
    }
  }, [loadKeys])

  const handleUnbanUser = useCallback(async (user: BannedUser) => {
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        return
      }

      // Пытаемся удалить из manual-bans, если не получится - из blocked-users
      try {
        await deleteBotManualBan(config, user.tg_id)
      } catch {
        await deleteBotBlockedUser(config, user.tg_id)
      }

      await loadBannedUsers()
      await loadBannedUsersForCounter() // Обновляем счетчик
      setDeleteConfirm({ isOpen: false, user: null, key: null })
    } catch (err: any) {
      setError(err.message || 'Ошибка разбана пользователя')
      setDeleteConfirm({ isOpen: false, user: null, key: null })
    }
  }, [loadBannedUsers, loadBannedUsersForCounter])

  const SOURCE_NONE = '__none__'

  const getUserSourceCode = useCallback((user: User): string => {
    return String((user as any)?.source_code ?? (user as any)?.sourceCode ?? (user as any)?.source ?? '').trim()
  }, [])

  const classifySourceCode = useCallback((rawCode: string): { label: string; code?: string; tone: 'none' | 'code' } => {
    const raw = String(rawCode || '').trim()
    if (!raw) return { label: 'Start (без метки)', tone: 'none' }

    const lower = raw.toLowerCase()
    // Common start payload prefixes we generate/use in the panel/bot
    if (lower.startsWith('gift_')) return { label: 'Подарок', code: raw, tone: 'code' }
    if (lower.startsWith('ref_') || lower.startsWith('referral_')) return { label: 'Рефералка', code: raw, tone: 'code' }
    if (lower.startsWith('invite_') || lower.startsWith('inv_')) return { label: 'Приглашение', code: raw, tone: 'code' }

    // Default: UTM/source code
    return { label: 'UTM / источник', code: raw, tone: 'code' }
  }, [])

  const formatUserSource = useCallback((user: User): { label: string; code?: string; tone: 'none' | 'code' } => {
    return classifySourceCode(getUserSourceCode(user))
  }, [classifySourceCode, getUserSourceCode])

  // Main data loading effect - MUST be after function definitions
  useEffect(() => {
    loadBannedUsersForCounter()
    
    if (viewMode === 'users') {
      loadUsers()
    } else if (viewMode === 'keys') {
      loadKeys()
    } else if (viewMode === 'banned') {
      loadBannedUsers()
    }
  }, [viewMode, currentPage, pageSize, sourceFilter, selectedTariff, loadUsers, loadKeys, loadBannedUsers, loadBannedUsersForCounter])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, sourceFilter, selectedTariff])

  const sourceOptions = useMemo(() => {
    const sourcesArr: any[] = Array.isArray(trackingSources) ? trackingSources : []
    const byCode = new Map<string, any>()
    for (const s of sourcesArr) {
      const code = String((s as any)?.code || '').trim()
      if (!code) continue
      byCode.set(code, s)
    }

    const usedCodes = new Set<string>()
    for (const u of users) {
      const code = getUserSourceCode(u)
      if (code) usedCodes.add(code)
    }

    const utmCodes = Array.from(byCode.keys()).sort((a, b) => a.localeCompare(b))
    const missingCodes = Array.from(usedCodes)
      .filter((c) => !byCode.has(c))
      .sort((a, b) => a.localeCompare(b))

    const utmOptions = utmCodes.map((code) => {
      const s = byCode.get(code)
      const name = String((s as any)?.name || '').trim()
      return { value: code, label: name ? `${name} (${code})` : code, group: 'UTM / источники' }
    })

    // If a tracking-source was deleted, users can still have source_code.
    // We still show it under "UTM / источники" and mark as "(удалена)".
    const missingUtmOptions = missingCodes
      .filter((code) => classifySourceCode(code).label === 'UTM / источник')
      .map((code) => ({
        value: code,
        label: `${code} (удалена)`,
        group: 'UTM / источники',
      }))

    const otherOptions = missingCodes
      .filter((code) => classifySourceCode(code).label !== 'UTM / источник')
      .map((code) => {
        const cls = classifySourceCode(code)
        return { value: code, label: `${cls.label} (${code})`, group: 'Прочее' }
      })

    return [
      { value: 'all', label: 'Все источники' },
      { value: SOURCE_NONE, label: 'Start (без метки)', group: 'Базовое' },
      ...utmOptions,
      ...missingUtmOptions,
      ...otherOptions,
    ] as Array<{ value: string; label: string; group?: string }>
  }, [trackingSources, users, getUserSourceCode, classifySourceCode])

  // Фильтрация и поиск пользователей
  const filteredUsers = useMemo(() => {
    const parseCreatedAtMs = (u: User): number => {
      const raw: any = (u as any).created_at ?? (u as any).createdAt ?? (u as any).created ?? null
      if (!raw) return 0
      if (typeof raw === 'number') {
        return raw < 10_000_000_000 ? raw * 1000 : raw
      }
      if (typeof raw === 'string') {
        const s = raw.trim()
        if (!s) return 0
        // numeric string timestamps
        if (/^\d+$/.test(s)) {
          const n = Number(s)
          return n < 10_000_000_000 ? n * 1000 : n
        }
        // ISO without TZ is treated as UTC by backend; keep consistent by appending Z if no tz
        const hasTz = /z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)
        const normalized = s.includes('T') ? s : s.replace(' ', 'T')
        const d = new Date(hasTz ? normalized : `${normalized}Z`)
        const t = d.getTime()
        return Number.isNaN(t) ? 0 : t
      }
      const d = new Date(raw)
      const t = d.getTime()
      return Number.isNaN(t) ? 0 : t
    }

    // Server-side source filter is already applied, just filter by search locally if needed
    const base = (() => {
      if (!searchQuery.trim()) return users
      const query = searchQuery.toLowerCase().trim()
      return users.filter(user => {
        const tgId = String(user.tg_id || '').toLowerCase()
        const username = (user.username || '').toLowerCase()
        const firstName = (user.first_name || '').toLowerCase()
        const lastName = (user.last_name || '').toLowerCase()
        
        return tgId.includes(query) || 
               username.includes(query) || 
               firstName.includes(query) || 
               lastName.includes(query)
      })
    })()

    const sorted = [...base].sort((a, b) => {
      const av = parseCreatedAtMs(a)
      const bv = parseCreatedAtMs(b)
      return usersSortDir === 'desc' ? (bv - av) : (av - bv)
    })
    return sorted
  }, [users, searchQuery, usersSortDir])

  // Фильтрация и поиск забаненных пользователей
  const filteredBannedUsers = useMemo(() => {
    if (!searchQuery.trim()) return bannedUsers
    
    const query = searchQuery.toLowerCase()
    return bannedUsers.filter(user => 
      user.tg_id.toString().includes(query) ||
      user.username?.toLowerCase().includes(query) ||
      user.first_name?.toLowerCase().includes(query) ||
      user.last_name?.toLowerCase().includes(query) ||
      user.reason?.toLowerCase().includes(query)
    )
  }, [bannedUsers, searchQuery])

  // Группировка тарифов
  const groupedTariffs = useMemo(() => {
    const groups: Record<string, any[]> = {}
    
    tariffs.forEach((tariff) => {
      const group = tariff.group_code || tariff.group || tariff.subgroup || tariff.category || 'Без группы'
      if (!groups[group]) {
        groups[group] = []
      }
      groups[group].push(tariff)
    })
    
    // Сортируем группы и тарифы внутри групп
    const sortedGroups: Record<string, any[]> = {}
    Object.keys(groups).sort().forEach(key => {
      sortedGroups[key] = groups[key].sort((a, b) => {
        const nameA = (a.name || a.tariff_name || '').toLowerCase()
        const nameB = (b.name || b.tariff_name || '').toLowerCase()
        return nameA.localeCompare(nameB)
      })
    })
    
    return sortedGroups
  }, [tariffs])

  // Фильтрация и поиск подписок
  const filteredKeys = useMemo(() => {
    let result = keys

    // Фильтр по тарифу
    if (selectedTariff !== 'all') {
      if (selectedTariff === 'no_tariff') {
        // Фильтр "без тарифа" - показываем только те, у которых нет тарифа
        result = result.filter(key => {
          const hasTariffId = key.tariff_id || key.tariffId
          const hasTariffName = key.tariff_name && key.tariff_name.trim() !== ''
          return !hasTariffId && !hasTariffName
        })
      } else {
        result = result.filter(key => {
          const tariffId = String(key.tariff_id || key.tariffId || '')
          const tariffName = (key.tariff_name || '').toLowerCase()
          return tariffId === selectedTariff || tariffName === selectedTariff.toLowerCase()
        })
      }
    }

    // Поиск
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter(key => {
        const name = (key.name || key.email || '').toLowerCase()
        const email = (key.email || '').toLowerCase()
        const tgId = String(key.tg_id || '').toLowerCase()
        const tariff = (key.tariff_name || '').toLowerCase()
        const server = (key.server_name || key.cluster_name || key.server_id || key.cluster_id || '').toLowerCase()
        
        return name.includes(query) || 
               email.includes(query) || 
               tgId.includes(query) ||
               tariff.includes(query) ||
               server.includes(query)
      })
    }

    return result
  }, [keys, searchQuery, selectedTariff])

  // Пагинация
  const currentData = viewMode === 'users' ? filteredUsers : (viewMode === 'keys' ? filteredKeys : filteredBannedUsers)
  const totalPages = viewMode === 'banned' ? Math.ceil(currentData.length / pageSize) : remoteTotalPages
  const paginatedData = useMemo(() => {
    // users/keys already paginated server-side
    if (viewMode !== 'banned') return currentData
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    return currentData.slice(start, end)
  }, [currentData, currentPage, pageSize])

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }, [totalPages])

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    setSearchQuery('')
    setSelectedTariff('all')
    setSourceFilter('all')
    setCurrentPage(1)
  }, [])

  const formatDate = (dateString?: string | Date | number) => {
    if (!dateString) return '-'
    return formatMskDateTime(dateString)
  }

  const formatDateForBans = (date: string | Date | number | undefined | null) => {
    if (!date) return '-'
    return formatMskDateTimeShort(date)
  }

  const formatBytes = (bytes: number | null | undefined): string => {
    const b = Number(bytes ?? 0)
    if (!Number.isFinite(b) || b <= 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(b) / Math.log(k)))
    const v = b / Math.pow(k, i)
    return `${v.toFixed(v >= 10 ? 1 : 2)} ${sizes[i]}`
  }

  const normalizeCountryCode = (raw: unknown): string | null => {
    const s = String(raw || '').trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(s)) return s
    return null
  }

  const inferCountryCodeFromText = (raw: unknown): string | null => {
    const s0 = String(raw || '').trim()
    if (!s0) return null
    const s = s0.toUpperCase()
    const m = s.match(/\b([A-Z]{2})\b/)
    if (m?.[1] && /^[A-Z]{2}$/.test(m[1])) return m[1]
    const map: Record<string, string> = {
      POLAND: 'PL',
      GERMANY: 'DE',
      LATVIA: 'LV',
      NETHERLANDS: 'NL',
      HOLLAND: 'NL',
      ALBANIA: 'AL',
      USA: 'US',
      'UNITED STATES': 'US',
      RUSSIA: 'RU',
      MOSCOW: 'RU',
      MSK: 'RU',
      SPB: 'RU',
      'SAINT PETERSBURG': 'RU',
      PETERSBURG: 'RU',
      YANDEX: 'RU',
    }
    for (const key of Object.keys(map)) {
      if (s.includes(key)) return map[key]
    }
    return null
  }

  const getFlagComponent = (countryCode: string | null) => {
    if (!countryCode) return null
    const flagName = countryCode.toUpperCase() as keyof typeof Flags
    return (Flags as any)[flagName] as (React.ComponentType<{ className?: string; style?: React.CSSProperties }> | undefined)
  }

  const getKeyStatus = (key: Key) => {
    if (!key.expiry_time) return { text: 'Неизвестно', class: 'bg-overlay-sm text-muted' }
    
    let expiry: Date
    if (typeof key.expiry_time === 'string') {
      expiry = new Date(key.expiry_time)
    } else if (typeof key.expiry_time === 'number') {
      // Определяем секунды или миллисекунды
      if (key.expiry_time < 10000000000) {
        expiry = new Date(key.expiry_time * 1000)
      } else {
        expiry = new Date(key.expiry_time)
      }
    } else {
      expiry = new Date(key.expiry_time)
    }
    
    // Проверяем валидность даты
    if (isNaN(expiry.getTime())) {
      return { text: 'Неизвестно', class: 'bg-overlay-sm text-muted' }
    }
    
    // Проверяем, что дата разумная
    const year = expiry.getFullYear()
    if (year < 1970 || year > 2100) {
      return { text: 'Неизвестно', class: 'bg-overlay-sm text-muted' }
    }
    
    const now = new Date()
    if (expiry < now) {
      return { text: 'Истек', class: 'bg-red-500/20 text-red-400' }
    }
    if (key.status === 'frozen' || key.status === 'заморожен') {
      return { text: 'Заморожен', class: 'bg-amber-500/20 text-amber-400' }
    }
    return { text: 'Активен', class: 'bg-accent-20 text-[var(--accent)]' }
  }

  const ONLINE_WINDOW_MS = 30_000 // 30 секунд - считается онлайн
  const rmwInFlightRef = useRef<Set<string>>(new Set())
  const rmwAutoIntervalRef = useRef<number | null>(null)

  const [rmwRefreshing, setRmwRefreshing] = useState(false)
  const [rmwSecondsToRefresh, setRmwSecondsToRefresh] = useState<number>(30)
  const rmwNextRefreshAtRef = useRef<number>(Date.now() + 30_000)

  const formatMskDateTimeCompact = useCallback((value: any): string => {
    if (value === null || value === undefined || value === '') return '—'
    // Handle unix ms timestamps that can come as number or numeric string
    const raw = typeof value === 'string' ? value.trim() : value
    const ms =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d+$/.test(raw)
          ? Number(raw)
          : raw
    const dt = new Date(ms as any)
    if (!Number.isFinite(dt.getTime())) return '—'
    try {
      // DD.MM.YY HH:mm (MSK)
      return dt.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).replace(',', '')
    } catch {
      return '—'
    }
  }, [])

  const formatTimeAgoRu = useCallback((msAgo: number): string => {
    const sec = Math.max(0, Math.floor(msAgo / 1000))
    if (sec < 60) return 'несколько секунд назад'
    const min = Math.floor(sec / 60)
    if (min < 60) {
      if (min === 1) return 'минуту назад'
      if (min % 10 === 1 && min % 100 !== 11) return `${min} минуту назад`
      if ([2, 3, 4].includes(min % 10) && ![12, 13, 14].includes(min % 100)) return `${min} минуты назад`
      return `${min} минут назад`
    }
    const hr = Math.floor(min / 60)
    if (hr < 24) {
      if (hr === 1) return 'час назад'
      if ([2, 3, 4].includes(hr % 10) && ![12, 13, 14].includes(hr % 100)) return `${hr} часа назад`
      return `${hr} часов назад`
    }
    const days = Math.floor(hr / 24)
    if (days < 30) {
      if (days === 1) return 'день назад'
      if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) return `${days} дня назад`
      return `${days} дней назад`
    }
    const months = Math.floor(days / 30)
    if (months < 12) {
      if (months === 1) return 'месяц назад'
      if ([2, 3, 4].includes(months % 10) && ![12, 13, 14].includes(months % 100)) return `${months} месяца назад`
      return `${months} месяцев назад`
    }
    const years = Math.floor(months / 12)
    if (years === 1) return 'год назад'
    if ([2, 3, 4].includes(years % 10) && ![12, 13, 14].includes(years % 100)) return `${years} года назад`
    return `${years} лет назад`
  }, [])

  // Оффлайн: без "больше/более" и без секунд (кроме фиксированного "30 сек назад" для < 1 минуты)
  const formatOfflineAgoRu = useCallback((msAgo: number): string => {
    const sec = Math.max(0, Math.floor(msAgo / 1000))
    // мы считаем online до 30 секунд, поэтому оффлайн < 60с показываем без "больше/более"
    if (sec < 60) return '30 сек назад'
    const min = Math.floor(sec / 60)
    if (min < 2) return 'минуту назад'
    // дальше уже нормально читается
    return formatTimeAgoRu(msAgo)
  }, [formatTimeAgoRu])

  const paginatedKeys = useMemo(() => {
    if (viewMode !== 'keys') return [] as Key[]
    return (paginatedData as Key[]) || []
  }, [viewMode, paginatedData])

  const refreshRemnawaveNow = useCallback(async () => {
    if (viewMode !== 'keys') return
    if (!rmwEnabled) return
    const profileId = rmwProfileId
    if (!profileId) return

    const startIdx = (currentPage - 1) * pageSize
    const prefetchEnd = Math.min(startIdx + pageSize * 3, currentData.length)
    const names = Array.from(
      new Set(
        (currentData as Key[])
          .slice(startIdx, prefetchEnd)
          .map((k) => String((k as any)?.name ?? (k as any)?.email ?? '').trim())
          .filter(Boolean),
      ),
    )

    // Always refresh current page names at minimum
    const pageNames = Array.from(
      new Set(
        paginatedKeys
          .map((k) => String((k as any)?.name ?? (k as any)?.email ?? '').trim())
          .filter(Boolean),
      ),
    )
    const allNames = Array.from(new Set([...pageNames, ...names]))
    if (allNames.length === 0) return

    setRmwRefreshing(true)
    rmwInFlightRef.current = new Set(allNames)
    try {
      const map = await getRemnawaveUsersBulkByIdentifier(profileId, allNames, { force: true })
      setRmwUsersByName((prev) => {
        const next = { ...prev }
        for (const name of allNames) {
          next[name] = { user: map[name] ?? null, fetchedAt: Date.now() }
        }
        return next
      })
    } finally {
      setRmwRefreshing(false)
      rmwInFlightRef.current = new Set()
      rmwNextRefreshAtRef.current = Date.now() + 30_000
      setRmwSecondsToRefresh(30)
    }
  }, [viewMode, rmwEnabled, rmwProfileId, currentPage, pageSize, currentData, paginatedKeys])

  // Detect whether Remnawave is configured for current active bot profile.
  useEffect(() => {
    if (viewMode !== 'keys') return
    let cancelled = false
    setRmwChecking(true)
    ;(async () => {
      try {
        const botProfiles = await getBotProfiles()
        const activeIdRaw = botProfiles?.activeProfileId
        const activeId = activeIdRaw ? String(activeIdRaw) : ''
        if (!activeId) {
          if (!cancelled) {
            setRmwEnabled(false)
            setRmwChecking(false)
            setRmwProfileId(undefined)
            setRmwNodesByUuid({})
            setRmwUsersByName({})
          }
          return
        }

        const all = await getAllRemnawaveSettings()
        const perProfile = Array.isArray(all?.profiles) ? all.profiles : []
        const activeSettings = perProfile.find((p: any) => String(p?.profileId || '') === activeId)?.settings
        const baseUrl =
          String((activeSettings as any)?.base_url || (activeSettings as any)?.baseUrl || '').trim() ||
          String((all as any)?.global?.base_url || (all as any)?.global?.baseUrl || '').trim()
        const configured = baseUrl.length > 0

        if (cancelled) return
        setRmwProfileId(activeId)
        setRmwEnabled(Boolean(configured))
        setRmwChecking(false)
        setRmwUsersByName({})

        if (!configured) {
          setRmwNodesByUuid({})
          return
        }

        const rawNodes = await getRemnawaveNodes(activeId).catch(() => [] as any)
        const nodesArr: any[] =
          Array.isArray(rawNodes) ? rawNodes
            : Array.isArray((rawNodes as any)?.response) ? (rawNodes as any).response
            : Array.isArray((rawNodes as any)?.nodes) ? (rawNodes as any).nodes
            : Array.isArray((rawNodes as any)?.data) ? (rawNodes as any).data
            : []

        const map: Record<string, { name: string; countryCode: string | null }> = {}
        for (const n of nodesArr) {
          const uuid = String((n as any)?.uuid || (n as any)?.id || '').trim()
          if (!uuid) continue
          const name = String((n as any)?.name || (n as any)?.nodeName || (n as any)?.node_name || uuid).trim()
          const cc =
            normalizeCountryCode((n as any)?.country_code) ??
            normalizeCountryCode((n as any)?.countryCode) ??
            normalizeCountryCode((n as any)?.country) ??
            inferCountryCodeFromText((n as any)?.country) ??
            inferCountryCodeFromText((n as any)?.location) ??
            inferCountryCodeFromText((n as any)?.name)
          map[uuid] = { name, countryCode: cc }
        }
        if (!cancelled) setRmwNodesByUuid(map)
      } catch {
        if (!cancelled) {
          setRmwEnabled(false)
          setRmwChecking(false)
          setRmwProfileId(undefined)
          setRmwNodesByUuid({})
          setRmwUsersByName({})
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [viewMode])

  // Fetch Remnawave user info for visible subscriptions + prefetch next pages.
  // Optimized: high concurrency, all requests in parallel, prefetch ahead.
  useEffect(() => {
    if (viewMode !== 'keys') return
    if (!rmwEnabled) return
    const profileId = rmwProfileId
    if (!profileId) return

    // Get names for current page
    const currentPageNames = Array.from(
      new Set(
        paginatedKeys
          .map((k) => String((k as any)?.name ?? (k as any)?.email ?? '').trim())
          .filter(Boolean),
      ),
    )

    // Prefetch: also get names for next 2 pages worth of data
    const startIdx = (currentPage - 1) * pageSize
    const prefetchEnd = Math.min(startIdx + pageSize * 3, currentData.length) // current + 2 next pages
    const prefetchNames = Array.from(
      new Set(
        (currentData as Key[])
          .slice(startIdx, prefetchEnd)
          .map((k) => String((k as any)?.name ?? (k as any)?.email ?? '').trim())
          .filter(Boolean),
      ),
    )

    const allNames = Array.from(new Set([...currentPageNames, ...prefetchNames]))
    const missing = allNames.filter((n) => !(n in rmwUsersByName) && !rmwInFlightRef.current.has(n))
    if (missing.length === 0) return

    let cancelled = false
    ;(async () => {
      // Mark in-flight (single backend call)
      missing.forEach((n) => rmwInFlightRef.current.add(n))
      try {
        const map = await getRemnawaveUsersBulkByIdentifier(profileId, missing)
        if (cancelled) return
        setRmwUsersByName((prev) => {
          const next = { ...prev }
          for (const name of missing) {
            next[name] = { user: map[name] ?? null, fetchedAt: Date.now() }
          }
          return next
        })
      } catch {
        if (cancelled) return
        setRmwUsersByName((prev) => {
          const next = { ...prev }
          for (const name of missing) {
            next[name] = { user: null, fetchedAt: Date.now() }
          }
          return next
        })
      } finally {
        missing.forEach((n) => rmwInFlightRef.current.delete(n))
      }
    })()

    return () => {
      cancelled = true
      // Safety: clear in-flight markers for this run
      missing.forEach((n) => rmwInFlightRef.current.delete(n))
    }
  }, [viewMode, rmwEnabled, rmwProfileId, paginatedKeys, currentPage, pageSize, currentData])

  // Auto refresh timer (only on Subscriptions tab)
  useEffect(() => {
    if (rmwAutoIntervalRef.current) {
      window.clearInterval(rmwAutoIntervalRef.current)
      rmwAutoIntervalRef.current = null
    }
    if (viewMode !== 'keys' || !rmwEnabled) return

    rmwNextRefreshAtRef.current = Date.now() + 30_000
    setRmwSecondsToRefresh(30)

    rmwAutoIntervalRef.current = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((rmwNextRefreshAtRef.current - Date.now()) / 1000))
      setRmwSecondsToRefresh(left)
      if (left === 0 && !rmwRefreshing) {
        // fire and forget
        refreshRemnawaveNow()
      }
    }, 1000)

    return () => {
      if (rmwAutoIntervalRef.current) {
        window.clearInterval(rmwAutoIntervalRef.current)
        rmwAutoIntervalRef.current = null
      }
    }
  }, [viewMode, rmwEnabled, rmwRefreshing, refreshRemnawaveNow])

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize)
    setCurrentPage(1)
  }, [])

  const pageSizeGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: '10', label: '10' },
          { value: '25', label: '25' },
          { value: '50', label: '50' },
          { value: '100', label: '100' },
          { value: '200', label: '200' },
        ],
      },
    ],
    [],
  )

  const sourceSelectGroups = useMemo<DarkSelectGroup[]>(() => {
    const base: any[] = []
    const byGroup = new Map<string, any[]>()
    for (const o of sourceOptions || []) {
      if (!o) continue
      if (o.group) {
        if (!byGroup.has(o.group)) byGroup.set(o.group, [])
        byGroup.get(o.group)!.push({ value: o.value, label: o.label })
      } else {
        base.push({ value: o.value, label: o.label })
      }
    }
    const order = ['Базовое', 'UTM / источники', 'Прочее']
    const groups: DarkSelectGroup[] = []
    if (base.length > 0) groups.push({ options: base })
    order.forEach((name) => {
      const opts = byGroup.get(name) || []
      if (opts.length > 0) groups.push({ groupLabel: name, options: opts })
      byGroup.delete(name)
    })
    Array.from(byGroup.keys())
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        const opts = byGroup.get(name) || []
        if (opts.length > 0) groups.push({ groupLabel: name, options: opts })
      })
    return groups
  }, [sourceOptions])

  const tariffSelectGroups = useMemo<DarkSelectGroup[]>(() => {
    const groups: DarkSelectGroup[] = [
      {
        options: [
          { value: 'all', label: 'Все тарифы' },
          { value: 'no_tariff', label: <span className="text-red-300">Без тарифа</span> },
        ],
      },
    ]
    Object.entries(groupedTariffs || {}).forEach(([groupName, groupTariffs]) => {
      const options = (groupTariffs || []).map((tariff: any) => {
        const id = tariff.id || tariff.tariff_id
        const label = tariff.name || tariff.tariff_name || `Тариф ${id}`
        return { value: String(id), label }
      })
      if (options.length > 0) groups.push({ groupLabel: groupName, options })
    })
    return groups
  }, [groupedTariffs])

  const Pagination = useMemo(() => {
    const PaginationComponent = () => (
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 my-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Показать:</span>
          <div className="min-w-[110px]">
            <DarkSelect
              value={String(pageSize)}
              onChange={(v) => handlePageSizeChange(Number(v))}
              groups={pageSizeGroups}
              buttonClassName="filter-field"
            />
          </div>
          <span className="text-xs text-muted">
            из {viewMode === 'banned' ? currentData.length : remoteTotal}
          </span>
        </div>
        
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-4 py-2.5 min-h-[44px] rounded-lg transition-colors border border-default bg-overlay-md text-primary hover:bg-overlay-sm disabled:opacity-50 disabled:cursor-not-allowed text-sm touch-manipulation active:opacity-70"
          >
            Назад
          </button>
          <span className="text-xs sm:text-sm text-muted">
            Страница {currentPage} из {totalPages || 1}
          </span>
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-4 py-2.5 min-h-[44px] rounded-lg transition-colors border border-default bg-overlay-md text-primary hover:bg-overlay-sm disabled:opacity-50 disabled:cursor-not-allowed text-sm touch-manipulation active:opacity-70"
          >
            Вперед
          </button>
        </div>
      </div>
    )
    return PaginationComponent
  }, [pageSize, currentPage, totalPages, currentData.length, handlePageChange, handlePageSizeChange, pageSizeGroups, remoteTotal, viewMode])

  return (
    <>
      {/* Page wrapper (фон страницы, без отдельной "панели" поверх) */}
      <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">
        {/* Remnawave refresh controls are rendered inside the table header for better alignment */}

        {error && (
          <div className="mb-3">
            <GradientAlert
              variant="error"
              title="Ошибка"
              description={
                missingProfile ? (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <span>{error}</span>
                    <OpenPanelSettingsButton className="sm:flex-shrink-0" />
                  </div>
                ) : (
                  error
                )
              }
              onClose={() => setError(null)}
            />
          </div>
        )}

        {/* Заголовок страницы */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-primary">{viewMode === 'keys' ? 'Подписки' : 'Пользователи'}</h1>
            {showTabs && (
              <GlassTabs
                tabs={[
                  { id: 'users', label: 'Пользователи' },
                  { id: 'keys', label: 'Подписки' },
                ]}
                activeTab={viewMode === 'banned' ? '' : viewMode}
                onTabChange={(tabId) => handleViewModeChange(tabId as ViewMode)}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            {viewMode === 'keys' && rmwEnabled && (
              <div className="flex items-center gap-2">
                <button className="card-btn" type="button" onClick={() => refreshRemnawaveNow()} disabled={rmwRefreshing}>
                  {rmwRefreshing ? 'Обновляю…' : 'Обновить'}
                </button>
                <span className="text-sm text-muted">
                  Через: <span style={{ fontWeight: 600 }}>
                    {String(Math.floor(rmwSecondsToRefresh / 60)).padStart(2, '0')}:{String(rmwSecondsToRefresh % 60).padStart(2, '0')}
                  </span>
                </span>
              </div>
            )}
            {viewMode !== 'keys' && (
              <button
                type="button"
                onClick={() => handleViewModeChange('banned')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-95"
                style={{ backgroundColor: '#ef4444' }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                </svg>
                Забаненные{bannedCount > 0 ? ` (${bannedCount})` : ''}
              </button>
            )}
          </div>
        </div>

        {/* Фильтры и поиск */}
        <div className="glass-panel p-3 sm:p-4 mb-2 sm:mb-3">
          <div className="flex flex-col gap-2">
            {/* Фильтр по источнику (только для пользователей) */}
            {viewMode === 'users' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                <label className="text-xs text-muted">Откуда пришел:</label>
                <div className="w-full sm:min-w-[220px] sm:max-w-[420px]">
                  <DarkSelect
                    value={sourceFilter}
                    onChange={(v) => {
                      setSourceFilter(v)
                      setCurrentPage(1)
                    }}
                    groups={sourceSelectGroups}
                    buttonClassName="filter-field"
                  />
                </div>
              </div>
            )}

            {/* Фильтр по тарифам (только для подписок) */}
            {viewMode === 'keys' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                <label className="text-xs text-muted">Фильтр по тарифу:</label>
                <div className="w-full sm:min-w-[200px] sm:max-w-[300px]">
                  <DarkSelect
                    value={selectedTariff}
                    onChange={(v) => {
                      setSelectedTariff(v)
                      setCurrentPage(1)
                    }}
                    groups={tariffSelectGroups}
                    buttonClassName="filter-field"
                  />
                </div>
              </div>
            )}

            {/* Поиск */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              placeholder={
                viewMode === 'users'
                  ? 'Поиск по ID или имени пользователя...'
                  : viewMode === 'keys'
                  ? 'Поиск по названию, email, TG ID, тарифу, серверу...'
                  : 'Поиск по TG ID, имени, причине...'
              }
              className="filter-field"
            />
          </div>
        </div>

        {/* Пагинация сверху */}
        {currentData.length > 0 && <Pagination />}

        {/* Таблица пользователей или подписок */}
        {loading ? (
          <div className="glass-panel p-3 mt-2">
            <CapybaraLoader />
          </div>
        ) : currentData.length === 0 ? (
          <div className="glass-panel p-3 mt-2">
            <p className="text-muted text-center py-6 text-xs">
              {searchQuery 
                ? 'Ничего не найдено' 
                : viewMode === 'users' ? 'Нет пользователей' 
                : viewMode === 'keys' ? 'Нет подписок'
                : 'Нет забаненных пользователей'}
            </p>
          </div>
        ) : viewMode === 'banned' ? (
          <div className="tab-content-enter">
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Причина</th>
                    <th>Срок</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {(paginatedData as BannedUser[]).map((user) => {
                    const endText = user.is_permanent ? 'Навсегда' : user.expires_at ? formatDateForBans(user.expires_at) : '—'
                    const badge = user.is_permanent ? 'failed' : user.expires_at ? 'pending' : 'processing'
                    return (
                      <tr key={user.tg_id}>
                        <td>
                          <div className="table-user">
                            <div className="table-user-info">
                              <span className="table-user-name">{user.username ? `@${user.username}` : `TG ${user.tg_id}`}</span>
                              <span className="table-user-email inline-flex items-center gap-2">
                                <span className="text-dim">TG</span>
                                <CopyText
                                  text={String(user.tg_id)}
                                  showToast={false}
                                  className="inline-flex items-center gap-1 text-[12px] font-mono text-secondary hover:text-primary transition-colors"
                                />
                              </span>
                            </div>
                          </div>
                        </td>
                        <td title={user.reason}>{user.reason || '—'}</td>
                        <td>
                          <span className={`status-badge ${badge}`}>{endText}</span>
                        </td>
                        <td>
                          <button
                            className="card-btn danger"
                            type="button"
                            onClick={() => setDeleteConfirm({ isOpen: true, user, key: null })}
                          >
                            Разбанить
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            
            <Pagination />
          </div>
        ) : viewMode === 'users' ? (
          <div className="tab-content-enter">
            <div className="table-wrapper">
              <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '35%' }} />
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '15%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Источник</th>
                    <th>
                      <button
                        type="button"
                        className="card-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setUsersSortDir(usersSortDir === 'desc' ? 'asc' : 'desc')
                        }}
                        title="Сортировать по дате регистрации"
                      >
                        Регистрация {usersSortDir === 'desc' ? '▼' : '▲'}
                      </button>
                    </th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {(paginatedData as User[]).map((user) => {
                    const src = formatUserSource(user)
                    const sourceKey = src.code || src.label
                    const srcStyle = getProviderColor(sourceKey)
                    return (
                      <tr key={user.tg_id} onClick={() => setSelectedUser(user.tg_id)} style={{ cursor: 'pointer' }}>
                        <td>
                          <div className="table-user">
                            <div className="table-user-info">
                              <span className="table-user-name">{user.username ? `@${user.username}` : `TG ${user.tg_id}`}</span>
                              <span className="table-user-email inline-flex items-center gap-2">
                                <span className="text-dim">TG</span>
                                <CopyText
                                  text={String(user.tg_id)}
                                  showToast={false}
                                  className="inline-flex items-center gap-1 text-[12px] font-mono text-secondary hover:text-primary transition-colors"
                                />
                                {user.first_name || user.last_name
                                  ? ` • ${String(`${user.first_name || ''} ${user.last_name || ''}`).trim()}`
                                  : ''}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td style={{ overflow: 'hidden' }}>
                          <span
                            className="status-badge source-badge"
                            title={src.code || src.label}
                            style={{ background: srcStyle.bg, color: srcStyle.color, ['--badge-dot' as any]: srcStyle.dot, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
                          >
                            {src.code
                              ? <span className="font-mono">{src.code}</span>
                              : src.label
                            }
                          </span>
                        </td>
                        <td>{formatDate(user.created_at)}</td>
                        <td>
                          <button
                            className="card-btn card-btn-details"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedUser(user.tg_id)
                            }}
                          >
                            Подробнее
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Pagination />
          </div>
        ) : (
          <>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Тариф</th>
                    <th>Сервер</th>
                    <th>Статус</th>
                    <th>Действует до</th>
                    {(rmwEnabled || rmwChecking) ? <th>Трафик</th> : null}
                    {(rmwEnabled || rmwChecking) ? <th>Онлайн / Нода</th> : null}
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {(paginatedData as Key[]).map((key, index) => {
                    const status = getKeyStatus(key)
                    const statusBadge =
                      String(status.text || '').includes('Истек') ? 'failed' : String(status.text || '').includes('Скоро') ? 'pending' : 'completed'
                    // Получаем тариф из обогащенных данных или из исходных
                    const tariffName = key.tariff_name || 
                                      (key.tariff_id ? tariffs.find(t => (t.id || t.tariff_id) === key.tariff_id)?.name : null) ||
                                      (key.tariffId ? tariffs.find(t => (t.id || t.tariff_id) === key.tariffId)?.name : null) ||
                                      '-'
                    // Получаем сервер/кластер
                    const serverName = key.server_name || 
                                      key.cluster_name || 
                                      key.server_id || 
                                      key.cluster_id || 
                                      '-'

                    // Remnawave enrichment (by key.name)
                    const keyNameForRmw = String((key as any)?.name ?? (key as any)?.email ?? '').trim()
                    const rmwEntry = rmwEnabled && keyNameForRmw ? rmwUsersByName[keyNameForRmw] : undefined
                    const rmwUser: any | null | undefined = rmwEntry ? rmwEntry.user : undefined
                    const onlineAt = rmwUser?.onlineAt ?? null
                    const onlineAtMs = onlineAt ? new Date(String(onlineAt)).getTime() : Number.NaN
                    const onlineAgoMs = Number.isFinite(onlineAtMs) ? (Date.now() - onlineAtMs) : Number.NaN
                    const isOnline = Number.isFinite(onlineAgoMs) && onlineAgoMs <= ONLINE_WINDOW_MS
                    const lastNodeUuid = String(rmwUser?.lastConnectedNodeUuid || '').trim()
                    const node = lastNodeUuid ? rmwNodesByUuid[lastNodeUuid] : undefined
                    const nodeName = (node?.name || '').trim() || (lastNodeUuid ? `${lastNodeUuid.slice(0, 8)}…` : '—')
                    const nodeCc = node?.countryCode ?? inferCountryCodeFromText(nodeName)
                    const FlagComponent = getFlagComponent(nodeCc)
                    const trafficUsedText = rmwUser ? formatBytes(rmwUser.usedTrafficBytes) : ''
                    const trafficTotalText = rmwUser ? (rmwUser.trafficLimitBytes ? formatBytes(rmwUser.trafficLimitBytes) : '∞') : ''

                    // Чередование цветов + явный разделитель как на вкладке "Пользователи"

                    // Контент для Remnawave колонок
                    const rmwLoading = (rmwChecking || (rmwEnabled && keyNameForRmw && !rmwEntry))
                    const rmwNoData = rmwEnabled && keyNameForRmw && rmwEntry && rmwEntry.user === null
                    const rmwNeverConnected = rmwEnabled && keyNameForRmw && rmwEntry && rmwEntry.user && !onlineAt

                    return (
                      <Fragment key={key.id || key.email || index}>
                        <tr
                          className="transition-colors border-b border-default hover:bg-overlay-xs"
                        >
                          <td>
                            <div className="table-user">
                              <div className="table-user-info">
                                <span className="table-user-name">{key.name || key.email || '—'}</span>
                                <span className="table-user-email inline-flex items-center gap-2">
                                  <span className="text-dim">TG</span>
                                  {key.tg_id ? (
                                    <CopyText
                                      text={String(key.tg_id)}
                                      showToast={false}
                                      className="inline-flex items-center gap-1 text-[12px] font-mono text-secondary hover:text-primary transition-colors"
                                    />
                                  ) : <span className="text-[12px] font-mono text-secondary">—</span>}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-1 py-4 text-[17px] leading-7 truncate">
                            <span className="block truncate max-w-[180px]" title={tariffName}>{tariffName}</span>
                          </td>
                          <td className="px-2 py-4 text-[17px] leading-7 truncate">{serverName}</td>
                          <td>
                            <span className={`status-badge ${statusBadge}`}>{status.text}</span>
                          </td>
                          <td className="px-2 py-4 text-[17px] leading-7 whitespace-nowrap">
                            <span
                              className="block truncate max-w-[165px]"
                              title={formatDate(key.expiry_time || key.expires_at || key.expiry)}
                            >
                              {formatMskDateTimeCompact(key.expiry_time || key.expires_at || key.expiry)}
                            </span>
                          </td>
                          
                          {/* Колонка Трафик */}
                          {(rmwEnabled || rmwChecking) && (
                            <td className="pl-0 pr-8 py-4 text-[17px] leading-7 whitespace-nowrap">
                              {rmwLoading ? (
                                <div className="h-4 w-20 rounded bg-overlay-sm animate-pulse" />
                              ) : rmwNoData || rmwNeverConnected ? (
                                <span className="text-muted text-[14px]">—</span>
                              ) : rmwUser ? (
                                <div className="text-[15px] font-mono leading-6">
                                  <div className="flex items-center justify-between gap-2 whitespace-nowrap" title={`Потрачено: ${trafficUsedText}`}>
                                    <span className="text-muted">Потрачено</span>
                                    <span className="text-[var(--accent)]">{trafficUsedText}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 whitespace-nowrap" title={`Всего: ${trafficTotalText}`}>
                                    <span className="text-muted">Всего</span>
                                    <span className="text-[var(--accent)]">{trafficTotalText}</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted text-[14px]">—</span>
                              )}
                            </td>
                          )}

                          {/* Колонка Онлайн + Нода */}
                          {(rmwEnabled || rmwChecking) && (
                            <td className="pl-4 pr-4 py-4 overflow-hidden">
                              <div className="min-w-0">
                                {/* status line */}
                                {rmwLoading ? (
                                  <div className="h-4 w-28 rounded bg-overlay-sm animate-pulse" />
                                ) : rmwNoData ? (
                                  <div className="text-muted text-[14px] leading-6 whitespace-nowrap">—</div>
                                ) : rmwNeverConnected ? (
                                  <div className="flex items-center gap-2 text-red-400 text-[16px] font-semibold leading-6 whitespace-nowrap w-full">
                                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                                    Не подключался
                                  </div>
                                ) : onlineAt ? (
                                  <div className="flex items-center gap-2 min-w-0 w-full overflow-hidden">
                                    <span
                                      className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                                        isOnline ? 'bg-green-500 animate-pulse' : 'bg-[var(--border-strong)]'
                                      }`}
                                    />
                                    <span
                                      className={`${isOnline ? 'text-green-500' : 'text-muted'} text-[16px] font-semibold leading-6 whitespace-nowrap truncate min-w-0`}
                                      title={
                                        isOnline
                                          ? formatMskDateTimeShort(onlineAt)
                                          : `Оффлайн • ${formatOfflineAgoRu(onlineAgoMs)}`
                                      }
                                    >
                                      {isOnline ? 'Онлайн' : `Оффлайн · ${formatOfflineAgoRu(onlineAgoMs)}`}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="text-muted text-[14px] leading-6 whitespace-nowrap">—</div>
                                )}

                                {/* node line */}
                                <div className="mt-1 flex items-center gap-2 min-w-0 w-full overflow-hidden">
                                  {rmwLoading || rmwNoData || rmwNeverConnected || !onlineAt ? (
                                    <span className="text-muted text-[13px] leading-5">—</span>
                                  ) : (
                                    <>
                                      {FlagComponent && (
                                        <span title={nodeCc || undefined} className="inline-flex">
                                          <FlagComponent className="w-5 h-4 rounded-sm flex-shrink-0" />
                                        </span>
                                      )}
                                      <span className="text-secondary text-[15px] font-medium leading-5 truncate min-w-0" title={nodeName}>
                                        {nodeName}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          )}
                          
                          <td className="px-2 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <EditButton
                                size="sm"
                                title="Редактировать"
                                ariaLabel="Редактировать подписку"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingKey(key)
                                  setSelectedUser(null)
                                  setShowKeyModal(true)
                                }}
                              />
                              <DeleteButton
                                size="sm"
                                title="Удалить"
                                ariaLabel="Удалить подписку"
                                variant="responsive"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteConfirm({ isOpen: true, user: null, key })
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            
            {/* Mobile Cards for Keys */}
            <div className="md:hidden space-y-2 mt-2 sm:mt-3">
              {(paginatedData as Key[]).map((key) => {
                const status = getKeyStatus(key)
                const tariffName = key.tariff_name || 
                                  (key.tariff_id ? tariffs.find(t => (t.id || t.tariff_id) === key.tariff_id)?.name : null) ||
                                  (key.tariffId ? tariffs.find(t => (t.id || t.tariff_id) === key.tariffId)?.name : null) ||
                                  '-'
                const serverName = key.server_name || 
                                  key.cluster_name || 
                                  key.server_id || 
                                  key.cluster_id || 
                                  '-'

                const keyNameForRmw = String((key as any)?.name ?? (key as any)?.email ?? '').trim()
                const rmwEntry = rmwEnabled && keyNameForRmw ? rmwUsersByName[keyNameForRmw] : undefined
                const rmwUser: any | null | undefined = rmwEntry ? rmwEntry.user : undefined
                const onlineAt = rmwUser?.onlineAt ?? null
                const onlineAtMs = onlineAt ? new Date(String(onlineAt)).getTime() : Number.NaN
                const onlineAgoMs = Number.isFinite(onlineAtMs) ? (Date.now() - onlineAtMs) : Number.NaN
                const isOnline = Number.isFinite(onlineAgoMs) && onlineAgoMs <= ONLINE_WINDOW_MS
                const lastNodeUuid = String(rmwUser?.lastConnectedNodeUuid || '').trim()
                const node = lastNodeUuid ? rmwNodesByUuid[lastNodeUuid] : undefined
                const nodeName = (node?.name || '').trim() || (lastNodeUuid ? `${lastNodeUuid.slice(0, 8)}…` : '—')
                const nodeCc = node?.countryCode ?? inferCountryCodeFromText(nodeName)
                const FlagComponent = getFlagComponent(nodeCc)
                const trafficText = rmwUser
                  ? `${formatBytes(rmwUser.usedTrafficBytes)} / ${rmwUser.trafficLimitBytes ? formatBytes(rmwUser.trafficLimitBytes) : '∞'}`
                  : ''
                
                return (
                  <div 
                    key={key.id || key.email || Math.random()}
                    className="glass-table p-3"
                  >
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="flex-1">
                        <div className="text-primary text-base font-semibold mb-1">{key.name || key.email || '-'}</div>
                        <div className="text-muted text-sm mb-1">TG ID: {key.tg_id || '-'}</div>
                      </div>
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <span className={`px-2 py-1 rounded text-sm font-semibold ${status.class}`}>
                          {status.text}
                        </span>
                        <EditButton
                          size="sm"
                          title="Редактировать"
                          ariaLabel="Редактировать подписку"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingKey(key)
                            setSelectedUser(null)
                            setShowKeyModal(true)
                          }}
                        />
                        <DeleteButton
                          size="sm"
                          title="Удалить"
                          ariaLabel="Удалить подписку"
                          variant="responsive"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteConfirm({ isOpen: true, user: null, key })
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div>
                        <span className="text-muted">Тариф:</span>
                        <span className="text-dim ml-1">{tariffName}</span>
                      </div>
                      <div>
                        <span className="text-muted">Сервер:</span>
                        <span className="text-dim ml-1">{serverName}</span>
                      </div>
                      <div>
                        <span className="text-muted">Действует до:</span>
                        <span className="text-dim ml-1">{formatDate(key.expiry_time || key.expires_at || key.expiry)}</span>
                      </div>
                    </div>

                    {rmwEnabled && keyNameForRmw && (
                      <div className="mt-3 pt-3 border-t border-default text-base space-y-2">
                        {!rmwEntry ? (
                          <div className="text-dim">Remnawave: загрузка…</div>
                        ) : rmwEntry.user === null ? (
                          <div className="text-dim">Remnawave: нет данных</div>
                        ) : !onlineAt ? (
                          /* Нет данных о подключении */
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
                            <span className="inline-flex h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-red-400 font-semibold text-base">Не подключался</span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-overlay-xs border border-default">
                              <span className={`inline-flex h-3 w-3 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-[var(--border-strong)]'}`} />
                              <span className={isOnline ? 'text-green-500 font-semibold text-base' : 'text-dim font-semibold text-base'}>
                                {isOnline ? 'Онлайн' : `Оффлайн · ${formatOfflineAgoRu(onlineAgoMs)}`}
                              </span>
                              <span className="text-muted text-base">{formatMskDateTimeShort(onlineAt)}</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-overlay-xs border border-default min-w-0">
                              {FlagComponent ? (
                                <span title={nodeCc || undefined} className="inline-flex">
                                  <FlagComponent className="w-5 h-4 rounded-sm border border-default flex-shrink-0" />
                                </span>
                              ) : null}
                              <span className="text-muted font-semibold text-base">Нода:</span>
                              <span className="text-primary text-base truncate min-w-0">{nodeName}</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-overlay-xs border border-default">
                              <span className="text-muted font-semibold text-base">Трафик:</span>
                              <span className="text-[var(--accent)] font-mono text-base">{trafficText || '—'}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Пагинация снизу */}
            <Pagination />
          </>
        )}

        {/* Детали пользователя (center modal with overlay) */}
        {selectedUser && (
          <UserDetailModal
            tgId={selectedUser}
            onClose={() => setSelectedUser(null)}
            onDeleted={() => {
              void loadUsers()
            }}
          />
        )}

        {/* Редактор ключа (center modal with overlay) */}
        {showKeyModal && editingKey && editingKey.tg_id && (
          <KeyEditModal
            tgId={editingKey.tg_id}
            editingKey={editingKey}
            tariffs={tariffs}
            onClose={() => {
              setShowKeyModal(false)
              setEditingKey(null)
            }}
            onUpdated={() => {
              loadKeys(true)
            }}
            onSaved={() => {
              setShowKeyModal(false)
              setEditingKey(null)
              loadKeys(true)
            }}
          />
        )}

        {/* Inline подтверждение действий (без модалок) */}
        {deleteConfirm.isOpen ? (
          <div className="glass-card" style={{ marginTop: 16, padding: 14 }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="text-primary font-semibold">
                  {deleteConfirm.key ? 'Удалить подписку' : 'Разбанить пользователя'}
                </div>
                <div className="text-sm text-dim">
                  {deleteConfirm.key
                    ? `Вы уверены, что хотите удалить подписку ${deleteConfirm.key.name || deleteConfirm.key.email || ''}?`
                    : `Вы уверены, что хотите разбанить пользователя ${deleteConfirm.user?.tg_id}?`}
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  className="card-btn"
                  onClick={() => setDeleteConfirm({ isOpen: false, user: null, key: null })}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="card-btn danger"
                  onClick={() => {
                    if (deleteConfirm.key) void handleDeleteKey(deleteConfirm.key)
                    else if (deleteConfirm.user) void handleUnbanUser(deleteConfirm.user)
                  }}
                >
                  Подтвердить
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {/* End page wrapper */}
    </>
  )
}
