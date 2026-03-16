import React, { useId, useState, useEffect } from 'react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { createBotCoupon, updateBotCoupon } from '../../api/botApi'
import type { BotCoupon } from '../../api/types'
import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../common/ModalShell'

type CouponType = 'balance' | 'days' | 'percent'

interface CouponEditModalProps {
  editingCoupon?: BotCoupon
  onClose: () => void
  onSaved: () => void
}

const typeCards: { value: CouponType; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    value: 'balance',
    label: 'Баланс',
    desc: 'Бонус на баланс',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    value: 'days',
    label: 'Время',
    desc: 'Дни подписки',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    value: 'percent',
    label: 'Процент',
    desc: 'Скидка на покупку',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" />
      </svg>
    ),
  },
]

export default function CouponEditModal({ editingCoupon, onClose, onSaved }: CouponEditModalProps) {
  const formId = useId()
  const [couponType, setCouponType] = useState<CouponType>('balance')
  const [code, setCode] = useState('')
  const [balance, setBalance] = useState('')
  const [days, setDays] = useState('')
  const [percent, setPercent] = useState('')
  const [maxDiscount, setMaxDiscount] = useState('')
  const [minOrder, setMinOrder] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [newUsersOnly, setNewUsersOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editingCoupon) {
      const c = editingCoupon as any
      setCode(c.code || '')

      // Detect type
      const hasPercent = c.percent !== undefined && c.percent !== null && Number(c.percent) > 0
      const hasDays = (c.days !== undefined && c.days !== null && Number(c.days) > 0) ||
        (c.duration_days !== undefined && c.duration_days !== null && Number(c.duration_days) > 0) ||
        (c.duration !== undefined && c.duration !== null && Number(c.duration) > 0)
      const hasBalance = (c.amount !== undefined && c.amount !== null && Number(c.amount) > 0) ||
        (c.balance !== undefined && c.balance !== null && Number(c.balance) > 0) ||
        (c.bonus !== undefined && c.bonus !== null && Number(c.bonus) > 0) ||
        (c.balance_amount !== undefined && c.balance_amount !== null && Number(c.balance_amount) > 0)

      if (hasPercent) {
        setCouponType('percent')
        setPercent(String(c.percent || ''))
        setMaxDiscount(String(c.max_discount_amount || ''))
        setMinOrder(String(c.min_order_amount || ''))
      } else if (hasDays) {
        setCouponType('days')
        setDays(String(c.days || c.duration_days || c.duration || ''))
      } else if (hasBalance) {
        setCouponType('balance')
        setBalance(String(c.amount || c.balance || c.bonus || c.balance_amount || ''))
      } else {
        setCouponType('balance')
      }

      const limit = c.max_uses ?? c.max_use ?? c.limit ?? c.max_count ?? c.usage_limit ?? ''
      setMaxUses(String(limit))
      setNewUsersOnly(Boolean(c.new_users_only))
    } else {
      setCouponType('balance')
      setCode('')
      setBalance('')
      setDays('')
      setPercent('')
      setMaxDiscount('')
      setMinOrder('')
      setMaxUses('')
      setNewUsersOnly(false)
    }
  }, [editingCoupon])

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

      const couponData: Record<string, any> = {
        code,
        usage_limit: maxUses ? parseInt(maxUses) : 0,
        max_uses: maxUses ? parseInt(maxUses) : 0,
        new_users_only: newUsersOnly,
      }

      if (couponType === 'balance') {
        couponData.amount = balance ? parseFloat(balance) : 0
      } else if (couponType === 'days') {
        couponData.days = days ? parseInt(days) : 0
      } else if (couponType === 'percent') {
        couponData.percent = percent ? parseInt(percent) : 0
        if (maxDiscount) couponData.max_discount_amount = parseInt(maxDiscount)
        if (minOrder) couponData.min_order_amount = parseInt(minOrder)
      }

      if (editingCoupon) {
        const c = editingCoupon as any
        const couponId = (c.code || c.id || c.coupon_id) as string | number
        if (!couponId) throw new Error('Не указан ID или код купона для обновления')
        await updateBotCoupon(config, couponId, couponData)
      } else {
        await createBotCoupon(config, couponData)
      }

      onSaved()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : (typeof err === 'string' ? err : 'Ошибка сохранения купона')
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const inputClass = "w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint focus:outline-none focus:border-[var(--accent)] transition-colors"

  return (
    <ModalShell
      title={editingCoupon ? 'Редактирование купона' : 'Создание купона'}
      subtitle="Выберите тип купона и заполните параметры"
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
            d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"
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
          <button type="button" onClick={onClose} className={modalSecondaryButtonClass}>
            Отмена
          </button>
          <button type="submit" form={formId} disabled={loading} className={modalPrimaryButtonClass}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        {/* Type selector cards */}
        <div>
          <label className="block text-sm font-medium text-dim mb-2">Тип купона</label>
          <div className="grid grid-cols-3 gap-2">
            {typeCards.map((t) => {
              const active = couponType === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setCouponType(t.value)}
                  className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all text-center ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-default bg-overlay-xs text-muted hover:bg-overlay-sm hover:text-primary'
                  }`}
                >
                  <span className={active ? 'text-[var(--accent)]' : 'text-muted'}>{t.icon}</span>
                  <span className="text-sm font-medium leading-tight">{t.label}</span>
                  <span className="text-[11px] leading-tight opacity-70">{t.desc}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Code */}
        <div>
          <label className="block text-sm font-medium text-dim mb-2">Код купона *</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            className={inputClass}
            placeholder="Например: PROMO2024"
          />
        </div>

        {/* Type-specific fields */}
        {couponType === 'balance' && (
          <div>
            <label className="block text-sm font-medium text-dim mb-2">Сумма баланса (₽) *</label>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              required
              min="0"
              step="0.01"
              className={inputClass}
              placeholder="Например: 100"
            />
          </div>
        )}

        {couponType === 'days' && (
          <div>
            <label className="block text-sm font-medium text-dim mb-2">Количество дней *</label>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              required
              min="1"
              className={inputClass}
              placeholder="Например: 30"
            />
          </div>
        )}

        {couponType === 'percent' && (
          <>
            <div>
              <label className="block text-sm font-medium text-dim mb-2">Процент скидки (%) *</label>
              <input
                type="number"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                required
                min="1"
                max="100"
                className={inputClass}
                placeholder="Например: 20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dim mb-2">
                Макс. сумма скидки (₽) <span className="text-muted text-xs">(необязательно)</span>
              </label>
              <input
                type="number"
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(e.target.value)}
                min="0"
                className={inputClass}
                placeholder="Без ограничения"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dim mb-2">
                Мин. сумма заказа (₽) <span className="text-muted text-xs">(необязательно)</span>
              </label>
              <input
                type="number"
                value={minOrder}
                onChange={(e) => setMinOrder(e.target.value)}
                min="0"
                className={inputClass}
                placeholder="Без ограничения"
              />
            </div>
          </>
        )}

        {/* Max uses */}
        <div>
          <label className="block text-sm font-medium text-dim mb-2">
            Лимит использований <span className="text-muted text-xs">(0 = безлимит)</span>
          </label>
          <input
            type="number"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            min="0"
            className={inputClass}
            placeholder="0"
          />
        </div>

        {/* New users only toggle */}
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className="relative">
            <input
              type="checkbox"
              checked={newUsersOnly}
              onChange={(e) => setNewUsersOnly(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 rounded-full transition-colors peer-checked:bg-[var(--accent)] bg-[var(--bg-overlay-md)] border border-default" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4 shadow-sm" />
          </div>
          <span className="text-sm text-dim group-hover:text-primary transition-colors">Только для новых пользователей</span>
        </label>
      </form>
    </ModalShell>
  )
}
