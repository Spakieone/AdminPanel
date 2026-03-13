import { useId, useMemo, useState, useEffect } from 'react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { createBotTariff, updateBotTariff, updateBotTariffById } from '../../api/botApi'
import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../common/ModalShell'
import NeoToggle from '../common/NeoToggle'
import DarkSelect from '../common/DarkSelect'

interface TariffEditModalProps {
  editingTariff?: any
  existingGroups?: string[]
  onClose: () => void
  onSaved: () => void
}

export default function TariffEditModal({ editingTariff, existingGroups = [], onClose, onSaved }: TariffEditModalProps) {
  const formId = useId()
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    duration_days: '',
    group: '',
    subgroup: '',
    max_traffic: '',
    max_devices: '',
    is_enabled: true,
    configurable: false,
    device_options: '',
    traffic_options_gb: '',
    device_step_rub: '',
    traffic_step_rub: ''
  })
  const [groupInputMode, setGroupInputMode] = useState<'select' | 'input'>('select')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groupSelectGroups = useMemo(() => {
    const uniq = Array.from(new Set((existingGroups || []).filter(Boolean)))
    uniq.sort((a, b) => a.localeCompare(b))
    return [
      {
        options: [{ value: '', label: '— без группы —' }, ...uniq.map((g) => ({ value: g, label: g }))],
      },
    ]
  }, [existingGroups])

  useEffect(() => {
    if (editingTariff) {
      const group = editingTariff.group_code || editingTariff.group || editingTariff.subgroup || editingTariff.category || ''
      const isInExistingGroups = existingGroups.includes(group)
      
      // Определяем цену из разных возможных полей
      const price = editingTariff.price !== undefined && editingTariff.price !== null 
        ? editingTariff.price 
        : (editingTariff.price_rub !== undefined && editingTariff.price_rub !== null ? editingTariff.price_rub : '')
      
      // Определяем статус из разных возможных полей
      let isEnabled = true
      if (editingTariff.is_enabled !== undefined) {
        isEnabled = Boolean(editingTariff.is_enabled)
      } else if (editingTariff.enabled !== undefined) {
        isEnabled = Boolean(editingTariff.enabled)
      } else if (editingTariff.active !== undefined) {
        isEnabled = Boolean(editingTariff.active)
      } else if (editingTariff.is_active !== undefined) {
        isEnabled = Boolean(editingTariff.is_active)
      }
      
      // Получаем трафик из разных возможных полей
      // API возвращает traffic_limit в ГБ (без конвертации!)
      const trafficLimit = editingTariff.traffic_limit || editingTariff.max_traffic || null
      let trafficGB = ''
      if (trafficLimit && trafficLimit > 0) {
        // Значение уже в ГБ, отображаем как есть
        trafficGB = Number(trafficLimit).toFixed(2)
      }
      
      // Получаем устройства из разных возможных полей
      const deviceLimit = editingTariff.device_limit || editingTariff.max_devices || null
      const devices = deviceLimit && deviceLimit > 0 ? deviceLimit.toString() : ''
      
      setFormData({
        name: editingTariff.name || editingTariff.tariff_name || '',
        price: price.toString(),
        duration_days: editingTariff.duration_days?.toString() || editingTariff.duration?.toString() || '',
        group: group,
        subgroup: editingTariff.subgroup_title || editingTariff.subgroup || '',
        max_traffic: trafficGB,
        max_devices: devices,
        is_enabled: isEnabled,
        configurable: Boolean(editingTariff.configurable),
        device_options: Array.isArray(editingTariff.device_options) ? editingTariff.device_options.join(', ') : '',
        traffic_options_gb: Array.isArray(editingTariff.traffic_options_gb) ? editingTariff.traffic_options_gb.join(', ') : '',
        device_step_rub: editingTariff.device_step_rub?.toString() || '',
        traffic_step_rub: editingTariff.traffic_step_rub?.toString() || ''
      })
      
      setGroupInputMode(isInExistingGroups ? 'select' : 'input')
    } else {
      setGroupInputMode('select')
    }
  }, [editingTariff, existingGroups])

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

      const parseNumberList = (raw: string, kind: 'int' | 'float') => {
        const text = String(raw || '').trim()
        if (!text) return null
        // Like in the bot: comma or any whitespace (can be mixed)
        if (text === '0') return null // single 0 means "disable options"
        const parts = text.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean)
        if (parts.length === 0) return null
        const nums = parts
          .map((p) => (kind === 'int' ? parseInt(p, 10) : parseFloat(p)))
          .filter((n) => Number.isFinite(n))
          // allow 0 (unlimited), disallow negatives
          .filter((n) => n >= 0)
        if (nums.length === 0) return null
        // de-dup + sort (stable UX)
        const unique = Array.from(new Set(nums.map((n) => (kind === 'int' ? Math.trunc(n) : n))))
        unique.sort((a, b) => a - b)
        return unique
      }

      const tariffData: any = {}
      
      // Всегда передаем имя, даже если оно не изменилось
      if (formData.name) {
        tariffData.name = formData.name
      }
      
      // Цена - API использует price_rub
      const priceValue = formData.price !== '' && formData.price !== null && formData.price !== undefined 
        ? parseFloat(formData.price) 
        : 0
      tariffData.price_rub = Math.round(priceValue)
      
      // Длительность
      if (formData.duration_days) {
        tariffData.duration_days = parseInt(formData.duration_days)
      }
      
      // Статус - API использует is_active
      tariffData.is_active = Boolean(formData.is_enabled)

      // Конфигурируемость
      tariffData.configurable = Boolean(formData.configurable)
      
      if (formData.configurable) {
        // Parse like in the bot: comma OR whitespace. Allow 0 as "unlimited option".
        tariffData.device_options = parseNumberList(formData.device_options, 'int')
        tariffData.traffic_options_gb = parseNumberList(formData.traffic_options_gb, 'int')

        if (formData.device_step_rub) {
          tariffData.device_step_rub = parseInt(formData.device_step_rub)
        } else {
          tariffData.device_step_rub = null
        }

        if (formData.traffic_step_rub) {
          tariffData.traffic_step_rub = parseInt(formData.traffic_step_rub)
        } else {
          tariffData.traffic_step_rub = null
        }
      } else {
        tariffData.device_options = null
        tariffData.traffic_options_gb = null
        tariffData.device_step_rub = null
        tariffData.traffic_step_rub = null
      }

      // Группировка - API использует group_code
      // Важно: передаем даже пустую строку, чтобы сбросить группу
      tariffData.group_code = formData.group || null
      
      // Подгруппа - API использует subgroup_title
      // Важно: передаем даже пустую строку, чтобы сбросить подгруппу
      tariffData.subgroup_title = formData.subgroup || null
      
      // Сохраняем sort_order если он был (важно для бота!)
      // Если sort_order отсутствует, устанавливаем значение по умолчанию 1
      if (editingTariff) {
        tariffData.sort_order = editingTariff.sort_order !== undefined && editingTariff.sort_order !== null 
          ? editingTariff.sort_order 
          : 1
      } else {
        // Для нового тарифа устанавливаем sort_order по умолчанию
        tariffData.sort_order = 1
      }
      
      // Трафик - API использует traffic_limit (в ГБ, без конвертации!)
      // Пользователь вводит в ГБ, отправляем как есть
      // Всегда передаем поле, даже если значение 0 (безлимит = null)
      if (formData.max_traffic !== '' && formData.max_traffic !== null && formData.max_traffic !== undefined) {
        const trafficGB = parseFloat(formData.max_traffic)
        if (!isNaN(trafficGB) && trafficGB > 0) {
          // Отправляем значение в ГБ как есть (без конвертации)
          tariffData.traffic_limit = Math.round(trafficGB)
        } else {
          tariffData.traffic_limit = null // 0 или пустое = безлимит
        }
      } else {
        tariffData.traffic_limit = null // Безлимит
      }
      
      // Устройства - API использует device_limit
      // Всегда передаем поле, даже если значение 0 (безлимит = null)
      if (formData.max_devices !== '' && formData.max_devices !== null && formData.max_devices !== undefined) {
        const devices = parseInt(formData.max_devices)
        if (!isNaN(devices) && devices > 0) {
          tariffData.device_limit = devices
        } else {
          tariffData.device_limit = null // 0 или пустое = безлимит
        }
      } else {
        tariffData.device_limit = null // Безлимит
      }

      if (editingTariff) {
        // Prefer safe update by numeric id (name is not unique in DB).
        const tid = editingTariff.id ?? editingTariff.tariff_id
        if (typeof tid === 'number' && Number.isFinite(tid)) {
          await updateBotTariffById(config, tid, tariffData)
        } else {
          // Fallback (old API by name)
          const originalName = editingTariff.name || editingTariff.tariff_name
          if (!originalName) {
            setError('Не удалось определить тариф для обновления (нет id/name)')
            setLoading(false)
            return
          }
          await updateBotTariff(config, originalName, tariffData)
        }
      } else {
        await createBotTariff(config, tariffData)
      }

      onSaved()
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения тарифа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      title={editingTariff ? 'Редактирование тарифа' : 'Создание тарифа'}
      subtitle={editingTariff ? 'Измените параметры тарифа' : 'Заполните параметры и создайте тариф'}
      onClose={onClose}
      closeButtonTone="danger"
      shellTone="neutral"
      size="md"
      icon={
        <svg className="w-5 h-5" style={{ color: '#b5b5b5' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      }
      banner={
        error ? (
          <div className="bg-red-500/15 border border-red-500/30 rounded-lg p-2.5 text-red-200 text-xs">
            {error}
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
            className={modalPrimaryButtonClass}
          >
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Название тарифа *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
              placeholder="Например: 1 Месяц"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Группа</label>
            {groupInputMode === 'select' ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <DarkSelect
                    value={formData.group || ''}
                    onChange={(v) => setFormData({ ...formData, group: v })}
                    groups={groupSelectGroups}
                    buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGroupInputMode('input')
                    setFormData({ ...formData, group: '' })
                  }}
                  className={modalSecondaryButtonClass}
                >
                  Добавить новый
                </button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={formData.group}
                  onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
                  placeholder="Введите название группы"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  onClick={() => {
                    setGroupInputMode('select')
                    setFormData({ ...formData, group: '' })
                  }}
                  className={modalSecondaryButtonClass}
                >
                  Отмена
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Подгруппа</label>
            <input
              type="text"
              value={formData.subgroup}
              onChange={(e) => setFormData({ ...formData, subgroup: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
              placeholder="Например: Месячные"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Дней *</label>
            <input
              type="number"
              value={formData.duration_days}
              onChange={(e) => setFormData({ ...formData, duration_days: e.target.value })}
              required
              min="1"
              className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
              placeholder="30"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            <div>
              <label className="block text-sm font-medium text-dim mb-2">
                Трафик (ГБ) <span className="text-muted text-xs">(0 = безлимит)</span>
              </label>
              <input
                type="number"
                value={formData.max_traffic}
                onChange={(e) => setFormData({ ...formData, max_traffic: e.target.value })}
                min="0"
                step="0.01"
                className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-dim mb-2">
                Устройства <span className="text-muted text-xs">(0 = безлимит)</span>
              </label>
              <input
                type="number"
                value={formData.max_devices}
                onChange={(e) => setFormData({ ...formData, max_devices: e.target.value })}
                min="0"
                className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Цена (₽)</label>
            <input
              type="number"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              step="0.01"
              min="0"
              className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
              placeholder="0"
            />
          </div>

          <div className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 bg-overlay-xs rounded-lg border border-default">
            <div className="flex items-center gap-3 w-full">
              <NeoToggle
                checked={Boolean(formData.configurable)}
                onChange={(next) => setFormData({ ...formData, configurable: next })}
                width={60}
                height={28}
                showStatus={false}
              />
              <div>
                <span className="text-sm text-dim font-medium">Конструктор тарифа</span>
                <p className="text-xs text-muted">Пользователь сам выбирает трафик и устройства</p>
              </div>
            </div>
          </div>

          {formData.configurable && (
            <div className="space-y-3 pl-2 border-l-2 border-blue-500/30">
              <div>
                <label className="block text-sm font-medium text-dim mb-2">Варианты устройств (через пробел или запятую)</label>
                <input
                  type="text"
                  value={formData.device_options}
                  onChange={(e) => setFormData({ ...formData, device_options: e.target.value })}
                  className="w-full px-3 py-2 bg-overlay-xs border border-default rounded focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)]/50 text-primary text-sm"
                  placeholder="Например: 1 3 5 10 или 1, 3, 5, 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dim mb-2">Шаг цены за устройство (₽)</label>
                <input
                  type="number"
                  value={formData.device_step_rub}
                  onChange={(e) => setFormData({ ...formData, device_step_rub: e.target.value })}
                  className="w-full px-3 py-2 bg-overlay-xs border border-default rounded focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)]/50 text-primary text-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dim mb-2">Варианты трафика (ГБ, через пробел или запятую)</label>
                <input
                  type="text"
                  value={formData.traffic_options_gb}
                  onChange={(e) => setFormData({ ...formData, traffic_options_gb: e.target.value })}
                  className="w-full px-3 py-2 bg-overlay-xs border border-default rounded focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)]/50 text-primary text-sm"
                  placeholder="Например: 20 30 50 80 или 20, 30, 50, 80"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dim mb-2">Шаг цены за трафик (₽)</label>
                <input
                  type="number"
                  value={formData.traffic_step_rub}
                  onChange={(e) => setFormData({ ...formData, traffic_step_rub: e.target.value })}
                  className="w-full px-3 py-2 bg-overlay-xs border border-default rounded focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)]/50 text-primary text-sm"
                  placeholder="0"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 bg-overlay-xs rounded-lg border border-default">
            <div className="flex items-center gap-3">
              <NeoToggle
                checked={Boolean(formData.is_enabled)}
                onChange={(next) => setFormData({ ...formData, is_enabled: next })}
                width={60}
                height={28}
                showStatus={false}
              />
              <span className={`text-sm ${formData.is_enabled ? 'text-emerald-400' : 'text-red-400'}`}>
                {formData.is_enabled ? 'Включен' : 'Выключен'}
              </span>
            </div>
          </div>
      </form>
    </ModalShell>
  )
}

