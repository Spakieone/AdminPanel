import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
// Layout теперь применяется на уровне роутера (LayoutRoute)
import {
  getBotProfiles,
  createBotProfile,
  updateBotProfile,
  deleteBotProfile,
  setActiveBotProfile,
  getMonitoringSettings,
  saveMonitoringSettings,
  getAllRemnawaveSettings,
  deleteRemnawaveSettings,
  getRemnawaveProfiles,
  createRemnawaveProfile,
  updateRemnawaveProfile,
  deleteRemnawaveProfile,
  getUiSettings,
  saveUiSettings,
} from '../api/client'
import type { RemnawaveProfile } from '../api/client'
import type { NotificationRecipient } from '../api/types'
import { useToastContext } from '../contexts/ToastContext'
import ConfirmModal from '../components/common/ConfirmModal'
import NeonCheckbox from '../components/ui/NeonCheckbox'
import DarkSelect, { type DarkSelectGroup } from '../components/common/DarkSelect'
import LkTabsView from '../components/settings/LkTabsView'
import GlassTabs from '../components/common/GlassTabs'


export interface BotProfile {
  id: string
  name: string
  botApiUrl: string
  adminId: string
  token: string
}

type ProfileEditorMode = 'create' | 'edit'

type SettingsOnlySection = 'main' | 'general' | 'integrations' | 'monitoring' | 'notifications' | 'access'

