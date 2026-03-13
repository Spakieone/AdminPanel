import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getBotConfigAsync } from '../utils/botConfig'
import CapybaraLoader from '../components/common/CapybaraLoader'
import NeoToggle from '../components/common/NeoToggle'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../components/common/ModalShell'
import { useToastContext } from '../contexts/ToastContext'
import DarkSelect, { type DarkSelectGroup } from '../components/common/DarkSelect'
import Servers from './Servers'
import {
  getBotAdminSettings,
  toggleBotCashbox,
  toggleBotButton,
  patchBotModesSettings,
  patchBotNotificationsSettings,
  patchBotMoneySettings,
  patchBotTariffsSettings,
  type BotApiConfig,
} from '../api/botApi'

type SettingsSection = 'cashboxes' | 'money' | 'buttons' | 'notifications' | 'modes' | 'tariffs' | 'servers'

function prettyKey(key: string) {
  return String(key || '')
    .trim()
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
}

export default function BotSettings() {
  const toast = useToastContext()
  const location = useLocation()
  const [config, setConfig] = useState<BotApiConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // success notifications should be shown via standard toasts (right side)
  const [settings, setSettings] = useState<any>(null)
  const ALLOWED_SECTIONS: SettingsSection[] = ['cashboxes', 'money', 'buttons', 'notifications', 'modes', 'tariffs', 'servers']

  const urlTab = useMemo(() => {
    const t = String(new URLSearchParams(location.search || '').get('tab') || '').trim().toLowerCase()
    return t
  }, [location.search])

  const [activeSection, setActiveSection] = useState<SettingsSection>(() => {
    const t = String(new URLSearchParams(location.search || '').get('tab') || '').trim().toLowerCase()
    return (ALLOWED_SECTIONS as string[]).includes(t) ? (t as SettingsSection) : 'cashboxes'
  })

  useEffect(() => {
    const next = (ALLOWED_SECTIONS as string[]).includes(urlTab) ? (urlTab as SettingsSection) : 'cashboxes'
    setActiveSection(next)
  }, [urlTab])
  const [saving, setSaving] = useState<string | null>(null)
  const [edit, setEdit] = useState<{
    section: SettingsSection
    key: string
    title: string
    value: any
  } | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [editError, setEditError] = useState<string | null>(null)

  const currencyModeGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: 'RUB', label: 'RUB' },
          { value: 'USD', label: 'USD' },
          { value: 'RUB+USD', label: 'RUB+USD' },
          { value: 'RUB+USD_ONE_SCREEN', label: 'RUB+USD (одним экраном)' },
        ],
      },
    ],
    [],
  )

  const packModeGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: '', label: 'Выключено' },
          { value: 'traffic', label: 'Пакеты по трафику' },
          { value: 'devices', label: 'Пакеты по устройствам' },
          { value: 'all', label: 'Пакеты: трафик + устройства' },
        ],
      },
    ],
    [],
  )

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await getBotConfigAsync()
      if (!cfg) {
        const msg = 'Нет активного профиля. Настройте профиль в разделе Настройки.'
        setError(msg)
        setLoading(false)
        return
      }
      setConfig(cfg)
      const data = await getBotAdminSettings(cfg)
      setSettings(data)
    } catch (err: any) {
      const msg = err.message || 'Ошибка загрузки настроек'
      setError(msg)
      toast.showError('Ошибка', msg, 4500)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleToggle = async (section: SettingsSection, key: string, currentValue: boolean) => {
    if (!config) return
    setSaving(key)
    setError(null)
    try {
      const newValue = !currentValue
      if (section === 'cashboxes') {
        await toggleBotCashbox(config, key)
      } else if (section === 'buttons') {
        await toggleBotButton(config, key)
      } else {
        const patchFns: Record<string, (cfg: BotApiConfig, payload: Record<string, any>) => Promise<any>> = {
          money: patchBotMoneySettings,
          notifications: patchBotNotificationsSettings,
          modes: patchBotModesSettings,
          tariffs: patchBotTariffsSettings,
        }
        if (patchFns[section]) {
          await patchFns[section](config, { [key]: newValue })
        }
      }
      setSettings((prev: any) => ({
        ...prev,
        [section]: {
          ...prev[section],
          [key]: newValue,
        },
      }))
      toast.showSuccess('Сохранено', `${prettyKey(key)} ${newValue ? 'включено' : 'выключено'}`, 2500)
    } catch (err: any) {
      const msg = err.message || 'Ошибка сохранения'
      setError(msg)
      toast.showError('Ошибка', msg, 4500)
    } finally {
      setSaving(null)
    }
  }

  const currentSectionData = useMemo(() => {
    if (!settings || !settings[activeSection]) return {}
    return settings[activeSection]
  }, [settings, activeSection])

  const keysMeta = settings?.keys
  const titles = (keysMeta && typeof keysMeta === 'object' ? (keysMeta as any).titles : null) || {}
  const notificationFlagsSet = useMemo(() => new Set<string>(Array.isArray((keysMeta as any)?.notification_flags) ? (keysMeta as any).notification_flags : []), [keysMeta])
  const notificationTimesSet = useMemo(() => new Set<string>(Array.isArray((keysMeta as any)?.notification_time_fields) ? (keysMeta as any).notification_time_fields : []), [keysMeta])
  const moneyFieldsSet = useMemo(() => new Set<string>(Array.isArray((keysMeta as any)?.money_fields) ? (keysMeta as any).money_fields : []), [keysMeta])

  const orderedKeys: string[] = useMemo(() => {
    if (!keysMeta || typeof keysMeta !== 'object') {
      return Object.keys(currentSectionData || {})
    }
    const m: any = keysMeta
    if (activeSection === 'cashboxes') return Array.isArray(m.payment_providers) ? m.payment_providers : Object.keys(currentSectionData || {})
    if (activeSection === 'buttons') return Array.isArray(m.buttons) ? m.buttons : Object.keys(currentSectionData || {})
    if (activeSection === 'modes') return Array.isArray(m.modes) ? m.modes : Object.keys(currentSectionData || {})
    if (activeSection === 'money') {
      const mf = Array.isArray(m.money_fields) ? m.money_fields : []
      // Include CURRENCY_MODE if present in data
      const hasCurrency = Object.prototype.hasOwnProperty.call(currentSectionData || {}, 'CURRENCY_MODE')
      return hasCurrency ? ['CURRENCY_MODE', ...mf] : mf.length ? mf : Object.keys(currentSectionData || {})
    }
    if (activeSection === 'notifications') {
      const flags = Array.isArray(m.notification_flags) ? m.notification_flags : []
      const times = Array.isArray(m.notification_time_fields) ? m.notification_time_fields : []
      const out = [...flags, ...times]
      return out.length ? out : Object.keys(currentSectionData || {})
    }
    if (activeSection === 'tariffs') {
      return ['ALLOW_DOWNGRADE', 'KEY_ADDONS_PACK_MODE', 'KEY_ADDONS_RECALC_PRICE'].filter((k) =>
        Object.prototype.hasOwnProperty.call(currentSectionData || {}, k),
      )
    }
    return Object.keys(currentSectionData || {})
  }, [activeSection, currentSectionData, keysMeta])

  const getTitleForKey = useCallback((section: SettingsSection, key: string) => {
    const t: any = titles || {}
    if (section === 'cashboxes') return t?.payment_providers?.[key]
    if (section === 'buttons') return t?.buttons?.[key]
    if (section === 'modes') return t?.modes?.[key]
    if (section === 'money') {
      if (key === 'CURRENCY_MODE') return 'Валюта'
      return t?.money_fields?.[key]
    }
    if (section === 'notifications') {
      return t?.notification_flags?.[key] ?? t?.notification_time_fields?.[key]
    }
    if (section === 'tariffs') {
      const map: Record<string, string> = {
        ALLOW_DOWNGRADE: 'Разрешить понижение тарифа',
        KEY_ADDONS_PACK_MODE: 'Пакеты доп. опций',
        KEY_ADDONS_RECALC_PRICE: 'Перерасчёт цены доп. опций',
      }
      return map[key]
    }
    return undefined
  }, [titles])

  const patchFns = useMemo(() => {
    return {
      money: patchBotMoneySettings,
      notifications: patchBotNotificationsSettings,
      modes: patchBotModesSettings,
      tariffs: patchBotTariffsSettings,
    } as Record<string, (cfg: BotApiConfig, payload: Record<string, any>) => Promise<any>>
  }, [])

  const openEdit = useCallback((section: SettingsSection, key: string, value: any) => {
    const title = getTitleForKey(section, key) || prettyKey(key) || key
    setEdit({ section, key, title, value })
    setEditError(null)
    setEditValue(value === false ? '' : String(value ?? ''))
  }, [getTitleForKey])

  const closeEdit = useCallback(() => {
    setEdit(null)
    setEditValue('')
    setEditError(null)
  }, [])

  const saveEdit = useCallback(async () => {
    if (!edit || !config) return
    const { section, key, title } = edit
    setSaving(key)
    setEditError(null)
    setError(null)

    try {
      let payloadValue: any = editValue

      // Special: money fields are numeric-like (even if currently False in bot config)
      const isMoneyField = section === 'money' && (moneyFieldsSet.has(key) || key === 'CURRENCY_MODE')
      const isNotificationTime = section === 'notifications' && notificationTimesSet.has(key)

      if (key === 'CURRENCY_MODE') {
        const mode = String(editValue || '').trim().toUpperCase()
        if (!mode) throw new Error('Укажите режим валюты')
        payloadValue = mode
      } else if (isNotificationTime) {
        const n = Number.parseInt(String(editValue || '').trim(), 10)
        if (!Number.isFinite(n)) throw new Error('Введите число')
        payloadValue = n
      } else if (isMoneyField) {
        const s = String(editValue || '').trim()
        const f = s === '' ? 0 : Number.parseFloat(s.replace(',', '.'))
        if (!Number.isFinite(f)) throw new Error('Введите число')
        payloadValue = f
      } else if (typeof edit.value === 'number') {
        const s = String(editValue || '').trim()
        const n = Number.parseFloat(s.replace(',', '.'))
        if (!Number.isFinite(n)) throw new Error('Введите число')
        payloadValue = n
      } else {
        payloadValue = String(editValue ?? '')
      }

      if (!patchFns[section]) throw new Error('Этот раздел не поддерживает редактирование')
      await patchFns[section](config, { [key]: payloadValue })

      setSettings((prev: any) => ({
        ...prev,
        [section]: {
          ...prev?.[section],
          [key]: payloadValue,
        },
      }))

      toast.showSuccess('Сохранено', `${title} сохранено`, 2500)
      closeEdit()
    } catch (err: any) {
      const msg = err?.message || 'Ошибка сохранения'
      setEditError(msg)
      toast.showError('Ошибка', msg, 4500)
    } finally {
      setSaving(null)
    }
  }, [closeEdit, config, edit, editValue, moneyFieldsSet, notificationTimesSet, patchFns, toast])

  const sectionDescriptions: Record<SettingsSection, string> = {
    cashboxes: 'Управление платёжными системами',
    money: 'Настройки финансов и бонусов',
    buttons: 'Видимость кнопок в меню бота',
    notifications: 'Настройки уведомлений',
    modes: 'Режимы работы бота',
    tariffs: 'Настройки тарификации',
    servers: 'Сервера и подключения',
  }

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <CapybaraLoader />
      </div>
    )
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-7 space-y-4">
      <div className="flex items-center justify-end">
        <button
          onClick={loadSettings}
          disabled={loading}
          className="px-4 py-2 rounded-lg border border-default bg-transparent text-primary hover:bg-overlay-sm transition-colors disabled:opacity-50"
        >
          Обновить настройки
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-default bg-overlay-xs px-4 py-3 text-sm text-muted">
          {String(error || '').includes('Нет активного профиля') ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{error}</span>
              <OpenPanelSettingsButton className="sm:flex-shrink-0" />
            </div>
          ) : (
            error
          )}
        </div>
      )}
      
      {activeSection === 'servers' ? (
        <Servers embedded />
      ) : (
        <>
          {/* Section Description */}
          <div className="text-muted text-sm px-1">{sectionDescriptions[activeSection]}</div>

          {/* Content - Cards for settings */}
          <div
            className={`grid gap-3 ${
              activeSection === 'cashboxes' || activeSection === 'buttons' || activeSection === 'notifications' || activeSection === 'modes'
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1'
            }`}
          >
        {orderedKeys.map((key) => {
          const value = (currentSectionData as any)?.[key]
          const isNotificationFlag = activeSection === 'notifications' && notificationFlagsSet.has(key)
          const isNotificationTime = activeSection === 'notifications' && notificationTimesSet.has(key)
          const isMoneyField = activeSection === 'money' && (moneyFieldsSet.has(key) || key === 'CURRENCY_MODE')
          const isTariffPackMode = activeSection === 'tariffs' && key === 'KEY_ADDONS_PACK_MODE'

          const isBoolean =
            activeSection === 'cashboxes' ||
            activeSection === 'buttons' ||
            activeSection === 'modes' ||
            isNotificationFlag ||
            (activeSection === 'tariffs' && (key === 'ALLOW_DOWNGRADE' || key === 'KEY_ADDONS_RECALC_PRICE'))

          const isSaving = saving === key
          const title = getTitleForKey(activeSection, key) || prettyKey(key) || key
          
          // Форматирование значений для секции "money" как в боте
          const formatMoneyValue = (k: string, v: any): string => {
            if (k === 'RUB_TO_USD') {
              if (v === false || v === null || v === undefined || v === 0 || v === '0') return 'по ЦБ РФ'
              return String(v)
            }
            if (k === 'CASHBACK') {
              const num = typeof v === 'number' ? v : parseFloat(String(v || '0'))
              if (!num || num <= 0 || v === false) return 'выкл'
              return `${num}%`
            }
            if (k === 'FX_MARKUP') {
              const num = typeof v === 'number' ? v : parseFloat(String(v || '0'))
              return `${num}%`
            }
            if (k === 'CURRENCY_MODE') {
              const mode = String(v || 'RUB').toUpperCase()
              if (mode === 'RUB+USD_ONE_SCREEN') return 'RUB+USD (одним экраном)'
              return mode
            }
            return v === false ? '—' : String(v ?? '—')
          }

          const isCurrencyMode = activeSection === 'money' && key === 'CURRENCY_MODE'
          
          return (
            <div 
              key={key}
              className={`rounded-xl border p-4 transition-all ${
                isBoolean
                  ? (value ? 'bg-overlay-xs border-success-500/30' : 'bg-overlay-xs border-default')
                  : 'bg-overlay-xs border-default'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex items-center gap-2">
                    {isBoolean && (
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${value ? 'bg-emerald-400' : 'bg-red-500'}`} />
                    )}
                    <h3 className="text-primary font-medium">{title}</h3>
                  </div>
                </div>
                
                {isBoolean ? (
                  <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                    <span className={`text-sm font-medium ${value ? 'text-emerald-400' : 'text-red-400'}`}>
                      {value ? 'ВКЛ' : 'ВЫКЛ'}
                    </span>
                    <NeoToggle
                      checked={Boolean(value)}
                      disabled={isSaving}
                      onChange={() => handleToggle(activeSection, key, Boolean(value))}
                      width={60}
                      height={28}
                      showStatus={false}
                    />
                  </div>
                ) : isCurrencyMode ? (
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="w-full sm:min-w-[220px]">
                      <DarkSelect
                        value={String(value || 'RUB').toUpperCase()}
                        disabled={isSaving}
                        onChange={(next) => {
                          setSaving(key)
                          setError(null)
                          patchBotMoneySettings(config as any, { CURRENCY_MODE: next })
                            .then(() => {
                              setSettings((prev: any) => ({
                                ...prev,
                                money: { ...(prev?.money || {}), CURRENCY_MODE: next },
                              }))
                              toast.showSuccess('Сохранено', `Режим валюты: ${next}`, 2500)
                            })
                            .catch((err: any) => toast.showError('Ошибка', err?.message || 'Ошибка сохранения', 4500))
                            .finally(() => setSaving(null))
                        }}
                        groups={currencyModeGroups}
                        buttonClassName="filter-field"
                      />
                    </div>
                  </div>
                ) : isTariffPackMode ? (
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="w-full sm:min-w-[260px]">
                      <DarkSelect
                        value={String(value ?? '')}
                        disabled={isSaving}
                        onChange={(next) => {
                          setSaving(key)
                          setError(null)
                          patchBotTariffsSettings(config as any, { [key]: next })
                            .then(() => {
                              setSettings((prev: any) => ({
                                ...prev,
                                tariffs: { ...(prev?.tariffs || {}), [key]: next },
                              }))
                              toast.showSuccess('Сохранено', `${title} сохранено`, 2500)
                            })
                            .catch((err: any) => toast.showError('Ошибка', err?.message || 'Ошибка сохранения', 4500))
                            .finally(() => setSaving(null))
                        }}
                        groups={packModeGroups}
                        buttonClassName="filter-field"
                      />
                    </div>
                  </div>
                ) : isNotificationTime || isMoneyField || typeof value === 'number' || typeof value === 'string' || value === null || value === false ? (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto">
                    <div className="text-primary font-mono text-base sm:text-lg break-words">
                      {activeSection === 'money' ? formatMoneyValue(key, value) : (value === false ? '—' : String(value ?? '—'))}
                    </div>
                    <button
                      onClick={() => openEdit(activeSection, key, value)}
                      disabled={isSaving}
                      className="w-full sm:w-auto px-3 py-2 rounded-lg bg-overlay-xs border border-default text-primary hover:bg-overlay-sm transition-colors disabled:opacity-50 text-sm font-medium"
                    >
                      Изменить
                    </button>
                  </div>
                ) : (
                  <div className="text-primary font-mono text-base sm:text-lg break-words w-full sm:w-auto">{String(value)}</div>
                )}
              </div>
            </div>
          )
        })}
        
        {Object.keys(currentSectionData).length === 0 && (
          <div className="text-center text-muted py-12 rounded-xl border border-default bg-overlay-xs">
            Нет настроек в этом разделе
          </div>
        )}
          </div>
        </>
      )}

      {/* Edit modal */}
      {edit && (
        <ModalShell
          title={edit.title}
          subtitle="Введите новое значение"
          onClose={closeEdit}
          closeButtonTone="danger"
          shellTone="neutral"
          closeOnBackdropClick={false}
          closeOnEsc={false}
          size="sm"
          footer={
            <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
              <button className={modalSecondaryButtonClass} onClick={closeEdit}>
                Отмена
              </button>
              <button className={modalPrimaryButtonClass} onClick={saveEdit} disabled={saving === edit.key}>
                {saving === edit.key ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          }
        >
          {editError ? (
            <div className="mb-3">
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {editError}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="block text-xs text-muted">Новое значение</label>
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="filter-field text-sm placeholder:text-faint"
              placeholder="Введите значение..."
              autoFocus
            />
            <div className="text-xs text-muted">
              Изменение применяется сразу после сохранения.
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
