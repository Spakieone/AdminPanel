import React, { useId, useState, useEffect, useMemo } from 'react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { createBotGift, updateBotGift, getBotTariffs } from '../../api/botApi'
import type { BotGift, BotTariff } from '../../api/types'
import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../common/ModalShell'
import DarkSelect, { type DarkSelectGroup } from '../common/DarkSelect'

interface GiftEditModalProps {
  editingGift?: BotGift
  onClose: () => void
  onSaved: () => void
}

function generateGiftId(): string {
  const chars = '0123456789abcdef'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function generateGiftLink(giftId: string, botUsername: string = 'No_Touch_Bot'): string {
  return `https://t.me/${botUsername}?start=gift_${giftId}`
}

export default function GiftEditModal({ editingGift, onClose, onSaved }: GiftEditModalProps) {
  const formId = useId()
  const [giftId, setGiftId] = useState<string>('')
  const [formData, setFormData] = useState({
    tariff_id: '',
    max_usages: '',
    unlimited: false,
    expiry_time: '',
    gift_link: '',
  })
  const [tariffs, setTariffs] = useState<BotTariff[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadTariffs = async () => {
      try {
        const config = await getBotConfigAsync()
        if (config) {
          const data = await getBotTariffs(config)
          const tariffsList = Array.isArray(data) ? data : []
          setTariffs(tariffsList)
        }
      } catch {
        // Ошибка загрузки тарифов - игнорируем
      }
    }
    loadTariffs()
  }, [])

  useEffect(() => {
    if (!editingGift && !giftId) {
      const newGiftId = generateGiftId()
      setGiftId(newGiftId)
    } else if (editingGift) {
      setGiftId(editingGift.gift_id || String(editingGift.id || ''))
    }
  }, [editingGift, giftId])

  // Keep gift_link synced with gift_id for new gifts (can still be edited manually)
  useEffect(() => {
    if (editingGift) return
    if (!giftId) return
    setFormData((prev) => {
      if (String(prev.gift_link || '').trim()) return prev
      return { ...prev, gift_link: generateGiftLink(giftId) }
    })
  }, [editingGift, giftId])

  useEffect(() => {
    if (editingGift) {
      let tariffId = ''
      if (editingGift.tariff_id) {
        tariffId = editingGift.tariff_id.toString()
      } else if (editingGift.tariff_name) {
        const tariff = tariffs.find(t => (t.name || t.tariff_name) === editingGift.tariff_name)
        if (tariff) {
          const tariffIdValue = tariff.id || tariff.tariff_id
          if (tariffIdValue !== undefined && tariffIdValue !== null) {
            tariffId = String(tariffIdValue)
          }
        }
      }

      let maxUsages = ''
      if (editingGift.max_usages !== undefined && editingGift.max_usages !== null) {
        maxUsages = editingGift.max_usages.toString()
      } else if (editingGift.max_uses !== undefined && editingGift.max_uses !== null) {
        maxUsages = editingGift.max_uses.toString()
      } else if (editingGift.usage_limit !== undefined && editingGift.usage_limit !== null) {
        maxUsages = editingGift.usage_limit.toString()
      }

      const unlimited = editingGift.unlimited !== undefined ? Boolean(editingGift.unlimited) :
        (editingGift.is_unlimited !== undefined ? Boolean(editingGift.is_unlimited) :
        (maxUsages === '0' || maxUsages === ''))

      let expiryTime = ''
      if (editingGift.expiry_time) {
        if (typeof editingGift.expiry_time === 'number') {
          expiryTime = new Date(editingGift.expiry_time).toISOString().slice(0, 16)
        } else if (typeof editingGift.expiry_time === 'string') {
          expiryTime = new Date(editingGift.expiry_time).toISOString().slice(0, 16)
        }
      } else {
        const expiresAt = editingGift.expires_at as string | number | undefined
        const validUntil = editingGift.valid_until as string | number | undefined
        if (expiresAt && (typeof expiresAt === 'string' || typeof expiresAt === 'number')) {
          expiryTime = new Date(expiresAt).toISOString().slice(0, 16)
        } else if (validUntil && (typeof validUntil === 'string' || typeof validUntil === 'number')) {
          expiryTime = new Date(validUntil).toISOString().slice(0, 16)
        }
      }

      const giftLinkRaw = (editingGift as any)?.gift_link || (editingGift as any)?.giftLink || ''
      const giftLink = String(giftLinkRaw || '').trim() || (giftId ? generateGiftLink(giftId) : '')

      setFormData({
        tariff_id: tariffId,
        max_usages: unlimited ? '0' : maxUsages,
        unlimited: unlimited,
        expiry_time: expiryTime,
        gift_link: giftLink,
      })
    } else {
      const defaultExpiry = new Date()
      defaultExpiry.setMonth(defaultExpiry.getMonth() + 1) // +1 месяц от текущей даты
      
      setFormData({
        tariff_id: '',
        max_usages: '0',
        unlimited: false,
        expiry_time: defaultExpiry.toISOString().slice(0, 16),
        gift_link: giftId ? generateGiftLink(giftId) : '',
      })
    }
  }, [editingGift, tariffs, giftId])

  const tariffsByGroup = useMemo(() => {
    const groups: Record<string, BotTariff[]> = {}
    tariffs.forEach(t => {
      const group = t.group_code || t.group || 'Без группы'
      if (!groups[group]) groups[group] = []
      groups[group].push(t)
    })

    return Object.keys(groups).sort((a, b) => a.localeCompare(b)).map(groupName => {
      const sorted = groups[groupName].slice().sort((a, b) => {
        const nameA = String(a.name || a.tariff_name || '').toLowerCase()
        const nameB = String(b.name || b.tariff_name || '').toLowerCase()
        return nameA.localeCompare(nameB)
      })
      return { groupName, tariffs: sorted }
    })
  }, [tariffs])

  const tariffSelectGroups = useMemo<DarkSelectGroup[]>(() => {
    const groups: DarkSelectGroup[] = [
      {
        options: [{ value: '', label: 'Выберите тариф', disabled: true }],
      },
    ]
    tariffsByGroup.forEach((g) => {
      const options = (g.tariffs || [])
        .map((t) => {
          const id = t.id || t.tariff_id
          if (id === undefined || id === null) return null
          const label = t.name || t.tariff_name || `Тариф ${id}`
          return { value: String(id), label }
        })
        .filter(Boolean) as any[]
      if (options.length > 0) groups.push({ groupLabel: g.groupName, options })
    })
    return groups
  }, [tariffsByGroup])

  const yesNoGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: 'no', label: 'Нет' },
          { value: 'yes', label: 'Да' },
        ],
      },
    ],
    [],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!String(formData.tariff_id || '').trim()) {
        setError('Выберите тариф')
        setLoading(false)
        return
      }
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля')
        setLoading(false)
        return
      }

      // Преобразуем expiry_time в datetime объект (без timezone для совместимости с БД)
      let expiryDateTime: string | null = null
      if (formData.expiry_time) {
        // Создаем ISO строку без timezone
        const localDate = new Date(formData.expiry_time)
        // Форматируем как ISO строку, но без timezone (заменяем Z на пустую строку)
        expiryDateTime = localDate.toISOString().replace('Z', '')
      }

      // gift_link (allow manual override)
      const giftLink = String(formData.gift_link || '').trim() || (giftId ? generateGiftLink(giftId) : '')

      const giftData: {
        sender_tg_id: number
        recipient_tg_id: number | null
        selected_months: number | null
        expiry_time: string | null
        gift_link: string
        is_used: boolean
        is_unlimited: boolean
        max_usages: number | null
        tariff_id: number
        gift_id?: string
      } = {
        sender_tg_id: config.tgId, // Используем tgId из конфига
        recipient_tg_id: null,
        selected_months: null,
        expiry_time: expiryDateTime,
        gift_link: giftLink,
        is_used: false,
        is_unlimited: formData.unlimited,
        max_usages: formData.unlimited ? null : (() => {
          const n = parseInt(String(formData.max_usages || '0'), 10)
          return Number.isFinite(n) ? n : 0
        })(),
        tariff_id: parseInt(formData.tariff_id)
      }

      // При создании добавляем gift_id, если он сгенерирован
      if (!editingGift && giftId) {
        giftData.gift_id = giftId
      }

      if (editingGift) {
        const giftIdToUpdate = editingGift.id || editingGift.gift_id
        if (!giftIdToUpdate) {
          throw new Error('Не указан ID подарка для обновления')
        }
        await updateBotGift(config, giftIdToUpdate, giftData)
      } else {
        await createBotGift(config, giftData)
      }

      onSaved()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : (typeof err === 'string' ? err : 'Ошибка сохранения подарка')
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      title={editingGift ? 'Редактирование подарка' : 'Создание подарка'}
      subtitle="Подарок = ссылка в Telegram на выбранный тариф"
      onClose={onClose}
      closeButtonTone="danger"
      shellTone="neutral"
      size="lg"
      icon={
        <svg className="w-5 h-5" style={{ color: '#b5b5b5' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
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
            {loading ? 'Сохранение...' : editingGift ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block">
              <div className="text-xs text-muted mb-1">Тариф *</div>
              <DarkSelect
                value={formData.tariff_id}
                onChange={(v) => setFormData({ ...formData, tariff_id: v })}
                groups={tariffSelectGroups}
                placeholder="Выберите тариф"
                buttonClassName="w-full h-10 rounded-xl border border-default bg-transparent text-primary px-3 outline-none hover:bg-overlay-sm"
              />
            </label>
          </div>

          <div>
            <label className="block">
              <div className="text-xs text-muted mb-1">Безлимит</div>
              <DarkSelect
                value={formData.unlimited ? 'yes' : 'no'}
                onChange={(v) => {
                  const unlimited = v === 'yes'
                  setFormData({
                    ...formData,
                    unlimited,
                    max_usages: unlimited ? '0' : formData.max_usages,
                  })
                }}
                groups={yesNoGroups}
                buttonClassName="w-full h-10 rounded-xl border border-default bg-transparent text-primary px-3 outline-none hover:bg-overlay-sm"
              />
            </label>
          </div>

          <div>
            <label className="block">
              <div className="text-xs text-muted mb-1">Макс. использований</div>
              <input
                type="number"
                value={formData.max_usages}
                onChange={(e) => {
                  const value = e.target.value
                  setFormData({
                    ...formData,
                    max_usages: value,
                    unlimited: value === '0' || value === '',
                  })
                }}
                disabled={formData.unlimited}
                min="0"
                className="w-full h-10 rounded-xl border border-default bg-transparent text-primary px-3 outline-none hover:bg-overlay-sm disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="0"
              />
            </label>
            <div className="mt-1 text-[11px] text-muted">
              0 = бесконечно (если “Безлимит” включён, это поле не нужно).
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block">
              <div className="text-xs text-muted mb-1">Срок действия *</div>
              <input
                type="datetime-local"
                value={formData.expiry_time}
                onChange={(e) => setFormData({ ...formData, expiry_time: e.target.value })}
                required
                className="w-full h-10 rounded-xl border border-default bg-transparent text-primary px-3 outline-none hover:bg-overlay-sm"
              />
            </label>
          </div>
        </div>
      </form>
    </ModalShell>
  )
}