export default function Settings({ onlySection }: { onlySection?: SettingsOnlySection } = {}) {
  const toast = useToastContext()
  const location = useLocation()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<BotProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [testNotificationStatus, setTestNotificationStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const [uiSettings, setUiSettings] = useState({ browserTitle: 'Web Panel', brandTitle: 'WebPanel' })
  const uiSettingsRef = useRef(uiSettings)
  const lastSavedUiSettingsRef = useRef({ browserTitle: 'Web Panel', brandTitle: 'WebPanel' })
  const [_uiSaving, setUiSaving] = useState(false)
  const saveTimeoutRef = useRef<number | null>(null)
  const isInitialLoadRef = useRef(true)
  const hasUiChangedRef = useRef(false)
  const [_monitoringSaving, setMonitoringSaving] = useState(false)
  const monitoringSaveTimeoutRef = useRef<number | null>(null)
  const isMonitoringInitialLoadRef = useRef(true)
  const hasMonitoringChangedRef = useRef(false)
  const ignoreNextMonitoringAutosaveRef = useRef(false)

  const isPanelPage = location.pathname === '/panel'
  const isSettingsPage = location.pathname === '/settings'
  const showTopTabs = isPanelPage || isSettingsPage

  // Unified tab state: for /panel use URL ?tab=, for /settings use local state
  const panelTabFromUrl = useMemo(() => {
    if (!isPanelPage) return 'bots'
    const t = String(new URLSearchParams(location.search || '').get('tab') || '').trim().toLowerCase()
    return t === 'lk' ? 'lk' : t === 'remnawave' ? 'remnawave' : t === 'monitoring' ? 'monitoring' : t === 'other' ? 'other' : 'bots'
  }, [isPanelPage, location.search])

  const [settingsTab, setSettingsTab] = useState<'bots' | 'lk' | 'remnawave' | 'monitoring' | 'other'>('bots')

  const activeTab = isPanelPage ? panelTabFromUrl : settingsTab

  const handleTabChange = (id: string) => {
    const tab = id as 'bots' | 'lk' | 'remnawave' | 'monitoring' | 'other'
    if (isPanelPage) {
      navigate(`/panel?tab=${tab}`, { replace: true })
    } else {
      setSettingsTab(tab)
    }
  }

  const settingsTabs = [
    { id: 'bots', label: 'Профили бота' },
    { id: 'lk', label: 'Профили ЛК' },
    { id: 'remnawave', label: 'Remnawave' },
    { id: 'monitoring', label: 'Мониторинг' },
    { id: 'other', label: 'Остальное' },
  ]

  const effectiveSection: SettingsOnlySection | undefined = isPanelPage ? 'main' : onlySection

  const showIntegrations = showTopTabs ? activeTab === 'bots' : !effectiveSection || effectiveSection === 'integrations' || effectiveSection === 'main'
  const showMonitoring = showTopTabs ? activeTab === 'monitoring' : !effectiveSection || effectiveSection === 'monitoring'
  const showNotifications = showTopTabs ? activeTab === 'monitoring' : !effectiveSection || effectiveSection === 'notifications'
  const showGeneral = showTopTabs ? activeTab === 'lk' : !effectiveSection || effectiveSection === 'general' || effectiveSection === 'main'
  const showOther = showTopTabs ? activeTab === 'other' : !effectiveSection || effectiveSection === 'main'
  const showRemnawave = showTopTabs ? activeTab === 'remnawave' : (!effectiveSection || effectiveSection === 'integrations' || effectiveSection === 'main')

  // Per-card editor (flip)
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null) // profile.id or 'create'
  const [flippedRemnawaveCardId, setFlippedRemnawaveCardId] = useState<string | null>(null)
  const [flippedRecipientCardId, setFlippedRecipientCardId] = useState<string | null>(null) // recipient.id or 'create'
  const [editorMode, setEditorMode] = useState<ProfileEditorMode>('create')
  const [editorProfileId, setEditorProfileId] = useState<string | null>(null)
  const [editorSaving, setEditorSaving] = useState(false)
  const [editorData, setEditorData] = useState({
    name: '',
    botApiUrl: '',
    adminId: '',
    token: '',
  })
  const [botApiInputMode, setBotApiInputMode] = useState<'domain' | 'local'>('domain')
  
  // Независимые профили Remnawave
  const [remnawaveProfiles, setRemnawaveProfiles] = useState<RemnawaveProfile[]>([])
  const [showDeleteRemnawaveConfirm, setShowDeleteRemnawaveConfirm] = useState<string | null>(null)
  const [deleteRemnawaveProfileId, setDeleteRemnawaveProfileId] = useState<string | null>(null)
  
  // Старые настройки (для обратной совместимости)
  const [remnawaveSettings, setRemnawaveSettings] = useState<Record<string, { base_url: string; token: string }>>({})
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState<{
    title: string
    message: string
    confirmText?: string
    onConfirm: () => void
  } | null>(null)
  
  // Редакторы для независимых профилей
  const [remnawaveEditorData, setRemnawaveEditorData] = useState({
    name: '',
    base_url: '',
    token: '',
    botProfileId: '' as string | ''
  })
  const [remnawaveEditorSaving, setRemnawaveEditorSaving] = useState(false)
  
  // Редактор для создания получателя уведомлений
  const [recipientEditorData, setRecipientEditorData] = useState({
    botProfileIds: [] as string[],
    mode: 'bot' as 'bot' | 'channel',
    botToken: '',
    userId: '',
    channelId: '',
    threadId: ''
  })
  
  // Telegram TechSupport удален по запросу пользователя

  const notificationTemplates = {
    template1: {
      name: 'Короткий',
      down: '🔴 DOWN: {name} ({profile}) • {time}{error}',
      recovery: '🟢 UP: {name} ({profile}) • {time} • {downtime}',
      nodeDown: '🔴 NODE DOWN: {name} ({profile}) • {time}{error}',
      nodeRecovery: '🟢 NODE UP: {name} ({profile}) • {time} • {downtime}',
      warning: '',
      warningRecovery: ''
    },
    template2: {
      name: 'Простой',
      down: '🔴 {name} недоступен\n━━━━━━━━━━━━━━━━━━\n📊 Профиль: {profile}\n🔗 {url}\n🕐 {time}{error}',
      recovery: '🟢 {name} восстановлен\n━━━━━━━━━━━━━━━━━━\n📊 Профиль: {profile}\n🔗 {url}\n🕐 {time}\n⏱ Время простоя: {downtime}',
      nodeDown: '🔴 Нода ({name}) недоступна\n━━━━━━━━━━━━━━━━━━\n📊 Профиль: {profile}\n🔗 {url}\n🕐 {time}{error}',
      nodeRecovery: '🟢 Нода ({name}) восстановлена\n━━━━━━━━━━━━━━━━━━\n📊 Профиль: {profile}\n🔗 {url}\n🕐 {time}\n⏱ Время простоя: {downtime}',
      warning: '',
      warningRecovery: ''
    },
  }

  const botProfileGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: '', label: 'Не привязан' },
          ...profiles.map((p) => ({ value: p.id, label: p.name })),
        ],
      },
    ],
    [profiles],
  )

  const recipientModeGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: 'bot', label: 'Bot - пользователю' },
          { value: 'channel', label: 'Channel - в канал/группу' },
        ],
      },
    ],
    [],
  )

  const BOT_API_PREFIX = '/adminpanel/api'

  const buildBotApiUrl = (mode: 'domain' | 'local', raw: string) => {
    const input = String(raw || '').trim()
    if (!input) return ''

    const ensureUrl = (s: string, defaultProto: 'http:' | 'https:') => {
      const hasProto = /^https?:\/\//i.test(s)
      return new URL(hasProto ? s : `${defaultProto}//${s}`)
    }

    try {
      if (mode === 'domain') {
        // Accept: "example.com" or "https://example.com/anything"
        const u = ensureUrl(input, 'https:')
        const host = String(u.hostname || '').trim()
        if (!host) return ''
        const proto = /^https?:$/.test(u.protocol) ? u.protocol : 'https:'
        return `${proto}//${host}${BOT_API_PREFIX}`
      }

      // local: require host:port, accept "127.0.0.1:7777" or "http://127.0.0.1:7777/..."
      const u = ensureUrl(input, 'http:')
      const host = String(u.host || '').trim() // includes port
      if (!host) return ''
      if (!/:\d+$/.test(host)) return '' // must include port
      const proto = /^https?:$/.test(u.protocol) ? u.protocol : 'http:'
      return `${proto}//${host}${BOT_API_PREFIX}`
    } catch {
      return ''
    }
  }

  const parseBotApiInput = (storedUrl: string): { mode: 'domain' | 'local'; value: string } => {
    const s = String(storedUrl || '').trim()
    if (!s) return { mode: 'domain', value: '' }

    const ensureUrl = (raw: string) => {
      const hasProto = /^https?:\/\//i.test(raw)
      return new URL(hasProto ? raw : `https://${raw}`)
    }

    try {
      const u = ensureUrl(s)
      const host = String(u.host || '').trim()
      const hostname = String(u.hostname || '').trim()
      const isLocal = hostname === 'localhost' || /:\d+$/.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
      if (isLocal) return { mode: 'local', value: host }
      return { mode: 'domain', value: hostname }
    } catch {
      // Fallback: treat as domain if no port, otherwise local
      const isLocal = /:\d+$/.test(s)
      return { mode: isLocal ? 'local' : 'domain', value: s.replace(/^https?:\/\//i, '').split('/')[0] || s }
    }
  }

  const setBotApiMode = (mode: 'domain' | 'local') => {
    setBotApiInputMode((prevMode) => {
      // If user switches to "local", always prefill our default (user can edit afterwards).
      if (mode === 'local' && prevMode !== 'local') {
        setEditorData((prev) => ({ ...prev, botApiUrl: '127.0.0.1:7777' }))
      }
      return mode
    })
  }

  // Настройки мониторинга
  const [monitoringSettings, setMonitoringSettings] = useState({
    refreshInterval: 30000, // 30 секунд по умолчанию
    // What to monitor
    monitorBotApi: true,
    monitorRemnawaveApi: true,
    monitorRemnawaveNodes: true,
    panelNotificationsEnabled: true,
    telegramNotificationsEnabled: true,
    // backward compatible field (will be kept in sync with telegramNotificationsEnabled)
    notificationsEnabled: true,
    // Event toggles (per channel)
    panelNotifyOnDown: true,
    panelNotifyOnRecovery: true,
    panelNotifyPayments: true,
    panelNotifyUsers: true,
    telegramNotifyOnDown: true,
    telegramNotifyOnRecovery: true,
    // backward compatible toggles (kept in sync with telegram* for older backend)
    notifyOnDown: true,
    notifyOnRecovery: true,
    recipients: [] as NotificationRecipient[], // Список получателей уведомлений
    notificationTemplate: 'template2' as keyof typeof notificationTemplates, // Выбранный шаблон
    customDownTemplate: '', // Свой шаблон для падения
    customRecoveryTemplate: '', // Свой шаблон для восстановления
    customWarningTemplate: '', // Свой шаблон для предупреждения
    customWarningRecoveryTemplate: '', // Свой шаблон для восстановления после предупреждения
    warningThreshold: 80, // Порог для предупреждений (по умолчанию 80%)
    notifyOnWarning: true, // Уведомлять о предупреждениях
    // System monitor card (Dashboard)
    systemWidget: {
      enabled: true,
      pollSec: 10,
      showCpu: true,
      showRam: true,
      showSwap: true,
      showDisk: true,
      showNetwork: true,
      showBotRam: true,
      showBotCpu: true,
      showPanelRam: true,
      showPanelCpu: true,
    },
  })

  useEffect(() => {
    // намеренно как "componentDidMount"
    loadProfiles()
    loadMonitoringSettingsFromServer()
    loadRemnawaveSettings()
    loadRemnawaveProfiles()
    loadUiSettings()
  }, [])

  useEffect(() => {
    uiSettingsRef.current = uiSettings
  }, [uiSettings])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const section = String(params.get('section') || '').trim().toLowerCase()
    if (!section) return
    const idMap: Record<string, string> = {
      general: 'settings-section-general',
      integrations: 'settings-section-integrations',
      monitoring: 'settings-section-monitoring',
      notifications: 'settings-section-notifications',
    }
    const targetId = idMap[section]
    if (!targetId) return
    const t = window.setTimeout(() => {
      const el = document.getElementById(targetId)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
    return () => window.clearTimeout(t)
  }, [location.search])

  const notify = (type: 'success' | 'error' | 'info', message: string) => {
    if (type === 'success') toast.showSuccess('Готово', message, 3000)
    else if (type === 'error') toast.showError('Ошибка', message, 4500)
    else toast.showInfo('Информация', message, 3500)
  }

  async function loadUiSettings() {
    try {
      const s = await getUiSettings()
      if (s) {
        const loadedSettings = {
          browserTitle: s.browserTitle || 'Web Panel',
          brandTitle: s.brandTitle || 'WebPanel'
        }
        if (loadedSettings.browserTitle) document.title = loadedSettings.browserTitle
        // Устанавливаем флаг перед установкой состояния, чтобы useEffect не сработал
        isInitialLoadRef.current = true
        setUiSettings(loadedSettings)
        lastSavedUiSettingsRef.current = loadedSettings
        // Явно сбрасываем индикатор при загрузке
        hasUiChangedRef.current = false
        // UI settings are stored on server (no localStorage).
        // Устанавливаем флаг только после полной загрузки данных
        // Используем setTimeout чтобы убедиться, что все состояния обновлены
        setTimeout(() => {
          isInitialLoadRef.current = false
        }, 100)
      } else {
        isInitialLoadRef.current = false
      }
    } catch {
      // ignore
      isInitialLoadRef.current = false
    }
  }

  async function handleSaveUiSettings() {
    setUiSaving(true)
    try {
      const snapshot = uiSettingsRef.current
      // Не сохраняем пустые значения (иначе будет "откат" на дефолт во время ввода)
      const bt = String(snapshot.browserTitle || '').trim()
      const br = String(snapshot.brandTitle || '').trim()
      if (!bt || !br) return

      // Сохраняем только browserTitle и brandTitle
      const settingsToSave = { browserTitle: bt, brandTitle: br }
      const savedSettings = await saveUiSettings(settingsToSave)
      lastSavedUiSettingsRef.current = savedSettings
      if (bt) document.title = bt

      // Не перезатираем ввод пользователя, если он успел продолжить печатать после отправки
      const cur = uiSettingsRef.current
      const curBt = String(cur.browserTitle || '').trim()
      const curBr = String(cur.brandTitle || '').trim()
      if (curBt === bt && curBr === br) {
        setUiSettings(savedSettings)
      }
      // Показываем "Сохранено" только если были реальные изменения
      // Индикатор показывается 3 секунды
      if (hasUiChangedRef.current) {
        toast.showSuccess('Сохранено', 'Настройки интерфейса успешно сохранены', 3000)
        hasUiChangedRef.current = false
      }
      // UI settings are stored on server (no localStorage).
      window.dispatchEvent(new Event('uiSettingsChanged'))
    } catch {
      notify('error', 'Ошибка сохранения названия панели')
    } finally {
      setUiSaving(false)
    }
  }

  // Автосохранение с debounce (после последнего изменения)
  useEffect(() => {
    // Пропускаем автосохранение при первой загрузке
    if (isInitialLoadRef.current) {
      return
    }

    // Очищаем предыдущий таймер
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    const bt = String(uiSettings.browserTitle || '').trim()
    const br = String(uiSettings.brandTitle || '').trim()

    // Пока поле пустое — не автосохраняем, чтобы не было "отката" на дефолт во время ввода
    if (!bt || !br) {
      return
    }

    // Отмечаем, что были изменения (только если значение валидное для сохранения)
    hasUiChangedRef.current = true

    // Устанавливаем новый таймер (увеличили задержку для комфортного ввода)
    saveTimeoutRef.current = window.setTimeout(() => {
      handleSaveUiSettings()
    }, 1800)

    // Очистка при размонтировании
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [uiSettings.browserTitle, uiSettings.brandTitle])

  // Автосохранение monitoring settings с debounce (800ms после последнего изменения)
  useEffect(() => {
    // Пропускаем автосохранение при первой загрузке
    if (isMonitoringInitialLoadRef.current) {
      return
    }
    // Пропускаем один цикл автосохранения, если изменение инициировано явным сохранением
    if (ignoreNextMonitoringAutosaveRef.current) {
      ignoreNextMonitoringAutosaveRef.current = false
      return
    }

    // Отмечаем, что были изменения
    hasMonitoringChangedRef.current = true

    // Очищаем предыдущий таймер
    if (monitoringSaveTimeoutRef.current) {
      window.clearTimeout(monitoringSaveTimeoutRef.current)
    }

    // Устанавливаем новый таймер на 800ms после последнего изменения
    monitoringSaveTimeoutRef.current = window.setTimeout(() => {
      saveMonitoringSettingsLocal(monitoringSettings)
    }, 800)

    // Очистка при размонтировании
    return () => {
      if (monitoringSaveTimeoutRef.current) {
        window.clearTimeout(monitoringSaveTimeoutRef.current)
      }
    }
  }, [monitoringSettings])
  
  // Токены теперь хранятся на сервере в профилях, localStorage не используется

  // Remnawave редактируется через flip-редактор карточки профиля (не авто-раскрываем отдельный блок)

  const isValidUrl = (url: string): boolean => {
    if (!url || url.trim() === '') return false
    try {
      const urlObj = new URL(url)
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:'
    } catch {
      return false
    }
  }

  // Bot API URL is now configured server-side (BOT_API_BASE_URL), not per profile.

  async function loadRemnawaveSettings() {
    try {
      const allSettings = await getAllRemnawaveSettings()
      const settingsMap: Record<string, { base_url: string; token: string }> = {}
      
      // Загружаем настройки для каждого профиля
      if (allSettings?.profiles && Array.isArray(allSettings.profiles)) {
        for (const profileSetting of allSettings.profiles) {
          if (profileSetting.profileId && profileSetting.settings) {
            const baseUrl = profileSetting.settings.base_url || ''
            // Сохраняем только если это валидный URL
            if (isValidUrl(baseUrl)) {
              settingsMap[profileSetting.profileId] = {
                base_url: baseUrl,
                token: ''
              }
            }
          }
        }
      }
      
      // Загружаем глобальные настройки (для обратной совместимости)
      if (allSettings?.global && allSettings.global.base_url) {
        const baseUrl = allSettings.global.base_url || ''
        if (isValidUrl(baseUrl)) {
          settingsMap['global'] = {
            base_url: baseUrl,
            token: ''
          }
        }
      }
      
      setRemnawaveSettings(settingsMap)
    } catch {
      // Ignore
    }
  }

  async function loadRemnawaveProfiles() {
    try {
      const profiles = await getRemnawaveProfiles()
      setRemnawaveProfiles(profiles)
    } catch {
      // Ошибка загрузки профилей Remnawave - игнорируем
    }
  }

  const openRemnawaveEditor = (profile?: RemnawaveProfile) => {
    if (profile) {
      setFlippedRemnawaveCardId(profile.id)
      setRemnawaveEditorData({
        name: profile.name,
        base_url: profile.settings.base_url,
        token: '', // Токен не возвращается из API
        botProfileId: profile.botProfileIds && profile.botProfileIds.length > 0 ? profile.botProfileIds[0] : ''
      })
    } else {
      setFlippedRemnawaveCardId('create')
      setRemnawaveEditorData({ name: '', base_url: '', token: '', botProfileId: '' })
    }
  }

  const closeRemnawaveEditor = () => {
    setFlippedRemnawaveCardId(null)
    setRemnawaveEditorSaving(false)
  }


  const deleteRemnawaveSettingsLocal = async (profileId: string) => {
    try {
      // Удаляем настройки с сервера
      await deleteRemnawaveSettings(profileId)
      
      // Удаляем из локального состояния
      const newSettings = { ...remnawaveSettings }
      delete newSettings[profileId]
      setRemnawaveSettings(newSettings)
      
      // Перезагружаем настройки после удаления
      await loadRemnawaveSettings()
      
      setShowDeleteRemnawaveConfirm(null)
      notify('success', 'Привязка Remnawave успешно удалена')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Ошибка удаления привязки Remnawave'
      notify('error', errorMessage)
    }
  }

  async function loadMonitoringSettingsFromServer() {
    try {
      const serverSettings = await getMonitoringSettings()
      if (serverSettings && Object.keys(serverSettings).length > 0) {
        let recipients = serverSettings.recipients || []
        recipients = recipients.map((r: NotificationRecipient, index: number) => {
          let normalizedId = r.id
          if (!normalizedId || normalizedId === 'test' || isNaN(parseInt(normalizedId))) {
            normalizedId = (index + 1).toString()
          }
          return { ...r, id: normalizedId }
        })
        let template = String(serverSettings.notificationTemplate || 'template2')
        // Migrate old keys to presets.
        if (template === 'custom' || template === 'template3') template = 'template2'
        if (template !== 'template1' && template !== 'template2') template = 'template2'
        
        // Устанавливаем флаг перед установкой состояния, чтобы useEffect не сработал
        isMonitoringInitialLoadRef.current = true
        const telegramEnabled =
          (serverSettings as any).telegramNotificationsEnabled !== undefined
            ? Boolean((serverSettings as any).telegramNotificationsEnabled)
            : (serverSettings as any).notificationsEnabled !== undefined
              ? Boolean((serverSettings as any).notificationsEnabled)
              : true
        const panelEnabled =
          (serverSettings as any).panelNotificationsEnabled !== undefined ? Boolean((serverSettings as any).panelNotificationsEnabled) : true
        const tgDown = (serverSettings as any).telegramNotifyOnDown !== undefined
          ? Boolean((serverSettings as any).telegramNotifyOnDown)
          : (serverSettings as any).notifyOnDown !== undefined
            ? Boolean((serverSettings as any).notifyOnDown)
            : true
        const tgUp = (serverSettings as any).telegramNotifyOnRecovery !== undefined
          ? Boolean((serverSettings as any).telegramNotifyOnRecovery)
          : (serverSettings as any).notifyOnRecovery !== undefined
            ? Boolean((serverSettings as any).notifyOnRecovery)
            : true
        const panelDown = (serverSettings as any).panelNotifyOnDown !== undefined
          ? Boolean((serverSettings as any).panelNotifyOnDown)
          : (serverSettings as any).notifyOnDown !== undefined
            ? Boolean((serverSettings as any).notifyOnDown)
            : true
        const panelUp = (serverSettings as any).panelNotifyOnRecovery !== undefined
          ? Boolean((serverSettings as any).panelNotifyOnRecovery)
          : (serverSettings as any).notifyOnRecovery !== undefined
            ? Boolean((serverSettings as any).notifyOnRecovery)
            : true
        const panelPayments = (serverSettings as any).panelNotifyPayments !== undefined ? Boolean((serverSettings as any).panelNotifyPayments) : true
        const panelUsers = (serverSettings as any).panelNotifyUsers !== undefined ? Boolean((serverSettings as any).panelNotifyUsers) : true
        const monitorBotApi =
          (serverSettings as any).monitorBotApi !== undefined ? Boolean((serverSettings as any).monitorBotApi) : true
        const monitorRemApi =
          (serverSettings as any).monitorRemnawaveApi !== undefined ? Boolean((serverSettings as any).monitorRemnawaveApi) : true
        const monitorRemNodes =
          (serverSettings as any).monitorRemnawaveNodes !== undefined ? Boolean((serverSettings as any).monitorRemnawaveNodes) : true
        const sysW = (serverSettings as any).systemWidget && typeof (serverSettings as any).systemWidget === 'object'
          ? (serverSettings as any).systemWidget
          : {}
        const pollSecRaw = Number((sysW as any).pollSec ?? ((sysW as any).pollMs ? (Number((sysW as any).pollMs) / 1000) : 10))
        const pollSec = Number.isFinite(pollSecRaw) ? Math.max(5, Math.min(300, Math.round(pollSecRaw))) : 10
        setMonitoringSettings({
          refreshInterval: serverSettings.refreshInterval || 30000,
          monitorBotApi,
          monitorRemnawaveApi: monitorRemApi,
          monitorRemnawaveNodes: monitorRemNodes,
          panelNotificationsEnabled: panelEnabled,
          telegramNotificationsEnabled: telegramEnabled,
          notificationsEnabled: telegramEnabled,
          panelNotifyOnDown: panelDown,
          panelNotifyOnRecovery: panelUp,
          panelNotifyPayments: panelPayments,
          panelNotifyUsers: panelUsers,
          telegramNotifyOnDown: tgDown,
          telegramNotifyOnRecovery: tgUp,
          notifyOnDown: tgDown,
          notifyOnRecovery: tgUp,
          recipients: recipients,
          notificationTemplate: template as keyof typeof notificationTemplates,
          customDownTemplate: serverSettings.customDownTemplate || '',
          customRecoveryTemplate: serverSettings.customRecoveryTemplate || '',
          customWarningTemplate: serverSettings.customWarningTemplate || '',
          customWarningRecoveryTemplate: serverSettings.customWarningRecoveryTemplate || '',
          warningThreshold: serverSettings.warningThreshold || 80,
          notifyOnWarning: serverSettings.notifyOnWarning !== undefined ? serverSettings.notifyOnWarning : true,
          systemWidget: {
            enabled: Boolean(sysW.enabled ?? true),
            pollSec,
            showCpu: Boolean(sysW.showCpu ?? true),
            showRam: Boolean(sysW.showRam ?? true),
            showSwap: Boolean((sysW as any).showSwap ?? true),
            showDisk: Boolean(sysW.showDisk ?? true),
            showNetwork: Boolean(sysW.showNetwork ?? true),
            showBotRam: Boolean(sysW.showBotRam ?? true),
            showBotCpu: Boolean(sysW.showBotCpu ?? true),
            showPanelRam: Boolean((sysW as any).showPanelRam ?? true),
            showPanelCpu: Boolean((sysW as any).showPanelCpu ?? true),
          },
        })
        // Явно сбрасываем индикатор при загрузке
        hasMonitoringChangedRef.current = false
        // Устанавливаем флаг только после полной загрузки данных
        // Используем setTimeout чтобы убедиться, что все состояния обновлены
        setTimeout(() => {
          isMonitoringInitialLoadRef.current = false
        }, 100)
        return
      }
      // Если настройки не загрузились, все равно сбрасываем флаг
      setTimeout(() => {
        isMonitoringInitialLoadRef.current = false
      }, 100)
    } catch {
      // Ошибка загрузки настроек с сервера - используем значения по умолчанию
      // Важно: сбрасываем флаг, чтобы автосохранение работало
      setTimeout(() => {
        isMonitoringInitialLoadRef.current = false
      }, 100)
    }
  }

  // Функция loadMonitoringSettings удалена - настройки теперь загружаются только с сервера
  // через loadMonitoringSettingsFromServer

  const saveMonitoringSettingsLocal = async (settings: typeof monitoringSettings) => {
    const normalizedSettings = {
      ...settings,
      refreshInterval: Math.max(20000, settings.refreshInterval),
      // keep backward compatible shape for backend/older code
      notificationsEnabled: Boolean(settings.telegramNotificationsEnabled),
      notifyOnDown: Boolean(settings.telegramNotifyOnDown),
      notifyOnRecovery: Boolean(settings.telegramNotifyOnRecovery),
    }
    
    setMonitoringSaving(true)
    try {
      await saveMonitoringSettings(normalizedSettings)
      // Триггерим событие для обновления интервала в других компонентах
      window.dispatchEvent(new Event('refreshIntervalChanged'))
      window.dispatchEvent(new Event('monitoringSettingsChanged'))
      // Обновление состояния после успешного сохранения не должно снова триггерить автосейв
      ignoreNextMonitoringAutosaveRef.current = true
      setMonitoringSettings(normalizedSettings)
      // Показываем "Сохранено" только если были реальные изменения
      // Индикатор показывается 3 секунды
      if (hasMonitoringChangedRef.current) {
        toast.showSuccess('Сохранено', 'Настройки сохранены', 3000)
        hasMonitoringChangedRef.current = false
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Ошибка сохранения настроек мониторинга'
      notify('error', errorMessage)
    } finally {
      setMonitoringSaving(false)
    }
  }

  async function loadProfiles() {
    try {
      const data = await getBotProfiles() as { profiles?: BotProfile[], activeProfileId?: string | null }
      if (data && data.profiles) {
        // Профили загружаются с сервера, токены хранятся там же (но не возвращаются в списке для безопасности)
        setProfiles(data.profiles)
        
        if (data.activeProfileId) {
          setActiveProfileId(data.activeProfileId)
        } else if (data.profiles.length > 0) {
          // Если есть профили, но нет активного - устанавливаем первый
          setActiveProfileId(data.profiles[0].id)
        }
      }
    } catch {
      // Все данные на сервере, fallback не нужен
    }
  }

  const openCreateCard = () => {
    setEditorMode('create')
    setEditorProfileId(null)
    setBotApiInputMode('domain')
    setEditorData({
      name: '',
      botApiUrl: '',
      adminId: '',
      token: '',
    })
    setFlippedCardId('create')
  }

  const openEditCard = (profile: BotProfile) => {
    // Токен не возвращается с сервера для безопасности, пользователь должен ввести его заново при редактировании
    // Или оставить поле пустым, если не хочет менять токен
    setEditorMode('edit')
    setEditorProfileId(profile.id)
    const parsed = parseBotApiInput(profile.botApiUrl || '')
    setBotApiInputMode(parsed.mode)
    setEditorData({
      name: profile.name,
      botApiUrl: parsed.value,
      adminId: profile.adminId,
      token: '', // Токен не показываем для безопасности, пользователь введет новый если нужно
    })
    setFlippedCardId(profile.id)
  }

  const closeEditorCard = () => {
    setFlippedCardId(null)
    setEditorProfileId(null)
    setEditorSaving(false)
  }

  const handleDelete = (id: string) => {
    const profile = profiles.find(p => p.id === id)
    if (!profile) return
    
    setConfirmDeleteProfile({
      title: 'Подтвердите удаление',
      message: `Вы уверены, что хотите удалить профиль "${profile.name}"?`,
      confirmText: 'Удалить',
      onConfirm: async () => {
        try {
          await deleteBotProfile(id)
          await loadProfiles()
          window.dispatchEvent(new Event('botProfilesChanged'))
          setConfirmDeleteProfile(null)
          notify('success', 'Профиль успешно удален')
        } catch (error: unknown) {
          setConfirmDeleteProfile(null)
          const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка'
          notify('error', 'Ошибка удаления профиля: ' + errorMessage)
        }
      }
    })
  }

  const saveEditorCard = async () => {
    if (editorSaving) return

    if (!editorData.name || !editorData.adminId) {
      notify('error', 'Заполните название и Admin ID')
      return
    }

    const builtUrl = buildBotApiUrl(botApiInputMode, editorData.botApiUrl)
    if (!builtUrl) {
      notify('error', botApiInputMode === 'local'
        ? 'Укажите локальный адрес в формате IP:порт (например: 127.0.0.1:7777)'
        : 'Укажите домен (например: bot-domain.com)')
      return
    }

    // При создании токен обязателен
    if (editorMode === 'create' && !editorData.token.trim()) {
      notify('error', 'Заполните все поля бота (включая Token)')
      return
    }

    // При редактировании: если токен не введен, отправляем пустую строку - сервер сохранит старый
    // Если введен новый - обновим токен
    const botTokenToSave = editorData.token.trim()

    setEditorSaving(true)
    try {
      if (editorMode === 'create') {
        await createBotProfile({
          name: editorData.name,
          botApiUrl: builtUrl,
          adminId: editorData.adminId,
          token: botTokenToSave
        })
        await loadProfiles()
        window.dispatchEvent(new Event('botProfilesChanged'))
      } else {
        const id = editorProfileId
        if (!id) {
          notify('error', 'Не выбран профиль для редактирования')
          setEditorSaving(false)
          return
        }

        // Отправляем токен только если он был введен, иначе не отправляем поле token - сервер сохранит старый
        const updateData: any = {
          name: editorData.name,
          botApiUrl: builtUrl,
          adminId: editorData.adminId
        }
        // Если токен введен - отправляем его, иначе не отправляем поле token вообще
        if (botTokenToSave) {
          updateData.token = botTokenToSave
        } else {
          // Не отправляем поле token - сервер сохранит существующий токен
        }
        await updateBotProfile(id, updateData)

        await loadProfiles()
        window.dispatchEvent(new Event('botProfilesChanged'))
      }

      closeEditorCard()
    } catch (error) {
      notify('error', 'Ошибка сохранения профиля: ' + (error instanceof Error ? error.message : 'Неизвестная ошибка'))
      setEditorSaving(false)
    }
  }

  const handleSetActive = async (profile: BotProfile) => {
    try {
      await setActiveBotProfile(profile.id)
      setActiveProfileId(profile.id)
      window.dispatchEvent(new Event('botProfilesChanged'))
    } catch {
      notify('error', 'Ошибка установки активного профиля')
    }
  }

  return (
      <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">

        {showTopTabs && (
          <div className="mb-6">
            <GlassTabs
              tabs={settingsTabs}
              activeTab={activeTab}
              onTabChange={handleTabChange}
            />
          </div>
        )}

        {showIntegrations && (
        <div id="settings-section-integrations" className="glass-panel p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-primary">Профили подключения к боту</h2>
            <p className="text-xs text-muted mt-0.5">Каждый профиль — отдельный бот. Активный используется по умолчанию.</p>
          </div>

          <div className="flex flex-wrap gap-3 items-start">
            {profiles.map((profile) => {
              const isActive = activeProfileId === profile.id
              const isFlipped = flippedCardId === profile.id
              const linked = remnawaveProfiles.filter(p => p.botProfileIds.includes(profile.id))
              return (
                <div key={profile.id} className="w-full sm:w-[340px] [perspective:1000px]">
                  <div className={`relative h-[370px] transition-transform duration-500 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                    {/* Front */}
                    <div className="absolute inset-0 [backface-visibility:hidden]">
                      <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/35 hover:border-orange-400/60 rounded-xl p-4 border flex flex-col gap-3 h-full transition-colors duration-200">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-orange-400' : 'bg-overlay-md'}`} />
                            <h3 className="text-base font-semibold text-primary">{profile.name}</h3>
                            {isActive && <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20 font-medium">активен</span>}
                          </div>
                          <div className="mt-2 space-y-1 text-sm">
                            <p><span className="text-muted">Admin ID:</span> <span className="font-mono text-secondary">{profile.adminId || '—'}</span></p>
                            <p><span className="text-muted">Remnawave:</span> <span className="text-secondary">{linked.length > 0 ? `${linked[0].name}${linked.length > 1 ? ` +${linked.length - 1}` : ''}` : '—'}</span></p>
                            <p className="text-xs text-muted truncate">{profile.botApiUrl || '—'}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleSetActive(profile)} type="button" disabled={isActive}
                            className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${isActive ? 'bg-orange-500/5 text-orange-400/40 border-orange-500/15 cursor-default' : 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border-orange-500/25'}`}>
                            {isActive ? 'Активен' : 'Активировать'}
                          </button>
                          <button onClick={() => openEditCard(profile)} type="button"
                            className="flex-1 py-1.5 text-xs rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/25 transition-colors">
                            Редактировать
                          </button>
                          <button onClick={() => handleDelete(profile.id)} type="button"
                            className="py-1.5 px-3 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* Back */}
                    <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                      <div className="bg-gradient-to-br from-orange-500/8 to-orange-600/3 border-orange-500/25 rounded-xl p-4 border flex flex-col gap-3 h-full">
                        <div className="text-sm font-semibold text-primary">Редактировать: {profile.name}</div>
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs text-muted mb-1">Название</label>
                            <input type="text" value={editorData.name} onChange={(e) => setEditorData({ ...editorData, name: e.target.value })}
                              placeholder="Мой бот" autoComplete="off"
                              className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                          </div>
                          <div>
                            <label className="block text-xs text-muted mb-1">Admin ID</label>
                            <input type="text" value={editorData.adminId} onChange={(e) => setEditorData({ ...editorData, adminId: e.target.value })}
                              placeholder="123456789" autoComplete="off" data-form-type="other"
                              className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs text-muted">URL API</label>
                              <div className="flex gap-1">
                                <button type="button" onClick={() => setBotApiMode('domain')} className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${botApiInputMode === 'domain' ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'bg-overlay-sm text-dim border-default'}`}>Домен</button>
                                <button type="button" onClick={() => setBotApiMode('local')} className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${botApiInputMode === 'local' ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'bg-overlay-sm text-dim border-default'}`}>IP:порт</button>
                              </div>
                            </div>
                            <input type="text" value={editorData.botApiUrl} onChange={(e) => setEditorData({ ...editorData, botApiUrl: e.target.value })}
                              placeholder={botApiInputMode === 'local' ? '127.0.0.1:7777' : 'bot-domain.com'} autoComplete="off" data-form-type="other"
                              className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                          </div>
                          <div>
                            <label className="block text-xs text-muted mb-1">Token Admin</label>
                            <input type="password" value={editorData.token} onChange={(e) => setEditorData({ ...editorData, token: e.target.value })}
                              placeholder="Новый токен (пусто = сохранить)" autoComplete="new-password" data-form-type="other"
                              className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={saveEditorCard} disabled={editorSaving} type="button"
                            className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20 disabled:opacity-50 transition-colors">
                            {editorSaving ? 'Сохранение...' : 'Сохранить'}
                          </button>
                          <button onClick={closeEditorCard} type="button"
                            className="flex-1 py-1.5 text-xs rounded-lg bg-overlay-sm hover:bg-overlay-md text-secondary border border-default transition-colors">
                            Отмена
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Create card */}
            <div className="w-full sm:w-[340px] [perspective:1000px]">
              <div className={`relative h-[370px] transition-transform duration-500 [transform-style:preserve-3d] ${flippedCardId === 'create' ? '[transform:rotateY(180deg)]' : ''}`}>
                {/* Front */}
                <div className="absolute inset-0 [backface-visibility:hidden]">
                  <div onClick={openCreateCard}
                    className="w-full h-full rounded-xl border-2 border-dashed border-default hover:border-orange-500/30 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors group">
                    <div className="w-10 h-10 rounded-full bg-overlay-xs group-hover:bg-orange-500/10 flex items-center justify-center transition-colors">
                      <svg className="w-5 h-5 text-muted group-hover:text-orange-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    </div>
                    <span className="text-sm font-medium text-muted group-hover:text-orange-400 transition-colors">Добавить профиль</span>
                  </div>
                </div>
                {/* Back */}
                <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  <div className="bg-gradient-to-br from-orange-500/8 to-orange-600/3 border-orange-500/25 rounded-xl p-4 border flex flex-col gap-3 h-full">
                    <div className="text-sm font-semibold text-primary">Новый профиль бота</div>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-muted mb-1">Название</label>
                        <input type="text" value={editorData.name} onChange={(e) => setEditorData({ ...editorData, name: e.target.value })}
                          placeholder="Мой бот" autoComplete="off"
                          className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Admin ID</label>
                        <input type="text" value={editorData.adminId} onChange={(e) => setEditorData({ ...editorData, adminId: e.target.value })}
                          placeholder="123456789" autoComplete="off" data-form-type="other"
                          className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs text-muted">URL API</label>
                          <div className="flex gap-1">
                            <button type="button" onClick={() => setBotApiMode('domain')} className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${botApiInputMode === 'domain' ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'bg-overlay-sm text-dim border-default'}`}>Домен</button>
                            <button type="button" onClick={() => setBotApiMode('local')} className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${botApiInputMode === 'local' ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'bg-overlay-sm text-dim border-default'}`}>IP:порт</button>
                          </div>
                        </div>
                        <input type="text" value={editorData.botApiUrl} onChange={(e) => setEditorData({ ...editorData, botApiUrl: e.target.value })}
                          placeholder={botApiInputMode === 'local' ? '127.0.0.1:7777' : 'bot-domain.com'} autoComplete="off" data-form-type="other"
                          className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Token Admin</label>
                        <input type="password" value={editorData.token} onChange={(e) => setEditorData({ ...editorData, token: e.target.value })}
                          placeholder="Admin Bot Token" autoComplete="new-password" data-form-type="other"
                          className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveEditorCard} disabled={editorSaving} type="button"
                        className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20 disabled:opacity-50 transition-colors">
                        {editorSaving ? 'Сохранение...' : 'Сохранить'}
                      </button>
                      <button onClick={closeEditorCard} type="button"
                        className="flex-1 py-1.5 text-xs rounded-lg bg-overlay-sm hover:bg-overlay-md text-secondary border border-default transition-colors">
                        Отмена
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {showGeneral && <LkTabsView botProfiles={profiles} />}

        {/* Профили Remnawave */}
        {showRemnawave && (
        <div id="settings-section-monitoring" className="glass-panel p-4 sm:p-6 mt-4 sm:mt-6">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-primary">Профили Remnawave</h2>
            <p className="text-xs text-muted mt-0.5">Независимые профили Remnawave. Один бот ↔ один Remnawave.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            {remnawaveProfiles.map((profile) => {
              const isFlipped = flippedRemnawaveCardId === profile.id
              const boundBotName = (() => {
                const bid = profile.botProfileIds?.[0] || ''
                if (!bid) return '—'
                return profiles.find((x) => x.id === bid)?.name || '—'
              })()
              return (
                <div key={profile.id} className="w-full max-w-full sm:max-w-[340px] [perspective:1000px]">
                  <div className={`relative h-[370px] transition-transform duration-500 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                    {/* Front */}
                    <div className="absolute inset-0 [backface-visibility:hidden]">
                      <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/35 hover:border-purple-400/60 hover:shadow-purple-500/10 rounded-xl p-4 border flex flex-col h-full transition-colors duration-200 hover:shadow-lg">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 rounded-full bg-purple-400/70" />
                          <h3 className="text-lg font-semibold text-primary truncate">{profile.name}</h3>
                        </div>
                        <div className="flex-1 space-y-2 text-sm">
                          <p><span className="text-muted">Бот:</span> <span className="text-secondary">{boundBotName}</span></p>
                          {profile.settings.base_url && <p className="text-xs text-muted truncate">{profile.settings.base_url}</p>}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => openRemnawaveEditor(profile)} type="button"
                            className="flex-1 py-1.5 text-xs rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/25 transition-colors">
                            Редактировать
                          </button>
                          <button onClick={() => setDeleteRemnawaveProfileId(profile.id)} type="button"
                            className="py-1.5 px-3 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* Back */}
                    <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                      <div className="bg-gradient-to-br from-purple-500/8 to-purple-600/3 border-purple-500/25 rounded-xl p-4 border flex flex-col gap-3 h-full">
                        <div className="text-sm font-semibold text-primary">Редактировать: {profile.name}</div>
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs text-muted mb-1">Название</label>
                            <input type="text" value={remnawaveEditorData.name} onChange={(e) => setRemnawaveEditorData({ ...remnawaveEditorData, name: e.target.value })}
                              placeholder="Remnawave Profile" autoComplete="off"
                              className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                          </div>
                          <div>
                            <label className="block text-xs text-muted mb-1">Привязка к боту</label>
                            <DarkSelect value={remnawaveEditorData.botProfileId} onChange={(v) => setRemnawaveEditorData({ ...remnawaveEditorData, botProfileId: v })}
                              groups={botProfileGroups} buttonClassName="w-full px-3 py-2 text-sm rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary" />
                          </div>
                          <div>
                            <label className="block text-xs text-muted mb-1">Домен Remnawave</label>
                            <input type="text" value={remnawaveEditorData.base_url} onChange={(e) => setRemnawaveEditorData({ ...remnawaveEditorData, base_url: e.target.value })}
                              placeholder="https://panel.example.com" autoComplete="off"
                              className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                          </div>
                          <div>
                            <label className="block text-xs text-muted mb-1">Токен</label>
                            <input type="password" value={remnawaveEditorData.token} onChange={(e) => setRemnawaveEditorData({ ...remnawaveEditorData, token: e.target.value })}
                              placeholder="Новый токен (пусто = сохранить)" autoComplete="new-password"
                              className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async () => {
                            if (remnawaveEditorSaving) return
                            if (!remnawaveEditorData.name.trim()) { notify('error', 'Введите название профиля'); return }
                            if (!remnawaveEditorData.base_url.trim() || !isValidUrl(remnawaveEditorData.base_url)) { notify('error', 'Введите корректный домен'); return }
                            setRemnawaveEditorSaving(true)
                            try {
                              await updateRemnawaveProfile(profile.id, { name: remnawaveEditorData.name.trim(), settings: { base_url: remnawaveEditorData.base_url.trim(), token: remnawaveEditorData.token.trim() || undefined }, botProfileIds: remnawaveEditorData.botProfileId ? [remnawaveEditorData.botProfileId] : [] })
                              notify('success', 'Профиль Remnawave обновлён')
                              window.dispatchEvent(new Event('remnawaveProfilesChanged'))
                              await loadRemnawaveProfiles()
                              closeRemnawaveEditor()
                            } catch (error: unknown) { notify('error', error instanceof Error ? error.message : 'Ошибка сохранения') }
                            finally { setRemnawaveEditorSaving(false) }
                          }} disabled={remnawaveEditorSaving} type="button"
                            className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20 disabled:opacity-50 transition-colors">
                            {remnawaveEditorSaving ? 'Сохранение…' : 'Сохранить'}
                          </button>
                          <button onClick={closeRemnawaveEditor} type="button"
                            className="flex-1 py-1.5 text-xs rounded-lg bg-overlay-sm hover:bg-overlay-md text-secondary border border-default transition-colors">Отмена</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Create card */}
            <div className="w-full max-w-full sm:max-w-[340px] [perspective:1000px]">
              <div className={`relative h-[370px] transition-transform duration-500 [transform-style:preserve-3d] ${flippedRemnawaveCardId === 'create' ? '[transform:rotateY(180deg)]' : ''}`}>
                {/* Front */}
                <div className="absolute inset-0 [backface-visibility:hidden]">
                  <div onClick={() => openRemnawaveEditor()}
                    className="w-full h-full rounded-xl border-2 border-dashed border-default hover:border-purple-500/30 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors group">
                    <div className="w-10 h-10 rounded-full bg-overlay-xs group-hover:bg-purple-500/10 flex items-center justify-center transition-colors">
                      <svg className="w-5 h-5 text-muted group-hover:text-purple-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    </div>
                    <span className="text-sm font-medium text-muted group-hover:text-purple-400 transition-colors">Добавить профиль</span>
                  </div>
                </div>
                {/* Back */}
                <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  <div className="bg-gradient-to-br from-purple-500/8 to-purple-600/3 border-purple-500/25 rounded-xl p-4 border flex flex-col gap-3 h-full">
                    <div className="text-sm font-semibold text-primary">Новый профиль Remnawave</div>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-muted mb-1">Название</label>
                        <input type="text" value={remnawaveEditorData.name} onChange={(e) => setRemnawaveEditorData({ ...remnawaveEditorData, name: e.target.value })}
                          placeholder="Remnawave Profile" autoComplete="off"
                          className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Привязка к боту</label>
                        <DarkSelect value={remnawaveEditorData.botProfileId} onChange={(v) => setRemnawaveEditorData({ ...remnawaveEditorData, botProfileId: v })}
                          groups={botProfileGroups} buttonClassName="w-full px-3 py-2 text-sm rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Домен Remnawave</label>
                        <input type="text" value={remnawaveEditorData.base_url} onChange={(e) => setRemnawaveEditorData({ ...remnawaveEditorData, base_url: e.target.value })}
                          placeholder="https://panel.example.com" autoComplete="off"
                          className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Токен <span className="text-red-400">*</span></label>
                        <input type="password" value={remnawaveEditorData.token} onChange={(e) => setRemnawaveEditorData({ ...remnawaveEditorData, token: e.target.value })}
                          placeholder="Токен Remnawave" autoComplete="new-password"
                          className="w-full px-3 py-2 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        if (remnawaveEditorSaving) return
                        if (!remnawaveEditorData.name.trim()) { notify('error', 'Введите название профиля'); return }
                        if (!remnawaveEditorData.base_url.trim() || !isValidUrl(remnawaveEditorData.base_url)) { notify('error', 'Введите корректный домен'); return }
                        if (!remnawaveEditorData.token.trim()) { notify('error', 'Введите токен Remnawave'); return }
                        setRemnawaveEditorSaving(true)
                        try {
                          await createRemnawaveProfile({ name: remnawaveEditorData.name.trim(), settings: { base_url: remnawaveEditorData.base_url.trim(), token: remnawaveEditorData.token.trim() }, botProfileIds: remnawaveEditorData.botProfileId ? [remnawaveEditorData.botProfileId] : [] })
                          notify('success', 'Профиль Remnawave создан')
                          window.dispatchEvent(new Event('remnawaveProfilesChanged'))
                          await loadRemnawaveProfiles()
                          closeRemnawaveEditor()
                        } catch (error: unknown) { notify('error', error instanceof Error ? error.message : 'Ошибка сохранения') }
                        finally { setRemnawaveEditorSaving(false) }
                      }} disabled={remnawaveEditorSaving} type="button"
                        className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20 disabled:opacity-50 transition-colors">
                        {remnawaveEditorSaving ? 'Сохранение…' : 'Сохранить'}
                      </button>
                      <button onClick={closeRemnawaveEditor} type="button"
                        className="flex-1 py-1.5 text-xs rounded-lg bg-overlay-sm hover:bg-overlay-md text-secondary border border-default transition-colors">Отмена</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Настройки мониторинга */}
        {showMonitoring && (
        <div id="settings-section-notifications" className="glass-panel p-4 sm:p-6 mt-4 sm:mt-6">
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg sm:text-xl font-bold text-primary">Настройки мониторинга</h2>
            </div>
            <p className="text-sm text-muted">
              Изменения сохраняются автоматически.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-secondary mb-2">
                Интервал обновления (сек)
              </label>
              <input
                type="number"
                value={Math.round(Number(monitoringSettings.refreshInterval || 0) / 1000)}
                onChange={(e) => {
                  const sec = parseInt(e.target.value, 10) || 0
                  setMonitoringSettings({ ...monitoringSettings, refreshInterval: Math.max(0, sec) * 1000 })
                }}
                onBlur={(e) => {
                  const sec = parseInt(e.target.value, 10) || 20
                  if (sec < 20) {
                    setMonitoringSettings({ ...monitoringSettings, refreshInterval: 20000 })
                  }
                }}
                min="20"
                step="1"
                className="w-full px-3 py-2 bg-overlay-md border border-default rounded-md focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary"
              />
              <p className="mt-1 text-xs text-muted">
                Минимальный интервал: 20 секунд. Рекомендуется: 30 секунд
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-secondary">Что мониторить</div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <NeonCheckbox
                    checked={Boolean(monitoringSettings.monitorBotApi)}
                    onChange={(v) => setMonitoringSettings({ ...monitoringSettings, monitorBotApi: v })}
                    ariaLabel="Мониторить BOT API"
                  />
                  <span>BOT API</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <NeonCheckbox
                    checked={Boolean(monitoringSettings.monitorRemnawaveApi)}
                    onChange={(v) =>
                      setMonitoringSettings({
                        ...monitoringSettings,
                        monitorRemnawaveApi: v,
                        // If API monitoring is disabled, nodes monitoring is effectively disabled too.
                        monitorRemnawaveNodes: v ? monitoringSettings.monitorRemnawaveNodes : false
                      })
                    }
                    ariaLabel="Мониторить Remnawave API"
                  />
                  <span>Remnawave API</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <NeonCheckbox
                    checked={Boolean(monitoringSettings.monitorRemnawaveNodes) && Boolean(monitoringSettings.monitorRemnawaveApi)}
                    disabled={!monitoringSettings.monitorRemnawaveApi}
                    onChange={(v) => setMonitoringSettings({ ...monitoringSettings, monitorRemnawaveNodes: v })}
                    ariaLabel="Мониторить узлы Remnawave"
                  />
                  <span>Узлы Remnawave</span>
                </div>
              </div>
              <p className="text-xs text-muted">
                Если пункт отключен — в шапке статусов будет “Отключено”, и проверки/уведомления для него не выполняются.
              </p>
            </div>

            {/* System monitor card */}
            <div className="space-y-2 pt-2 border-t border-default">
              <div className="text-sm font-medium text-secondary">Плашка мониторинга системы (Дашборд)</div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <NeonCheckbox
                    checked={Boolean((monitoringSettings as any)?.systemWidget?.enabled)}
                    onChange={(v) =>
                      setMonitoringSettings({
                        ...monitoringSettings,
                        systemWidget: { ...(monitoringSettings as any).systemWidget, enabled: v },
                      })
                    }
                    ariaLabel="Плашка мониторинга системы"
                  />
                  <span>Включить плашку мониторинга</span>
                </div>

                {Boolean((monitoringSettings as any)?.systemWidget?.enabled) && (
                  <div className="ml-8 space-y-2">
                    <div>
                      <label className="block text-xs text-muted mb-1">Частота обновления (сек)</label>
                      <input
                        type="number"
                        min={5}
                        max={300}
                        step={1}
                        value={Number((monitoringSettings as any)?.systemWidget?.pollSec ?? 10)}
                        onChange={(e) => {
                          const v = Math.round(Number(e.target.value) || 0)
                          // Не ограничиваем жестко при вводе, чтобы можно было стереть и написать
                          setMonitoringSettings({
                            ...monitoringSettings,
                            systemWidget: { ...(monitoringSettings as any).systemWidget, pollSec: v },
                          })
                        }}
                        onBlur={(e) => {
                          const v = Math.round(Number(e.target.value) || 0)
                          const clamped = Math.max(5, Math.min(300, v || 10))
                          setMonitoringSettings({
                            ...monitoringSettings,
                            systemWidget: { ...(monitoringSettings as any).systemWidget, pollSec: clamped },
                          })
                        }}
                        className="w-full sm:w-[220px] px-3 py-2 bg-overlay-md border border-default rounded-md focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary"
                      />
                      <p className="mt-1 text-[11px] text-muted">
                        Минимум 5 сек.
                      </p>
                    </div>
                    <div className="text-xs text-muted">Показывать метрики:</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {([
                        ['showCpu', 'CPU'],
                        ['showRam', 'RAM'],
                        ['showSwap', 'Swap'],
                        ['showDisk', 'Disk'],
                        ['showNetwork', 'Network'],
                        ['showBotRam', 'Bot RAM'],
                        ['showBotCpu', 'Bot CPU'],
                        ['showPanelRam', 'Panel RAM'],
                        ['showPanelCpu', 'Panel CPU'],
                      ] as Array<[string, string]>).map(([key, label]) => (
                        <div key={key} className="flex items-center gap-2 text-sm text-secondary">
                          <NeonCheckbox
                            checked={Boolean((monitoringSettings as any)?.systemWidget?.[key])}
                            onChange={(v) =>
                              setMonitoringSettings({
                                ...monitoringSettings,
                                systemWidget: { ...(monitoringSettings as any).systemWidget, [key]: v },
                              })
                            }
                            ariaLabel={`Показывать ${label}`}
                          />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted">
                Эта плашка показывает нагрузку сервера и потребление процесса бота (по systemd PID).
              </p>
            </div>
          </div>
        </div>
        )}

        {/* Настройки уведомлений */}
        {showNotifications && (
        <div id="settings-section-general" className="glass-panel p-4 sm:p-6 mt-4 sm:mt-6">
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg sm:text-xl font-bold text-primary">Настройки уведомлений</h2>
            </div>
            <p className="text-sm text-muted">
              Изменения сохраняются автоматически.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <NeonCheckbox
                  checked={Boolean(monitoringSettings.panelNotificationsEnabled)}
                  onChange={(v) => setMonitoringSettings({ ...monitoringSettings, panelNotificationsEnabled: v })}
                  ariaLabel="Уведомления в панели"
                />
                <span className="text-sm font-medium text-secondary">
                  Уведомления в панели (колокольчик)
                </span>
              </div>

              {Boolean(monitoringSettings.panelNotificationsEnabled) && (
                <div className="ml-8 space-y-2">
                  <div className="text-xs text-muted">В панели показывать:</div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-sm text-secondary">
                      <NeonCheckbox
                        checked={Boolean(monitoringSettings.panelNotifyOnDown)}
                        onChange={(v) => setMonitoringSettings({ ...monitoringSettings, panelNotifyOnDown: v })}
                        ariaLabel="Показывать падение в панели"
                      />
                      <span>Падение</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-secondary">
                      <NeonCheckbox
                        checked={Boolean(monitoringSettings.panelNotifyOnRecovery)}
                        onChange={(v) => setMonitoringSettings({ ...monitoringSettings, panelNotifyOnRecovery: v })}
                        ariaLabel="Показывать восстановление в панели"
                      />
                      <span>Восстановление</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-secondary">
                      <NeonCheckbox
                        checked={Boolean(monitoringSettings.panelNotifyPayments)}
                        onChange={(v) => setMonitoringSettings({ ...monitoringSettings, panelNotifyPayments: v })}
                        ariaLabel="Показывать платежи в панели"
                      />
                      <span>Новые платежи</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-secondary">
                      <NeonCheckbox
                        checked={Boolean(monitoringSettings.panelNotifyUsers)}
                        onChange={(v) => setMonitoringSettings({ ...monitoringSettings, panelNotifyUsers: v })}
                        ariaLabel="Показывать новых пользователей в панели"
                      />
                      <span>Новые пользователи</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <NeonCheckbox
                  checked={Boolean(monitoringSettings.telegramNotificationsEnabled)}
                  onChange={(v) =>
                    setMonitoringSettings({ ...monitoringSettings, telegramNotificationsEnabled: v, notificationsEnabled: v })
                  }
                  ariaLabel="Уведомления в Telegram"
                />
                <span className="text-sm font-medium text-secondary">
                  Уведомления в Telegram
                </span>
              </div>

              {Boolean(monitoringSettings.telegramNotificationsEnabled) && (
                <div className="ml-8 space-y-4">
                  <div className="space-y-2">
                    <div className="text-xs text-muted">В Telegram отправлять:</div>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-sm text-secondary">
                        <NeonCheckbox
                          checked={Boolean(monitoringSettings.telegramNotifyOnDown)}
                          onChange={(v) =>
                            setMonitoringSettings({ ...monitoringSettings, telegramNotifyOnDown: v, notifyOnDown: v })
                          }
                          ariaLabel="Отправлять падение в Telegram"
                        />
                        <span>Падение</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-secondary">
                        <NeonCheckbox
                          checked={Boolean(monitoringSettings.telegramNotifyOnRecovery)}
                          onChange={(v) =>
                            setMonitoringSettings({
                              ...monitoringSettings,
                              telegramNotifyOnRecovery: v,
                              notifyOnRecovery: v,
                            })
                          }
                          ariaLabel="Отправлять восстановление в Telegram"
                        />
                        <span>Восстановление</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-default">
                    <label className="block text-sm font-medium text-secondary mb-2">
                      Шаблон уведомлений
                    </label>
                    <DarkSelect
                      value={monitoringSettings.notificationTemplate}
                      onChange={(v) =>
                        setMonitoringSettings({
                          ...monitoringSettings,
                          notificationTemplate: v as keyof typeof notificationTemplates,
                        })
                      }
                      groups={[
                        {
                          options: Object.entries(notificationTemplates).map(([key, template]) => ({
                            value: key,
                            label: template.name,
                          })),
                        },
                      ]}
                      buttonClassName="w-full px-3 py-2 rounded-md border border-default bg-transparent hover:bg-overlay-sm text-primary focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/40"
                    />

                    <div className="mt-3 p-3 bg-overlay-sm rounded-md border border-subtle">
                      <p className="text-xs text-muted mb-3">Предпросмотр шаблона:</p>
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-medium text-muted mb-2">Сервис — падение:</p>
                          <div className="text-xs text-dim whitespace-pre-line bg-overlay-sm p-2 rounded">
                            {notificationTemplates[monitoringSettings.notificationTemplate].down
                              .replace(/{name}/g, 'BOT API')
                              .replace(/{profile}/g, 'Main Bot')
                              .replace(/{ip}/g, 'https://example.com/adminpanel/api')
                              .replace(/{url}/g, 'https://example.com/adminpanel/api')
                              .replace(/{time}/g, new Date().toLocaleString('ru-RU'))
                              .replace(/{error}/g, '\n❌ Ошибка: Timeout')}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted mb-2">Сервис — восстановление:</p>
                          <div className="text-xs text-dim whitespace-pre-line bg-overlay-sm p-2 rounded">
                            {notificationTemplates[monitoringSettings.notificationTemplate].recovery
                              .replace(/{name}/g, 'BOT API')
                              .replace(/{profile}/g, 'Main Bot')
                              .replace(/{ip}/g, 'https://example.com/adminpanel/api')
                              .replace(/{url}/g, 'https://example.com/adminpanel/api')
                              .replace(/{time}/g, new Date().toLocaleString('ru-RU'))
                              .replace(/{downtime}/g, '5м 23с')
                              .replace(/{error}/g, '')}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted">
                            Переменные: {'{name}'}, {'{profile}'}, {'{url}'}/{'{ip}'}, {'{time}'}, {'{error}'}, {'{downtime}'}.
                            {' {error}'} добавляется в “падение” (причина/сообщение).
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-default">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-secondary">
                        Получатели уведомлений
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2">
                          {testNotificationStatus === 'sending' && (
                            <span className="text-sm text-muted">Отправка...</span>
                          )}
                          {testNotificationStatus === 'success' && (
                            <span className="text-sm text-green-400">✓ Отправлено</span>
                          )}
                          {testNotificationStatus === 'error' && (
                            <span className="text-sm text-red-400">✗ Ошибка</span>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              // Отправка тестового уведомления
                              const settings = monitoringSettings
                              if (!settings.telegramNotificationsEnabled || settings.recipients.length === 0) {
                                setTestNotificationStatus('error')
                                window.setTimeout(() => setTestNotificationStatus('idle'), 3000)
                                // Таймер будет очищен автоматически
                                return
                              }

                              setTestNotificationStatus('sending')

                              try {
                                const selectedTemplate =
                                  notificationTemplates[monitoringSettings.notificationTemplate] ?? notificationTemplates.template2
                                const activeProfile =
                                  profiles.find((p: BotProfile) => p.id === activeProfileId) ?? profiles[0]
                                const sampleProfileName = activeProfile?.name || 'Main Bot'
                                const sampleUrl = activeProfile?.botApiUrl || 'https://example.com/adminpanel/api'
                                const sampleTime = new Date().toLocaleString('ru-RU')
                                const sampleError = '\n❌ Ошибка: Timeout'

                                const testText = String(selectedTemplate.down || '')
                                  .replace(/{name}/g, 'BOT API')
                                  .replace(/{profile}/g, sampleProfileName)
                                  .replace(/{ip}/g, sampleUrl)
                                  .replace(/{url}/g, sampleUrl)
                                  .replace(/{time}/g, sampleTime)
                                  .replace(/{error}/g, sampleError)
                                  .replace(/{downtime}/g, '5м 23с')

                                const sendPromises: Promise<void>[] = []
                                
                                settings.recipients.forEach((recipient) => {
                                  let chatId = ''
                                  let messageThreadId: number | undefined = undefined
                                  let botToken = ''

                                  if (recipient.mode === 'channel') {
                                    if (!recipient.channelId) return
                                    chatId = recipient.channelId
                                    if (recipient.threadId) {
                                      messageThreadId = parseInt(recipient.threadId)
                                    }
                                    // Для канала/группы используем токен из поля botToken (как и на сервере).
                                    if (!recipient.botToken) return
                                    botToken = recipient.botToken
                                  } else {
                                    // Для бота используем токен из поля botToken
                                    if (!recipient.botToken || !recipient.userId) return
                                    botToken = recipient.botToken
                                    chatId = recipient.userId
                                  }

                                  const promise = fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({
                                      chat_id: chatId,
                                      text: testText,
                                      parse_mode: 'HTML',
                                      ...(messageThreadId !== undefined && { message_thread_id: messageThreadId })
                                    })
                                    }).then(async response => {
                                    if (!response.ok) {
                                      const errorText = await response.text()
                                      throw new Error(errorText)
                                    }
                                  })
                                  
                                  sendPromises.push(promise)
                                })

                                await Promise.all(sendPromises)
                                setTestNotificationStatus('success')
                                window.setTimeout(() => setTestNotificationStatus('idle'), 3000)
                                // Таймер будет очищен автоматически
                              } catch {
                                setTestNotificationStatus('error')
                                window.setTimeout(() => setTestNotificationStatus('idle'), 3000)
                                // Таймер будет очищен автоматически
                              }
                            }}
                            className="px-3 py-1 text-sm bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded-lg transition-colors border border-orange-500/30"
                          >
                            🧪 Тест
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {monitoringSettings.recipients.map((recipient, index) => {
                        const isFlipped = flippedRecipientCardId === recipient.id
                        const selectedProfilesCount = (recipient.botProfileIds || []).length

                        return (
                          <div key={recipient.id} className="w-full sm:w-[340px] [perspective:1000px]">
                            <div className={`relative h-[420px] transition-transform duration-500 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                              {/* Front */}
                              <div className="absolute inset-0 [backface-visibility:hidden]">
                                <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/35 hover:border-blue-400/60 hover:shadow-blue-500/10 rounded-xl p-4 border flex flex-col h-full transition-colors duration-200 hover:shadow-lg">
                                  <div className="flex items-center gap-2 mb-3">
                                    <div className="w-2 h-2 rounded-full bg-blue-400/70" />
                                    <h3 className="text-lg font-semibold text-primary truncate">Получатель #{index + 1}</h3>
                                  </div>
                                  <div className="flex-1 space-y-2 text-sm">
                                    <p><span className="text-muted">Режим:</span> <span className="text-secondary">{recipient.mode === 'bot' ? 'Bot → пользователь' : 'Bot → канал'}</span></p>
                                    {recipient.mode === 'bot' && recipient.userId && (
                                      <p><span className="text-muted">User ID:</span> <span className="text-secondary">{recipient.userId}</span></p>
                                    )}
                                    {recipient.mode === 'channel' && recipient.channelId && (
                                      <p><span className="text-muted">Channel ID:</span> <span className="text-secondary">{recipient.channelId}</span></p>
                                    )}
                                    {selectedProfilesCount > 0 ? (
                                      <div>
                                        <p className="text-muted mb-1">Профили:</p>
                                        {profiles.filter(p => (recipient.botProfileIds || []).includes(p.id)).map((profile) => (
                                          <div key={profile.id} className="text-secondary pl-2 truncate">• {profile.name}</div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-muted italic">Нет привязанных профилей</p>
                                    )}
                                  </div>
                                  <div className="flex gap-2 mt-3">
                                    <button onClick={() => setFlippedRecipientCardId(recipient.id)} type="button"
                                      className="flex-1 py-1.5 text-xs rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/25 transition-colors">
                                      Редактировать
                                    </button>
                                    <button onClick={() => {
                                      const updatedSettings = { ...monitoringSettings, recipients: monitoringSettings.recipients.filter(r => r.id !== recipient.id) }
                                      setMonitoringSettings(updatedSettings)
                                    }} type="button"
                                      className="py-1.5 px-3 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 transition-colors">
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                  </div>
                                </div>
                              </div>
                              {/* Back */}
                              <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                                <div className="bg-gradient-to-br from-blue-500/8 to-blue-600/3 border-blue-500/25 rounded-xl p-4 border flex flex-col gap-2 h-full">
                                  <div className="text-sm font-semibold text-primary flex-shrink-0">Получатель #{index + 1}</div>
                                  <div className="flex-1 space-y-2 min-h-0 overflow-hidden">
                                    <div>
                                      <label className="block text-xs text-muted mb-1">Профили ботов *</label>
                                      <div className="space-y-1">
                                        {profiles.map((profile) => {
                                          const isSelected = (recipient.botProfileIds || []).includes(profile.id)
                                          return (
                                            <div key={profile.id} className="flex items-center gap-2 p-1.5 bg-overlay-xs rounded-md border border-subtle hover:bg-overlay-sm transition-colors">
                                              <NeonCheckbox
                                                checked={isSelected}
                                                onChange={(checked) => {
                                                  const updated = [...monitoringSettings.recipients]
                                                  const currentProfileIds = recipient.botProfileIds || []
                                                  if (checked) {
                                                    updated[index] = { ...recipient, botProfileIds: [...currentProfileIds, profile.id], userId: recipient.mode === 'bot' && !recipient.userId && currentProfileIds.length === 0 ? profile.adminId : recipient.userId }
                                                  } else {
                                                    updated[index] = { ...recipient, botProfileIds: currentProfileIds.filter(id => id !== profile.id) }
                                                  }
                                                  setMonitoringSettings({ ...monitoringSettings, recipients: updated })
                                                }}
                                                ariaLabel={`Получатель: профиль ${profile.name}`}
                                              />
                                              <span className="text-xs text-primary truncate flex-1">{profile.name}</span>
                                              {isSelected && <span className="text-xs text-green-400">✓</span>}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                    <div>
                                      <label className="block text-xs text-muted mb-1">Режим отправки</label>
                                      <DarkSelect value={recipient.mode || 'bot'} onChange={(mode) => {
                                        const updated = [...monitoringSettings.recipients]
                                        updated[index] = { ...recipient, mode: mode as 'bot' | 'channel', channelId: mode === 'channel' ? recipient.channelId : undefined, threadId: mode === 'channel' ? recipient.threadId : undefined }
                                        setMonitoringSettings({ ...monitoringSettings, recipients: updated })
                                      }} groups={recipientModeGroups}
                                        buttonClassName="w-full px-3 py-1.5 text-sm rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-30" />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-muted mb-1">Токен бота *</label>
                                      <input type="text" value={recipient.botToken || ''} onChange={(e) => { const updated = [...monitoringSettings.recipients]; updated[index] = { ...recipient, botToken: e.target.value }; setMonitoringSettings({ ...monitoringSettings, recipients: updated }) }}
                                        placeholder="123456789:ABCdef..." autoComplete="off"
                                        className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                                    </div>
                                    {recipient.mode === 'bot' ? (
                                      <div>
                                        <label className="block text-xs text-muted mb-1">ID пользователя *</label>
                                        <input type="text" value={recipient.userId || ''} onChange={(e) => { const updated = [...monitoringSettings.recipients]; updated[index] = { ...recipient, userId: e.target.value }; setMonitoringSettings({ ...monitoringSettings, recipients: updated }) }}
                                          placeholder="123456789" autoComplete="off"
                                          className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                                      </div>
                                    ) : (
                                      <>
                                        <div>
                                          <label className="block text-xs text-muted mb-1">ID канала/группы *</label>
                                          <input type="text" value={recipient.channelId || ''} onChange={(e) => { const updated = [...monitoringSettings.recipients]; updated[index] = { ...recipient, channelId: e.target.value }; setMonitoringSettings({ ...monitoringSettings, recipients: updated }) }}
                                            placeholder="-1001234567890" autoComplete="off"
                                            className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                                        </div>
                                        <div>
                                          <label className="block text-xs text-muted mb-1">ID топика (опционально)</label>
                                          <input type="text" value={recipient.threadId || ''} onChange={(e) => { const updated = [...monitoringSettings.recipients]; updated[index] = { ...recipient, threadId: e.target.value }; setMonitoringSettings({ ...monitoringSettings, recipients: updated }) }}
                                            placeholder="205" autoComplete="off"
                                            className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  <div className="flex gap-2 flex-shrink-0 pt-1">
                                    <button onClick={() => setFlippedRecipientCardId(null)} type="button"
                                      className="flex-1 py-1.5 text-xs rounded-lg bg-overlay-sm hover:bg-overlay-md text-secondary border border-default transition-colors">Отмена</button>
                                    <button onClick={async () => { await saveMonitoringSettingsLocal(monitoringSettings); setFlippedRecipientCardId(null) }} type="button"
                                      className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20 transition-colors">Сохранить</button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}

                      {/* CREATE CARD */}
                      <div className="w-full sm:w-[340px] [perspective:1000px]">
                        <div className={`relative h-[420px] transition-transform duration-500 [transform-style:preserve-3d] ${flippedRecipientCardId === 'create' ? '[transform:rotateY(180deg)]' : ''}`}>
                          {/* Front */}
                          <div className="absolute inset-0 [backface-visibility:hidden]">
                            <div onClick={() => setFlippedRecipientCardId('create')}
                              className="w-full h-full rounded-xl border-2 border-dashed border-default hover:border-blue-500/30 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors group">
                              <div className="w-10 h-10 rounded-full bg-overlay-xs group-hover:bg-blue-500/10 flex items-center justify-center transition-colors">
                                <svg className="w-5 h-5 text-muted group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                              </div>
                              <span className="text-sm font-medium text-muted group-hover:text-blue-400 transition-colors">Добавить получателя</span>
                            </div>
                          </div>
                          {/* Back */}
                          <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                            <div className="bg-gradient-to-br from-blue-500/8 to-blue-600/3 border-blue-500/25 rounded-xl p-4 border flex flex-col gap-2 h-full">
                              <div className="text-sm font-semibold text-primary flex-shrink-0">Новый получатель</div>
                              <div className="flex-1 space-y-2 min-h-0 overflow-hidden">
                                <div>
                                  <label className="block text-xs text-muted mb-1">Профили ботов *</label>
                                  <div className="space-y-1">
                                    {profiles.map((profile) => {
                                      const isSelected = recipientEditorData.botProfileIds.includes(profile.id)
                                      return (
                                        <div key={profile.id} className="flex items-center gap-2 p-1.5 bg-overlay-xs rounded-md border border-subtle hover:bg-overlay-sm transition-colors">
                                          <NeonCheckbox
                                            checked={isSelected}
                                            onChange={(checked) => {
                                              if (checked) {
                                                setRecipientEditorData({ ...recipientEditorData, botProfileIds: [...recipientEditorData.botProfileIds, profile.id], userId: recipientEditorData.mode === 'bot' && !recipientEditorData.userId ? profile.adminId : recipientEditorData.userId })
                                              } else {
                                                setRecipientEditorData({ ...recipientEditorData, botProfileIds: recipientEditorData.botProfileIds.filter(id => id !== profile.id) })
                                              }
                                            }}
                                            ariaLabel={`Новый получатель: профиль ${profile.name}`}
                                          />
                                          <span className="text-xs text-primary truncate flex-1">{profile.name}</span>
                                          {isSelected && <span className="text-xs text-green-400">✓</span>}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs text-muted mb-1">Режим отправки</label>
                                  <DarkSelect value={recipientEditorData.mode} onChange={(mode) => setRecipientEditorData({ ...recipientEditorData, mode: mode as 'bot' | 'channel', channelId: mode === 'channel' ? recipientEditorData.channelId : '', threadId: mode === 'channel' ? recipientEditorData.threadId : '' })}
                                    groups={recipientModeGroups}
                                    buttonClassName="w-full px-3 py-1.5 text-sm rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-30" />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted mb-1">Токен бота *</label>
                                  <input type="text" value={recipientEditorData.botToken} onChange={(e) => setRecipientEditorData({ ...recipientEditorData, botToken: e.target.value })}
                                    placeholder="123456789:ABCdef..." autoComplete="off"
                                    className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                                </div>
                                {recipientEditorData.mode === 'bot' ? (
                                  <div>
                                    <label className="block text-xs text-muted mb-1">ID пользователя *</label>
                                    <input type="text" value={recipientEditorData.userId} onChange={(e) => setRecipientEditorData({ ...recipientEditorData, userId: e.target.value })}
                                      placeholder="123456789" autoComplete="off"
                                      className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                                  </div>
                                ) : (
                                  <>
                                    <div>
                                      <label className="block text-xs text-muted mb-1">ID канала/группы *</label>
                                      <input type="text" value={recipientEditorData.channelId} onChange={(e) => setRecipientEditorData({ ...recipientEditorData, channelId: e.target.value })}
                                        placeholder="-1001234567890" autoComplete="off"
                                        className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-muted mb-1">ID топика (опционально)</label>
                                      <input type="text" value={recipientEditorData.threadId} onChange={(e) => setRecipientEditorData({ ...recipientEditorData, threadId: e.target.value })}
                                        placeholder="205" autoComplete="off"
                                        className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                                    </div>
                                  </>
                                )}
                              </div>
                              <div className="flex gap-2 flex-shrink-0 pt-1">
                                <button onClick={() => { setFlippedRecipientCardId(null); setRecipientEditorData({ botProfileIds: [], mode: 'bot', botToken: '', userId: '', channelId: '', threadId: '' }) }} type="button"
                                  className="flex-1 py-1.5 text-xs rounded-lg bg-overlay-sm hover:bg-overlay-md text-secondary border border-default transition-colors">Отмена</button>
                                <button onClick={async () => {
                                  const maxId = monitoringSettings.recipients.length > 0 ? Math.max(...monitoringSettings.recipients.map(r => { const n = parseInt(r.id); return isNaN(n) ? 0 : n })) : 0
                                  const newRecipient: NotificationRecipient = { id: (maxId + 1).toString(), botProfileIds: recipientEditorData.botProfileIds, mode: recipientEditorData.mode, botToken: recipientEditorData.botToken, userId: recipientEditorData.userId, channelId: recipientEditorData.mode === 'channel' ? recipientEditorData.channelId : undefined, threadId: recipientEditorData.mode === 'channel' && recipientEditorData.threadId ? recipientEditorData.threadId : undefined }
                                  const updatedSettings = { ...monitoringSettings, recipients: [...monitoringSettings.recipients, newRecipient] }
                                  ignoreNextMonitoringAutosaveRef.current = true
                                  setMonitoringSettings(updatedSettings)
                                  await saveMonitoringSettingsLocal(updatedSettings)
                                  setFlippedRecipientCardId(null)
                                  setRecipientEditorData({ botProfileIds: [], mode: 'bot', botToken: '', userId: '', channelId: '', threadId: '' })
                                }} type="button"
                                  className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20 transition-colors">Сохранить</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
        )}

        {/* Confirm: удаление привязки Remnawave (через портал, чтобы центровалось по экрану) */}
        {showDeleteRemnawaveConfirm && (
          <ConfirmModal
            isOpen={!!showDeleteRemnawaveConfirm}
            title="Подтвердите удаление"
            message={`Вы уверены, что хотите удалить привязку Remnawave для профиля "${profiles.find((p) => p.id === showDeleteRemnawaveConfirm)?.name || showDeleteRemnawaveConfirm}"?`}
            onConfirm={() => deleteRemnawaveSettingsLocal(showDeleteRemnawaveConfirm)}
            onCancel={() => setShowDeleteRemnawaveConfirm(null)}
            confirmText="Удалить"
            cancelText="Отмена"
          />
        )}


        {/* Confirm: удаление профиля бота (через портал, чтобы центровалось по экрану) */}
        {confirmDeleteProfile && (
          <ConfirmModal
            isOpen={!!confirmDeleteProfile}
            title={confirmDeleteProfile.title}
            message={confirmDeleteProfile.message}
            onConfirm={confirmDeleteProfile.onConfirm}
            onCancel={() => setConfirmDeleteProfile(null)}
            confirmText={confirmDeleteProfile.confirmText || 'Подтвердить'}
            cancelText="Отмена"
          />
        )}

        {/* Модальное окно редактора профиля Remnawave */}

        {/* UI / Branding - в конце страницы */}
        {showOther && (
        <div id="settings-section-branding" className="glass-panel p-4 sm:p-6 mt-4 sm:mt-6">
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg sm:text-xl font-bold text-primary">Название панели</h2>
            </div>
            <p className="text-sm text-muted">
              Меняет подпись в верхнем меню и заголовок вкладки браузера. Изменения сохраняются автоматически.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Заголовок вкладки браузера</label>
              <input
                value={uiSettings.browserTitle}
                onChange={(e) => setUiSettings({ ...uiSettings, browserTitle: e.target.value })}
                onBlur={() => {
                  const v = String(uiSettingsRef.current.browserTitle || '').trim()
                  if (!v) setUiSettings((s) => ({ ...s, browserTitle: lastSavedUiSettingsRef.current.browserTitle }))
                }}
                className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary"
                placeholder="Web Panel"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Верхнее меню</label>
              <input
                value={uiSettings.brandTitle}
                onChange={(e) => setUiSettings({ ...uiSettings, brandTitle: e.target.value })}
                onBlur={() => {
                  const v = String(uiSettingsRef.current.brandTitle || '').trim()
                  if (!v) setUiSettings((s) => ({ ...s, brandTitle: lastSavedUiSettingsRef.current.brandTitle }))
                }}
                className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary"
                placeholder="WebPanel"
              />
            </div>
          </div>
        </div>
        )}

        {/* LK is configured inside bot profile card */}

        {/* Confirm Modal для удаления профиля Remnawave */}
        {deleteRemnawaveProfileId && (
          <ConfirmModal
            isOpen={!!deleteRemnawaveProfileId}
            title="Подтвердите удаление"
            message={`Вы уверены, что хотите удалить профиль "${remnawaveProfiles.find(p => p.id === deleteRemnawaveProfileId)?.name || deleteRemnawaveProfileId}"?`}
            onConfirm={async () => {
              if (deleteRemnawaveProfileId) {
                try {
                  await deleteRemnawaveProfile(deleteRemnawaveProfileId)
                  await loadRemnawaveProfiles()
                  notify('success', 'Профиль Remnawave удален')
                  window.dispatchEvent(new Event('remnawaveProfilesChanged'))
                } catch (error: unknown) {
                  const errorMessage = error instanceof Error ? error.message : 'Ошибка удаления профиля'
                  notify('error', errorMessage)
                }
                setDeleteRemnawaveProfileId(null)
              }
            }}
            onCancel={() => setDeleteRemnawaveProfileId(null)}
            confirmText="Удалить"
            cancelText="Отмена"
          />
        )}

      </div>
  )
}

