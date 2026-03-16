import { useId, useState, useEffect, useMemo } from 'react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { createBotKey, updateBotKey, updateBotKeyByEmail, getBotServers, getKeyTraffic, resetKeyTraffic, reissueKeyFull, reissueKeyLink, deleteBotKey, saveKeyConfig, getBotKey } from '../../api/botApi'
import { trackPanelAuditEvent } from '../../api/client'
import ModalShell, { modalSecondaryButtonClass } from '../common/ModalShell'
import ConfirmModal from '../common/ConfirmModal'
import { toMskDateTimeLocal, fromMskDateTimeLocal } from '../../utils/dateUtils'
import { useToastContext } from '../../contexts/ToastContext'
import DarkSelect, { type DarkSelectGroup } from '../common/DarkSelect'
import CopyText from '../ui/CopyText'

interface KeyEditModalProps {
  tgId: number
  editingKey?: any
  tariffs: any[]
  onClose: () => void
  onSaved: () => void
  onUpdated?: () => void
}

// Генерация случайного email (8 символов)
function generateRandomEmail(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function formatMsk(ts: any): string {
  try {
    if (!ts) return '—'
    const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
    if (Number.isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return '—'
  }
}

function formatLimit(v: any, unit?: string): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  if (n <= 0) return 'Безлимит'
  return unit ? `${n} ${unit}` : String(n)
}

// Генерация UUID v4 для client_id
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

export default function KeyEditModal({
  tgId,
  editingKey,
  tariffs,
  onClose,
  onSaved,
  onUpdated,
}: KeyEditModalProps) {
  const formId = useId()
  const toast = useToastContext()
  const [formData, setFormData] = useState({
    email: '',
    tariff_name: '',
    cluster_or_server: '',
    expiry_time: '',
    is_frozen: false,
    selected_device_limit: '' as string | number,
    selected_traffic_limit_gb: '' as string | number,
  })
  const [allOptions, setAllOptions] = useState<Array<{value: string, label: string, type: 'cluster' | 'server', clusterName?: string}>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const [liveKey, setLiveKey] = useState<any>(editingKey || null)
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  const audit = (action: string, meta?: Record<string, unknown>) => {
    const safeMeta: Record<string, unknown> = {
      ...(meta || {}),
    }
    // Never log full key/link content.
    if ('key' in safeMeta) delete (safeMeta as any).key
    if ('link' in safeMeta) delete (safeMeta as any).link
    void trackPanelAuditEvent({
      action: String(action || '').trim() || 'unknown',
      target_type: 'bot_key',
      target_id: String((safeMeta as any)?.key_id || (safeMeta as any)?.client_id || (safeMeta as any)?.id || ''),
      meta: safeMeta,
    }).catch(() => {})
  }

  // Активная inline-панель (открывается под кнопками при клике)
  const [activePanel, setActivePanel] = useState<'expiry' | 'tariff' | 'config' | 'reissue' | null>(null)
  const togglePanel = (panel: 'expiry' | 'tariff' | 'config' | 'reissue') => {
    setActivePanel(p => p === panel ? null : panel)
  }

  // Config like in bot admin ("Конфигурация ключа")
  const [cfgTab, setCfgTab] = useState<'base' | 'addon'>('base')
  const [cfgBaseDevices, setCfgBaseDevices] = useState<number>(1)
  const [cfgBaseTrafficGb, setCfgBaseTrafficGb] = useState<number>(0) // 0 => unlimited
  const [cfgExtraDevices, setCfgExtraDevices] = useState<number>(0)
  const [cfgExtraTrafficGb, setCfgExtraTrafficGb] = useState<number>(0)
  const [cfgSaving, setCfgSaving] = useState(false)

  const editingKeyKey = useMemo(() => {
    if (!editingKey) return ''
    return String(editingKey.client_id || editingKey.clientId || editingKey.id || editingKey.email || '')
  }, [editingKey])

  useEffect(() => {
    if (editingKey) {
      setLiveKey(editingKey)

      // Find tariff name by ID/name (best-effort; may be filled later once tariffs load)
      let tariffName = String(editingKey.tariff_name || '').trim()
      if (!tariffName && (editingKey.tariff_id || editingKey.tariffId)) {
        const tariff = tariffs.find((t) => (t.id || t.tariff_id) === (editingKey.tariff_id || editingKey.tariffId))
        if (tariff) tariffName = String(tariff.name || tariff.tariff_name || '').trim()
      }

      const expiryTime = editingKey.expiry_time ? toMskDateTimeLocal(editingKey.expiry_time) : ''

      // cluster/server value will be set after servers load
      setFormData({
        email: String(editingKey.email || ''),
        tariff_name: tariffName,
        cluster_or_server: '',
        expiry_time: expiryTime,
        is_frozen: Boolean(editingKey.is_frozen || editingKey.frozen),
        selected_device_limit: (editingKey.current_device_limit ?? editingKey.selected_device_limit ?? '') as any,
        selected_traffic_limit_gb: (editingKey.current_traffic_limit ?? editingKey.selected_traffic_limit ?? '') as any,
      })
    } else {
      setLiveKey(null)
      setFormData({
        email: generateRandomEmail(),
        tariff_name: '',
        cluster_or_server: '',
        expiry_time: '',
        is_frozen: false,
        selected_device_limit: '',
        selected_traffic_limit_gb: '',
      })
    }
    // IMPORTANT: do not re-init the whole form on tariffs refresh
  }, [editingKeyKey])

  // If tariffs arrive later, fill missing tariff_name without resetting other fields (prevents modal "jumping")
  useEffect(() => {
    if (!editingKey) return
    if (formData.tariff_name) return

    let tariffName = String(editingKey.tariff_name || '').trim()
    if (!tariffName && (editingKey.tariff_id || editingKey.tariffId)) {
      const tariff = tariffs.find((t) => (t.id || t.tariff_id) === (editingKey.tariff_id || editingKey.tariffId))
      if (tariff) tariffName = String(tariff.name || tariff.tariff_name || '').trim()
    }

    if (tariffName) {
      setFormData((p) => ({ ...p, tariff_name: tariffName }))
    }
  }, [editingKeyKey, editingKey, tariffs, formData.tariff_name])

  useEffect(() => {
    loadServers()
  }, [editingKeyKey])

  const loadServers = async () => {
    try {
      const config = await getBotConfigAsync()
      if (!config) return

      const data = await getBotServers(config)
      const serversList = Array.isArray(data) ? data : []

      // Извлекаем уникальные кластеры
      const uniqueClusters = new Set<string>()
      serversList.forEach((server) => {
        const clusterName = (server.cluster_name || server.cluster || server.group || server.cluster_id) as string | undefined
        const serverName = (server.name || server.server_name || server.id) as string | number | undefined
        if (clusterName && typeof clusterName === 'string' && clusterName !== String(serverName)) {
          uniqueClusters.add(clusterName)
        }
      })

      // Формируем список всех опций (кластеры и серверы)
      const options: Array<{value: string, label: string, type: 'cluster' | 'server', clusterName?: string}> = []
      
      // Добавляем кластеры
      Array.from(uniqueClusters).sort().forEach((clusterName) => {
        options.push({
          value: `cluster:${clusterName}`,
          label: `Кластер: ${clusterName}`,
          type: 'cluster',
          clusterName: clusterName
        })
      })

      // Добавляем серверы (сгруппированные по кластерам)
      const serversByCluster: Record<string, any[]> = {}
      serversList.forEach((server) => {
        const clusterName = (server.cluster_name || server.cluster || server.group || server.cluster_id) as string | undefined
        const serverName = (server.name || server.server_name || server.id) as string | number | undefined
        
        if (clusterName && typeof clusterName === 'string' && clusterName !== String(serverName)) {
          if (!serversByCluster[clusterName]) {
            serversByCluster[clusterName] = []
          }
          serversByCluster[clusterName].push(server)
        } else {
          // Серверы без кластера
          options.push({
            value: `server:${serverName}`,
            label: `Сервер: ${serverName}`,
            type: 'server'
          })
        }
      })

      // Добавляем серверы по кластерам
      Object.keys(serversByCluster).sort().forEach((clusterName) => {
        serversByCluster[clusterName].forEach((server) => {
          const serverName = server.name || server.server_name || server.id
          options.push({
            value: `server:${serverName}`,
            label: `Сервер: ${serverName} (${clusterName})`,
            type: 'server',
            clusterName: clusterName
          })
        })
      })

      setAllOptions(options)

      // После загрузки серверов, если редактируем ключ, установить правильное значение
      if (editingKey && serversList.length > 0) {
        const currentServerName = String(editingKey.server_name || editingKey.server_id || '').trim()
        const currentClusterName = String(editingKey.cluster_name || editingKey.cluster_id || '').trim()

        let selectedValue = ''
        
        // Приоритет: сначала проверяем кластер, потом сервер
        if (currentClusterName) {
          // Проверяем, есть ли такой кластер в списке
          const clusterOption = options.find(opt => 
            opt.type === 'cluster' && opt.value === `cluster:${currentClusterName}`
          )
          if (clusterOption) {
            selectedValue = clusterOption.value
          } else {
            // Кластер не найден в списке, но используем его значение
            selectedValue = `cluster:${currentClusterName}`
          }
        }
        
        // Если кластер не найден или не указан, ищем сервер
        if (!selectedValue && currentServerName) {
          // Ищем сервер в списке (точное совпадение)
          let serverOption = options.find(opt => {
            if (opt.type === 'server') {
              const [, serverValue] = opt.value.split(':')
              return serverValue === currentServerName || 
                     serverValue.toLowerCase() === currentServerName.toLowerCase()
            }
            return false
          })
          
          // Если не нашли точное совпадение, ищем по частичному совпадению в label
          if (!serverOption) {
            serverOption = options.find(opt => {
              if (opt.type === 'server') {
                return opt.label.toLowerCase().includes(currentServerName.toLowerCase()) ||
                       opt.label.toLowerCase().includes(`сервер: ${currentServerName.toLowerCase()}`)
              }
              return false
            })
          }
          
          if (serverOption) {
            selectedValue = serverOption.value
          } else {
            // Сервер не найден, но используем его значение
            selectedValue = `server:${currentServerName}`
          }
        }

        // Устанавливаем значение только если оно найдено
        if (selectedValue) {
          setFormData(prev => ({
            ...prev,
            cluster_or_server: selectedValue
          }))
        }
      }
    } catch {
      // Игнорируем ошибки загрузки
    }
  }

  const getKeyId = (k: any): string | null => {
    const v = k?.client_id || k?.clientId || k?.id || null
    return v ? String(v) : null
  }

  const resolveReissueTarget = (): string | undefined => {
    const s = String(formData.cluster_or_server || '').trim()
    if (!s) return undefined
    const [, value] = s.split(':')
    if (!value) return undefined
    return String(value).trim()
  }

  const clusterOrServerGroups = useMemo<DarkSelectGroup[]>(() => {
    const base = [{ value: '', label: 'Выберите кластер или сервер' }]
    const clusters = allOptions.filter((o) => o.type === 'cluster').map((o) => ({ value: o.value, label: o.label }))
    const servers = allOptions.filter((o) => o.type === 'server').map((o) => ({ value: o.value, label: o.label }))
    const out: DarkSelectGroup[] = [{ options: base }]
    if (clusters.length > 0) out.push({ groupLabel: 'Кластеры', options: clusters })
    if (servers.length > 0) out.push({ groupLabel: 'Серверы', options: servers })
    return out
  }, [allOptions])

  const runAction = async (
    name: string,
    fn: (cfg: any, keyId: string) => Promise<any>,
    opts?: { closeOnSuccess?: boolean },
  ) => {
    if (!editingKey) return
    const keyId = getKeyId(keyView || editingKey)
    if (!keyId) {
      setError('Не найден client_id у подписки')
      toast.showError('Подписка', 'Не найден client_id у подписки')
      return
    }
    const closeOnSuccess = Boolean(opts?.closeOnSuccess)
    setActionLoading(name)
    setError(null)
    setActionInfo(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) throw new Error('Нет активного профиля')
      await fn(config, keyId)
      // Refresh key snapshot so info/config blocks update
      try {
        const fresh = await getBotKey(config, keyId)
        setLiveKey(fresh)
      } catch {
        // ignore
      }
      if (closeOnSuccess) {
        onSaved()
      } else {
        onUpdated?.()
      }
      try {
        const action =
          name === 'reissue_full'
            ? 'key.reissue_full'
            : name === 'reissue_link'
              ? 'key.reissue_link'
              : name === 'reset_traffic'
                ? 'key.reset_traffic'
                : name === 'delete'
                  ? 'key.delete'
                  : `key.action.${name}`

        const selectedTariffName = String(selectedTariff?.name || selectedTariff?.tariff_name || editingKey?.tariff_name || '').trim()
        audit(action, {
          tg_id: tgId,
          key_id: keyId,
          email: String((keyView || editingKey)?.email || formData.email || ''),
          tariff: selectedTariffName || undefined,
          cluster_or_server: formData.cluster_or_server || undefined,
          frozen: Boolean((keyView || editingKey)?.is_frozen || (keyView || editingKey)?.frozen || formData.is_frozen),
        })
      } catch {
        // ignore
      }
      const successMsg =
        name === 'reissue_full' ? 'Подписка перевыпущена'
        : name === 'reissue_link' ? 'Ссылка подписки обновлена'
        : name === 'reset_traffic' ? 'Трафик сброшен'
        : name === 'delete' ? 'Подписка удалена'
        : 'Готово'
      toast.showSuccess('Подписка', successMsg)
    } catch (err: any) {
      const msg = err?.message || 'Ошибка действия'
      setError(msg)
      toast.showError('Подписка', msg)
    } finally {
      setActionLoading(null)
    }
  }

  const toggleFreezeNow = async (next: boolean) => {
    if (!editingKey) return
    const keyId = getKeyId(keyView || editingKey)
    if (!keyId) {
      setError('Не найден client_id у подписки')
      toast.showError('Подписка', 'Не найден client_id у подписки')
      return
    }
    setActionLoading('freeze')
    setError(null)
    setActionInfo(null)
    try {
      const cfg = await getBotConfigAsync()
      if (!cfg) throw new Error('Нет активного профиля')
      const updated = await updateBotKey(cfg, keyId, { is_frozen: next })
      setLiveKey(updated)
      setFormData((p) => ({ ...p, is_frozen: next }))
      audit('key.freeze', {
        tg_id: tgId,
        key_id: keyId,
        email: String((keyView || editingKey)?.email || formData.email || ''),
        frozen: next,
      })
      toast.showSuccess('Подписка', next ? 'Подписка заморожена' : 'Подписка разморожена')
      onUpdated?.()
    } catch (err: any) {
      const msg = err?.message || 'Ошибка заморозки'
      setError(msg)
      toast.showError('Подписка', msg)
    } finally {
      setActionLoading(null)
    }
  }

  const handleViewTraffic = async () => {
    if (!editingKey) return
    const keyId = getKeyId(keyView || editingKey)
    if (!keyId) { setError('Не найден client_id у подписки'); return }
    setActionLoading('traffic'); setError(null); setActionInfo(null)
    try {
      const cfg = await getBotConfigAsync()
      if (!cfg) throw new Error('Нет активного профиля')
      const t = await getKeyTraffic(cfg, keyId)
      const payload = (t && t.traffic) ? t.traffic : t
      const lines: string[] = []
      if (payload?.status === 'success' && payload?.traffic && typeof payload.traffic === 'object') {
        for (const [k, v] of Object.entries(payload.traffic)) lines.push(`${k}: ${v}`)
      } else { lines.push(JSON.stringify(payload)) }
      setActionInfo(lines.join('\n'))
      audit('key.view_traffic', { tg_id: tgId, key_id: keyId, email: String((keyView || editingKey)?.email || formData.email || '') })
      toast.showInfo('Трафик', 'Данные получены')
    } catch (err: any) { const msg = err?.message || 'Ошибка'; setError(msg); toast.showError('Трафик', msg) }
    finally { setActionLoading(null) }
  }

  // Группировка тарифов по подгруппам
  const groupedTariffs = useMemo(() => {
    const groups: Record<string, any[]> = {}
    
    tariffs.forEach(tariff => {
      const group = tariff.group_code || tariff.group || tariff.subgroup || tariff.category || 'Без группы'
      if (!groups[group]) {
        groups[group] = []
      }
      groups[group].push(tariff)
    })

    // Сортируем группы
    const sortedGroups: Record<string, any[]> = {}
    Object.keys(groups).sort().forEach(key => {
      sortedGroups[key] = groups[key]
    })

    return sortedGroups
  }, [tariffs])

  const tariffSelectGroups = useMemo<DarkSelectGroup[]>(() => {
    const out: DarkSelectGroup[] = [{ options: [{ value: '', label: 'Выберите тариф' }] }]
    Object.entries(groupedTariffs || {}).forEach(([groupName, groupTariffs]) => {
      const options = (groupTariffs || []).map((tariff: any) => {
        const tariffName = tariff.name || tariff.tariff_name || tariff.id || tariff.tariff_id
        const label = groupName !== 'Без группы' ? `${tariffName} (${groupName})` : String(tariffName)
        return { value: String(tariffName), label }
      })
      if (options.length > 0) out.push({ groupLabel: groupName, options })
    })
    return out
  }, [groupedTariffs])

  const selectedTariff = useMemo(() => {
    if (formData.tariff_name) {
      const t = tariffs.find(x => (x.name || x.tariff_name) === formData.tariff_name)
      if (t) return t
    }
    if (editingKey?.tariff_id || editingKey?.tariffId) {
      return tariffs.find(x => (x.id || x.tariff_id) === (editingKey.tariff_id || editingKey.tariffId))
    }
    return null
  }, [formData.tariff_name, editingKey, tariffs])

  const deviceOptions: number[] = useMemo(() => {
    const raw = selectedTariff?.device_options ?? selectedTariff?.deviceOptions
    if (Array.isArray(raw)) return raw.map((v: any) => Number(v)).filter(n => Number.isFinite(n))
    return []
  }, [selectedTariff])

  const trafficOptionsGb: number[] = useMemo(() => {
    const raw = selectedTariff?.traffic_options_gb ?? selectedTariff?.trafficOptionsGb
    if (Array.isArray(raw)) return raw.map((v: any) => Number(v)).filter(n => Number.isFinite(n))
    return []
  }, [selectedTariff])

  const keyView = liveKey || editingKey

  const tariffConfigurable = Boolean((selectedTariff as any)?.configurable)
  const tariffDeviceLimitRaw = Number((selectedTariff as any)?.device_limit ?? 1)
  const tariffDeviceLimit = Number.isFinite(tariffDeviceLimitRaw) && tariffDeviceLimitRaw > 0 ? tariffDeviceLimitRaw : 1

  // Initialize config values from keyView + tariff (matches bot admin config screen)
  useEffect(() => {
    if (!keyView) return
    if (!tariffConfigurable) return

    const baseDev = Number(keyView.selected_device_limit ?? tariffDeviceLimit ?? 1)
    const currDev = Number(keyView.current_device_limit ?? baseDev)
    const extraDev = Math.max(0, currDev - baseDev)

    const baseTraffic = keyView.selected_traffic_limit == null ? 0 : Number(keyView.selected_traffic_limit)
    const currTraffic = keyView.current_traffic_limit == null ? baseTraffic : Number(keyView.current_traffic_limit)
    const extraTraffic = baseTraffic > 0 ? Math.max(0, currTraffic - baseTraffic) : 0

    setCfgBaseDevices(Number.isFinite(baseDev) && baseDev > 0 ? baseDev : 1)
    setCfgExtraDevices(Number.isFinite(extraDev) && extraDev >= 0 ? extraDev : 0)
    setCfgBaseTrafficGb(Number.isFinite(baseTraffic) && baseTraffic >= 0 ? baseTraffic : 0)
    setCfgExtraTrafficGb(Number.isFinite(extraTraffic) && extraTraffic >= 0 ? extraTraffic : 0)
  }, [keyView, tariffConfigurable, tariffDeviceLimit])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля')
        setLoading(false)
        return
      }

      if (editingKey) {
        // Редактирование
        const submitData: any = {
          tg_id: tgId
        }

        if (formData.email && formData.email !== editingKey.email) {
          submitData.email = formData.email
        }

        // Тариф - отправляем ID
        if (formData.tariff_name) {
          const tariff = tariffs.find(t => (t.name || t.tariff_name) === formData.tariff_name)
          if (tariff && (tariff.id || tariff.tariff_id)) {
            submitData.tariff_id = parseInt(String(tariff.id || tariff.tariff_id))
          }
        }

        // Кластер или сервер - отправляем только одно значение
        if (formData.cluster_or_server) {
          const [type, value] = formData.cluster_or_server.split(':')
          if (type === 'cluster') {
            submitData.cluster_id = value
          } else if (type === 'server') {
            submitData.server_id = value
          }
        }

        // Expiry time - конвертируем из MSK datetime-local в UTC timestamp
        if (formData.expiry_time) {
          submitData.expiry_time = fromMskDateTimeLocal(formData.expiry_time)
        }

        submitData.is_frozen = formData.is_frozen

        // Prefer stable identifier (client_id). Fallback to legacy by-email endpoint if missing.
        const keyId = editingKey.client_id || editingKey.clientId || editingKey.id || null
        if (keyId) {
          const updated = await updateBotKey(config, String(keyId), submitData)
          setLiveKey(updated)
        } else {
          await updateBotKeyByEmail(config, editingKey.email, submitData)
        }
        audit('key.update', {
          tg_id: tgId,
          key_id: String(keyId || ''),
          email: String(formData.email || editingKey.email || ''),
          tariff_name: String(formData.tariff_name || ''),
          cluster_or_server: formData.cluster_or_server || undefined,
          frozen: Boolean(formData.is_frozen),
        })
      } else {
        // Создание - нужен правильный формат
        if (!formData.cluster_or_server || !formData.tariff_name) {
          setError('Заполните все обязательные поля')
          setLoading(false)
          return
        }

        // Найти тариф по имени
        const foundTariff = tariffs.find(t => (t.name || t.tariff_name) === formData.tariff_name)
        if (!foundTariff) {
          setError('Тариф не найден')
          setLoading(false)
          return
        }

        const tariffId = foundTariff.id || foundTariff.tariff_id
        if (!tariffId) {
          setError('Не удалось определить ID тарифа')
          setLoading(false)
          return
        }

        // Вычислить expiry_timestamp
        let expiryTimestamp: number
        if (formData.expiry_time) {
          expiryTimestamp = fromMskDateTimeLocal(formData.expiry_time)
        } else {
          // Если не указано, вычисляем из периода тарифа
          const periodDays = foundTariff.period_days || foundTariff.period || foundTariff.duration_days || 30
          expiryTimestamp = Date.now() + (periodDays * 24 * 60 * 60 * 1000)
        }

        const [type, value] = formData.cluster_or_server.split(':')
        const submitData: any = {
          tg_id: parseInt(String(tgId)),
          tariff_id: parseInt(String(tariffId)),
          client_id: generateUUID(),
          expiry_timestamp: expiryTimestamp,
          email: formData.email || generateRandomEmail()
        }

        if (type === 'cluster') {
          submitData.cluster_id = value
        } else if (type === 'server') {
          submitData.server_id = value
        }

        if (formData.is_frozen) submitData.is_frozen = formData.is_frozen

        // Конфигурация тарифа (пакеты)
        if (foundTariff?.configurable) {
          const dev = formData.selected_device_limit === '' ? null : Number(formData.selected_device_limit)
          const tr = formData.selected_traffic_limit_gb === '' ? null : Number(formData.selected_traffic_limit_gb)
          if (dev !== null && Number.isFinite(dev)) submitData.selected_device_limit = dev
          if (tr !== null && Number.isFinite(tr)) submitData.selected_traffic_limit_gb = tr
        }

        await createBotKey(config, submitData)
        audit('key.create', {
          tg_id: tgId,
          key_id: String(submitData.client_id || ''),
          email: String(submitData.email || ''),
          tariff_id: Number(submitData.tariff_id || 0) || undefined,
          cluster_id: submitData.cluster_id ? String(submitData.cluster_id) : undefined,
          server_id: submitData.server_id ? String(submitData.server_id) : undefined,
          frozen: Boolean(submitData.is_frozen),
        })
      }

      onSaved()
    } catch (err: any) {
      const errorMessage = err.message || (typeof err === 'string' ? err : JSON.stringify(err))
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
    <ModalShell
      title={editingKey ? 'Редактирование подписки' : 'Создание подписки'}
      subtitle={editingKey ? `Email: ${formData.email || editingKey?.email || ''}` : 'Назначьте тариф и кластер/сервер'}
      onClose={onClose}
      closeButtonTone="danger"
      shellTone="neutral"
      size="lg"
      closeOnBackdropClick={false}
      closeOnEsc={false}
      icon={
        <svg className="w-5 h-5" style={{ color: '#b5b5b5' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
      }
      banner={
        error ? (
          <div className="bg-red-500/15 border border-red-500/30 rounded-lg p-2.5 text-red-200 text-xs">
            {error}
          </div>
        ) : actionInfo ? (
          <div className="bg-accent-10 border border-accent-25 rounded-lg p-2.5 text-[var(--accent)] text-xs whitespace-pre-wrap">
            {actionInfo}
          </div>
        ) : null
      }
      footer={
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className={modalSecondaryButtonClass}
          >
            Отмена
          </button>
          <button
            type="submit"
            form={formId}
            disabled={loading}
            className={[
              'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-[13px] sm:text-sm font-semibold leading-snug',
              'whitespace-normal sm:whitespace-nowrap text-center min-w-0 max-w-full',
              'border border-accent-25 bg-[var(--accent)]/18 hover:bg-[var(--accent)]/24 text-[var(--accent)]',
              'shadow-sm shadow-none transition-colors w-full sm:w-auto',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            {loading ? 'Сохранение...' : editingKey ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      }
    >
      {editingKey ? (
        <div className="ke-info-card">
          {/* Ссылка */}
          {(() => {
            const link = String(keyView?.key || '').trim()
            return (
              <div className="ke-link-row">
                <span className="ke-label">Ссылка</span>
                <div className="ke-link-val">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="ke-link-text" title={link} onClick={(e) => e.stopPropagation()}>{link}</a>
                  ) : (
                    <span className="ke-dim">—</span>
                  )}
                  {link && (
                    <CopyText text={link} showToast toastMessage="Ссылка скопирована"
                      label={<span className="sr-only">Копировать</span>}
                      className="ke-copy-btn"
                    />
                  )}
                </div>
              </div>
            )
          })()}
          {/* Строки данных */}
          <div className="ke-rows">
            <div className="ke-row"><span className="ke-label">Создан</span><span className="ke-val">{formatMsk(keyView?.created_at)}</span></div>
            <div className="ke-row"><span className="ke-label">Истекает</span><span className="ke-val">{formatMsk(keyView?.expiry_time)}</span></div>
            <div className="ke-row"><span className="ke-label">Кластер</span><span className="ke-val">{String(keyView?.cluster_name || keyView?.cluster_id || keyView?.server_id || '—')}</span></div>
            <div className="ke-row"><span className="ke-label">Тариф</span><span className="ke-val">{String(selectedTariff?.name || selectedTariff?.tariff_name || editingKey.tariff_name || '—')}</span></div>
            <div className="ke-row"><span className="ke-label">Трафик</span><span className="ke-val">
              {tariffConfigurable
                ? cfgBaseTrafficGb <= 0 ? 'Безлимит' : `${cfgBaseTrafficGb} ГБ${cfgExtraTrafficGb > 0 ? ` + ${cfgExtraTrafficGb} ГБ` : ''}`
                : formatLimit(keyView?.current_traffic_limit ?? keyView?.selected_traffic_limit ?? selectedTariff?.traffic_limit, 'ГБ')}
            </span></div>
            <div className="ke-row"><span className="ke-label">Устройства</span><span className="ke-val">
              {tariffConfigurable
                ? `${cfgBaseDevices}${cfgExtraDevices > 0 ? ` + ${cfgExtraDevices}` : ''}`
                : formatLimit(keyView?.current_device_limit ?? keyView?.selected_device_limit ?? selectedTariff?.device_limit)}
            </span></div>
          </div>
        </div>
      ) : null}

      {editingKey ? (
        <div className="mb-3">
          {/* 8 кнопок действий как в боте */}
          <div className="ke-actions-grid">
            {/* ⏳ Время истечения */}
            <button type="button" disabled={!!actionLoading} onClick={() => togglePanel('expiry')}
              className={`ke-btn ke-btn-action ${activePanel === 'expiry' ? 'ke-btn-panel-open' : ''}`}>
              <span className="ke-btn-emoji">⏳</span>
              <span className="ke-btn-label">Время истечения</span>
            </button>

            {/* 🔄 Перевыпуск подписки */}
            <button type="button" disabled={!!actionLoading} onClick={() => togglePanel('reissue')}
              className={`ke-btn ke-btn-action ${activePanel === 'reissue' ? 'ke-btn-panel-open' : ''}`}>
              <span className="ke-btn-emoji">🔄</span>
              <span className="ke-btn-label">Перевыпуск</span>
            </button>

            {/* 📦 Тариф */}
            <button type="button" disabled={!!actionLoading} onClick={() => togglePanel('tariff')}
              className={`ke-btn ke-btn-action ${activePanel === 'tariff' ? 'ke-btn-panel-open' : ''}`}>
              <span className="ke-btn-emoji">📦</span>
              <span className="ke-btn-label">Тариф</span>
            </button>

            {/* 🔧 Конфигурация */}
            <button type="button" disabled={!!actionLoading} onClick={() => togglePanel('config')}
              className={`ke-btn ke-btn-action ${activePanel === 'config' ? 'ke-btn-panel-open' : ''}`}>
              <span className="ke-btn-emoji">🔧</span>
              <span className="ke-btn-label">Конфигурация</span>
            </button>

            {/* 📊 Трафик */}
            <button type="button" disabled={!!actionLoading} onClick={handleViewTraffic} className="ke-btn ke-btn-action">
              <span className="ke-btn-emoji">{actionLoading === 'traffic' ? '⌛' : '📊'}</span>
              <span className="ke-btn-label">{actionLoading === 'traffic' ? 'Загружаю...' : 'Трафик'}</span>
            </button>

            {/* ♻️ Сбросить трафик */}
            <button type="button" disabled={!!actionLoading} onClick={() => setConfirmDialog({ title: 'Сбросить трафик?', message: 'Весь израсходованный трафик подписки будет обнулён.', onConfirm: () => runAction('reset_traffic', async (cfg, keyId) => await resetKeyTraffic(cfg, keyId)) })} className="ke-btn ke-btn-action">
              <span className="ke-btn-emoji">{actionLoading === 'reset_traffic' ? '⌛' : '♻️'}</span>
              <span className="ke-btn-label">{actionLoading === 'reset_traffic' ? 'Сбрасываю...' : 'Сбросить трафик'}</span>
            </button>

            {/* 🔴/🟢 Заморозить/Разморозить */}
            <button type="button" disabled={!!actionLoading}
              onClick={() => !actionLoading && toggleFreezeNow(!formData.is_frozen)}
              className={`ke-btn ke-btn-action ke-btn-freeze ${formData.is_frozen ? 'ke-btn-frozen' : 'ke-btn-active'}`}>
              <span className="ke-btn-emoji">{actionLoading === 'freeze' ? '⌛' : formData.is_frozen ? '🟢' : '🔴'}</span>
              <span className="ke-btn-label">
                {actionLoading === 'freeze'
                  ? (formData.is_frozen ? 'Размораживаю...' : 'Замораживаю...')
                  : formData.is_frozen ? 'Разморозить' : 'Заморозить'}
              </span>
            </button>

            {/* ❌ Удалить */}
            <button type="button" disabled={!!actionLoading} onClick={() => setConfirmDialog({ title: 'Удалить подписку?', message: 'Подписка будет безвозвратно удалена с сервера. Это действие нельзя отменить.', onConfirm: () => runAction('delete', async (cfg, keyId) => await deleteBotKey(cfg, keyId), { closeOnSuccess: true }) })} className="ke-btn ke-btn-action ke-btn-danger">
              <span className="ke-btn-emoji">{actionLoading === 'delete' ? '⌛' : '❌'}</span>
              <span className="ke-btn-label">{actionLoading === 'delete' ? 'Удаляю...' : 'Удалить'}</span>
            </button>
          </div>

          {/* Inline-панель: ⏳ Время истечения */}
          {activePanel === 'expiry' && (
            <div className="ke-inline-panel">
              <div className="ke-inline-panel-title">⏳ Время истечения</div>
              <input
                type="datetime-local"
                value={formData.expiry_time}
                onChange={(e) => setFormData({ ...formData, expiry_time: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/15 focus:border-accent-30 text-primary text-sm"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setActivePanel(null)} className="ke-inline-cancel">Отмена</button>
                <button type="button" disabled={!!actionLoading} onClick={async () => {
                    if (!editingKey || !formData.expiry_time) return
                    const keyId = getKeyId(keyView || editingKey)
                    if (!keyId) return
                    setActionLoading('expiry'); setError(null)
                    try {
                      const cfg = await getBotConfigAsync()
                      if (!cfg) throw new Error('Нет активного профиля')
                      const updated = await updateBotKey(cfg, keyId, { expiry_time: fromMskDateTimeLocal(formData.expiry_time) })
                      setLiveKey(updated)
                      audit('key.update_expiry', { tg_id: tgId, key_id: keyId, email: String((keyView || editingKey)?.email || '') })
                      toast.showSuccess('Подписка', 'Время истечения обновлено')
                      setActivePanel(null)
                      onUpdated?.()
                    } catch (err: any) { setError(err?.message || 'Ошибка'); toast.showError('Подписка', err?.message || 'Ошибка') }
                    finally { setActionLoading(null) }
                  }} className="ke-inline-save">
                  {actionLoading === 'expiry' ? '⌛ Сохраняю...' : '💾 Сохранить'}
                </button>
              </div>
            </div>
          )}

          {/* Inline-панель: 🔄 Перевыпуск */}
          {activePanel === 'reissue' && (
            <div className="ke-inline-panel">
              <div className="ke-inline-panel-title">🔄 Перевыпуск подписки</div>
              <div className="flex flex-col gap-2">
                <button type="button" disabled={!!actionLoading}
                  onClick={() => setConfirmDialog({ title: 'Перевыпустить подписку?', message: 'Подписка будет пересоздана на сервере. При необходимости — перенесена на другой кластер.', onConfirm: () => { setActivePanel(null); runAction('reissue_full', async (cfg, keyId) => { const target = resolveReissueTarget(); return await reissueKeyFull(cfg, keyId, target) }) } })}
                  className="ke-inline-save w-full text-left">
                  {actionLoading === 'reissue_full' ? '⌛ Перевыпускаю...' : '🔄 Перевыпуск подписки'}
                </button>
                <div className="text-[11px] text-secondary -mt-1 mb-1 px-1">Пересоздаёт подписку на сервере (с переносом на другой кластер если нужно)</div>
                <button type="button" disabled={!!actionLoading}
                  onClick={() => setConfirmDialog({ title: 'Сменить ссылку подписки?', message: 'Будет выдана новая ссылка подписки. Работает только для Remnawave.', onConfirm: () => { setActivePanel(null); runAction('reissue_link', async (cfg, keyId) => await reissueKeyLink(cfg, keyId)) } })}
                  className="ke-inline-save w-full text-left">
                  {actionLoading === 'reissue_link' ? '⌛ Обновляю...' : '🔗 Сменить ссылку'}
                </button>
                <div className="text-[11px] text-secondary -mt-1 px-1">Только выдаёт новую ссылку подписки (только для Remnawave)</div>
              </div>
              <div className="mt-2 flex justify-end">
                <button type="button" onClick={() => setActivePanel(null)} className="ke-inline-cancel">Отмена</button>
              </div>
            </div>
          )}

          {/* Inline-панель: 📦 Тариф */}
          {activePanel === 'tariff' && (
            <div className="ke-inline-panel">
              <div className="ke-inline-panel-title">📦 Тариф</div>
              <DarkSelect
                value={formData.tariff_name}
                onChange={(v) => setFormData({ ...formData, tariff_name: v })}
                groups={tariffSelectGroups}
                buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/15 focus:border-accent-30 text-primary text-sm"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setActivePanel(null)} className="ke-inline-cancel">Отмена</button>
                <button type="button" disabled={!!actionLoading || !formData.tariff_name} onClick={async () => {
                    if (!editingKey || !formData.tariff_name) return
                    const keyId = getKeyId(keyView || editingKey)
                    if (!keyId) return
                    const tariff = tariffs.find(t => (t.name || t.tariff_name) === formData.tariff_name)
                    const tariffId = tariff?.id || tariff?.tariff_id
                    if (!tariffId) { setError('Тариф не найден'); return }
                    setActionLoading('tariff'); setError(null)
                    try {
                      const cfg = await getBotConfigAsync()
                      if (!cfg) throw new Error('Нет активного профиля')
                      const updated = await updateBotKey(cfg, keyId, { tariff_id: parseInt(String(tariffId)) })
                      setLiveKey(updated)
                      audit('key.update_tariff', { tg_id: tgId, key_id: keyId, tariff: formData.tariff_name })
                      toast.showSuccess('Подписка', 'Тариф обновлён')
                      setActivePanel(null)
                      onUpdated?.()
                    } catch (err: any) { setError(err?.message || 'Ошибка'); toast.showError('Подписка', err?.message || 'Ошибка') }
                    finally { setActionLoading(null) }
                  }} className="ke-inline-save">
                  {actionLoading === 'tariff' ? '⌛ Сохраняю...' : '💾 Сохранить'}
                </button>
              </div>
            </div>
          )}

          {/* Inline-панель: 🔧 Конфигурация */}
          {activePanel === 'config' && (
            <div className="ke-inline-panel">
              <div className="ke-inline-panel-title">🔧 Конфигурация подписки</div>
              {!tariffConfigurable ? (
                <div className="text-sm text-secondary">Тариф не поддерживает конфигурацию</div>
              ) : (
                <>
                  <div className="text-xs text-secondary mb-2">
                    Устройства: <span className="text-primary font-semibold">{cfgBaseDevices}{cfgExtraDevices > 0 ? ` + ${cfgExtraDevices}` : ''}</span>
                    {' · '}
                    Трафик: <span className="text-primary font-semibold">{cfgBaseTrafficGb <= 0 ? 'безлимит' : `${cfgBaseTrafficGb} ГБ${cfgExtraTrafficGb > 0 ? ` + ${cfgExtraTrafficGb}` : ''}`}</span>
                  </div>
                  <div className="flex gap-2 mb-3">
                    <button type="button" onClick={() => setCfgTab('base')}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${cfgTab === 'base' ? 'bg-overlay-sm border-strong text-primary' : 'bg-overlay-xs border-default text-secondary hover:bg-overlay-sm'}`}>
                      📦 База тарифа
                    </button>
                    <button type="button" onClick={() => setCfgTab('addon')}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${cfgTab === 'addon' ? 'bg-overlay-sm border-strong text-primary' : 'bg-overlay-xs border-default text-secondary hover:bg-overlay-sm'}`}>
                      ➕ Докупка
                    </button>
                  </div>
                  {cfgTab === 'base' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {deviceOptions.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-secondary">Устройств (база)</label>
                          <DarkSelect value={String(cfgBaseDevices)} onChange={(v) => setCfgBaseDevices(Math.max(1, Number(v || 1)))}
                            groups={[{ options: deviceOptions.map((x) => ({ value: String(x), label: String(x) })) }]}
                            buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none text-primary text-sm" />
                        </div>
                      )}
                      {trafficOptionsGb.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-secondary">Трафик (база)</label>
                          <DarkSelect value={String(cfgBaseTrafficGb)} onChange={(v) => { const n = Number(v || 0); setCfgBaseTrafficGb(n); if (n <= 0) setCfgExtraTrafficGb(0) }}
                            groups={[{ options: trafficOptionsGb.map((x) => ({ value: String(x), label: x === 0 ? 'безлимит' : `${x} ГБ` })) }]}
                            buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none text-primary text-sm" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-xs text-secondary">Докупка устройств (+шт.)</label>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setCfgExtraDevices(p => Math.max(0, p - 1))} className="px-3 py-2 rounded-lg bg-overlay-xs border border-default text-primary hover:bg-overlay-sm">−</button>
                          <input type="number" min={0} value={String(cfgExtraDevices)} onChange={(e) => setCfgExtraDevices(Math.max(0, Number(e.target.value || 0)))} className="flex-1 px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm text-center" />
                          <button type="button" onClick={() => setCfgExtraDevices(p => p + 1)} className="px-3 py-2 rounded-lg bg-overlay-xs border border-default text-primary hover:bg-overlay-sm">+</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[1, 2, 5, 10].map(n => <button key={n} type="button" onClick={() => setCfgExtraDevices(p => p + n)} className="px-2 py-1 rounded-md bg-overlay-xs border border-default text-secondary hover:bg-overlay-sm text-xs">+{n}</button>)}
                          <button type="button" onClick={() => setCfgExtraDevices(0)} className="px-2 py-1 rounded-md bg-overlay-xs border border-default text-secondary hover:bg-overlay-sm text-xs">Сброс</button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-secondary">Докупка трафика (+ГБ)</label>
                        <div className="flex items-center gap-2">
                          <button type="button" disabled={cfgBaseTrafficGb <= 0} onClick={() => setCfgExtraTrafficGb(p => Math.max(0, p - 1))} className="px-3 py-2 rounded-lg bg-overlay-xs border border-default text-primary hover:bg-overlay-sm disabled:opacity-40">−</button>
                          <input type="number" min={0} disabled={cfgBaseTrafficGb <= 0} value={String(cfgExtraTrafficGb)} onChange={(e) => setCfgExtraTrafficGb(Math.max(0, Number(e.target.value || 0)))} className="flex-1 px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm text-center disabled:opacity-50" />
                          <button type="button" disabled={cfgBaseTrafficGb <= 0} onClick={() => setCfgExtraTrafficGb(p => p + 1)} className="px-3 py-2 rounded-lg bg-overlay-xs border border-default text-primary hover:bg-overlay-sm disabled:opacity-40">+</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[5, 10, 20, 50].map(n => <button key={n} type="button" disabled={cfgBaseTrafficGb <= 0} onClick={() => setCfgExtraTrafficGb(p => p + n)} className="px-2 py-1 rounded-md bg-overlay-xs border border-default text-secondary hover:bg-overlay-sm text-xs disabled:opacity-40">+{n}</button>)}
                          <button type="button" disabled={cfgBaseTrafficGb <= 0} onClick={() => setCfgExtraTrafficGb(0)} className="px-2 py-1 rounded-md bg-overlay-xs border border-default text-secondary hover:bg-overlay-sm text-xs disabled:opacity-40">Сброс</button>
                        </div>
                        {cfgBaseTrafficGb <= 0 && <div className="text-[11px] text-muted">При безлимите докупка недоступна</div>}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setActivePanel(null)} className="ke-inline-cancel">Отмена</button>
                    <button type="button" disabled={cfgSaving || !!actionLoading} onClick={async () => {
                        if (!keyView) return
                        const keyId = getKeyId(keyView)
                        if (!keyId) { setError('Не найден client_id'); return }
                        setCfgSaving(true); setError(null)
                        try {
                          const cfg = await getBotConfigAsync()
                          if (!cfg) throw new Error('Нет активного профиля')
                          const updated = await saveKeyConfig(cfg, keyId, { base_devices: cfgBaseDevices, extra_devices: cfgExtraDevices, base_traffic_gb: cfgBaseTrafficGb, extra_traffic_gb: cfgExtraTrafficGb })
                          setLiveKey(updated)
                          toast.showSuccess('Подписка', 'Конфигурация сохранена')
                          setActivePanel(null)
                          onUpdated?.()
                        } catch (err: any) { setError(err?.message || 'Ошибка') }
                        finally { setCfgSaving(false) }
                      }} className="ke-inline-save">
                      {cfgSaving ? '⌛ Сохраняю...' : '💾 Сохранить'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      <form id={formId} onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
            {!editingKey && (
              <div className="bg-overlay-sm rounded-lg p-3 border border-subtle">
                <div className="flex items-center gap-2 text-sm text-dim">
                  <svg className="w-4 h-4" style={{ color: '#b5b5b5' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Email: <span className="font-mono text-primary">{formData.email || 'Генерация...'}</span></span>
                </div>
              </div>
            )}

            {/* Поля только для создания ключа */}
            {!editingKey && (<>
              {/* Кластер или Сервер */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-dim mb-2">
                  <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                  </svg>
                  Кластер или Сервер
                </label>
                <DarkSelect
                  value={formData.cluster_or_server}
                  onChange={(v) => setFormData({ ...formData, cluster_or_server: v })}
                  groups={clusterOrServerGroups}
                  buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/15 focus:border-accent-30 text-primary text-sm"
                />
              </div>

              {/* Тариф */}
              <div className="space-y-1.5 sm:space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-dim mb-2">
                  <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Тариф
                </label>
                <DarkSelect
                  value={formData.tariff_name}
                  onChange={(v) => setFormData({ ...formData, tariff_name: v })}
                  groups={tariffSelectGroups}
                  buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/15 focus:border-accent-30 text-primary text-sm"
                />
              </div>

              {/* Конфигурация (база) при создании ключа */}
              {selectedTariff?.configurable && (deviceOptions.length > 0 || trafficOptionsGb.length > 0) && (
                <div className="bg-overlay-xs rounded-lg border border-default p-3 space-y-2">
                  <div className="text-xs text-secondary">Конфигурация (база)</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {deviceOptions.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-secondary">Пакет устройств</label>
                        <DarkSelect value={String(formData.selected_device_limit)} onChange={(v) => setFormData({ ...formData, selected_device_limit: v })}
                          groups={[{ options: [{ value: '', label: 'Не менять' }, ...deviceOptions.map((x) => ({ value: String(x), label: x <= 0 ? 'Безлимит' : String(x) }))] }]}
                          buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/15 focus:border-accent-30 text-primary text-sm" />
                      </div>
                    )}
                    {trafficOptionsGb.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-secondary">Пакет трафика</label>
                        <DarkSelect value={String(formData.selected_traffic_limit_gb)} onChange={(v) => setFormData({ ...formData, selected_traffic_limit_gb: v })}
                          groups={[{ options: [{ value: '', label: 'Не менять' }, ...trafficOptionsGb.map((x) => ({ value: String(x), label: x <= 0 ? 'Безлимит' : `${x} ГБ` }))] }]}
                          buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/15 focus:border-accent-30 text-primary text-sm" />
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-muted">Пакеты применятся при создании ключа.</div>
                </div>
              )}

              {/* Действует до */}
              <div className="space-y-1.5 sm:space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-dim mb-2">
                  <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Действует до
                </label>
                <input type="datetime-local" value={formData.expiry_time} onChange={(e) => setFormData({ ...formData, expiry_time: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/15 focus:border-accent-30 text-primary text-sm" />
              </div>
            </>)}
      </form>
    </ModalShell>

    {confirmDialog && (
      <ConfirmModal
        isOpen={true}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="Подтвердить"
        cancelText="Отмена"
        zIndexClassName="z-[100002]"
        onConfirm={() => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); fn() }}
        onCancel={() => setConfirmDialog(null)}
      />
    )}
    </>
  )
}
