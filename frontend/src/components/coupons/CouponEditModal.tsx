import { useId, useState, useEffect } from 'react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { createBotCoupon, updateBotCoupon } from '../../api/botApi'
import type { BotCoupon } from '../../api/types'
import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../common/ModalShell'
import DarkSelect, { type DarkSelectGroup } from '../common/DarkSelect'

interface CouponEditModalProps {
  editingCoupon?: BotCoupon
  onClose: () => void
  onSaved: () => void
}

export default function CouponEditModal({ editingCoupon, onClose, onSaved }: CouponEditModalProps) {
  const formId = useId()
  const [formData, setFormData] = useState({
    code: '',
    balance: '',
    days: '',
    max_uses: ''
  })
  const [valueType, setValueType] = useState<'days' | 'balance'>('days')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valueTypeGroups = [
    {
      options: [
        { value: 'days', label: 'Дни' },
        { value: 'balance', label: 'Баланс' },
      ],
    },
  ] satisfies DarkSelectGroup[]

  useEffect(() => {
    if (editingCoupon) {
      // Определяем тип значения (дни или баланс)
      const hasDays = editingCoupon.days !== undefined && editingCoupon.days !== null ||
        (editingCoupon.duration_days !== undefined && editingCoupon.duration_days !== null) ||
        (editingCoupon.duration !== undefined && editingCoupon.duration !== null)
      
      const hasBalance = editingCoupon.balance !== undefined && editingCoupon.balance !== null ||
        (editingCoupon.amount !== undefined && editingCoupon.amount !== null) ||
        (editingCoupon.bonus !== undefined && editingCoupon.bonus !== null) ||
        (editingCoupon.balance_amount !== undefined && editingCoupon.balance_amount !== null)
      
      if (hasDays) {
        setValueType('days')
        const days = editingCoupon.days || editingCoupon.duration_days || editingCoupon.duration
        setFormData({
          code: editingCoupon.code || '',
          balance: '',
          days: days?.toString() || '',
          max_uses: editingCoupon.max_uses?.toString() || editingCoupon.max_use?.toString() || editingCoupon.limit?.toString() || editingCoupon.max_count?.toString() || ''
        })
      } else if (hasBalance) {
        setValueType('balance')
        const balance = editingCoupon.balance || editingCoupon.amount || editingCoupon.bonus || editingCoupon.balance_amount
        setFormData({
          code: editingCoupon.code || '',
          balance: balance?.toString() || '',
          days: '',
          max_uses: editingCoupon.max_uses?.toString() || editingCoupon.max_use?.toString() || editingCoupon.limit?.toString() || editingCoupon.max_count?.toString() || ''
        })
      } else {
        // По умолчанию дни
        setValueType('days')
        setFormData({
          code: editingCoupon.code || '',
          balance: '',
          days: '',
          max_uses: editingCoupon.max_uses?.toString() || editingCoupon.max_use?.toString() || editingCoupon.limit?.toString() || editingCoupon.max_count?.toString() || ''
        })
      }
    } else {
      setValueType('days')
      setFormData({
        code: '',
        balance: '',
        days: '',
        max_uses: ''
      })
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

      const couponData: {
        code: string
        days?: number
        amount?: number
        usage_limit: number
        max_uses: number
      } = {
        code: formData.code,
        usage_limit: 0,
        max_uses: 0
      }

      // Добавляем дни или баланс в зависимости от типа
      // API требует: либо 'amount' (для баланса), либо 'days' (для дней), но не оба
      if (valueType === 'days' && formData.days) {
        couponData.days = parseInt(formData.days)
        // Убеждаемся, что amount не отправляется
        delete couponData.amount
      } else if (valueType === 'balance' && formData.balance) {
        // API ожидает поле 'amount' для баланса
        couponData.amount = parseFloat(formData.balance)
        // Убеждаемся, что days не отправляется
        delete couponData.days
      }

      // Лимит использований - API требует поле usage_limit
      if (formData.max_uses && formData.max_uses !== '0' && formData.max_uses.trim() !== '') {
        couponData.usage_limit = parseInt(formData.max_uses)
        // Также отправляем max_uses для совместимости
        couponData.max_uses = parseInt(formData.max_uses)
      } else {
        // Если 0 или пусто - отправляем 0 для безлимита (API требует поле)
        couponData.usage_limit = 0
        couponData.max_uses = 0
      }

      if (editingCoupon) {
        // API может принимать либо ID, либо код купона
        // Приоритет: код купона (если есть), затем ID
        const couponId = (editingCoupon.code || editingCoupon.id || editingCoupon.coupon_id) as string | number
        if (!couponId) {
          throw new Error('Не указан ID или код купона для обновления')
        }
        await updateBotCoupon(config, couponId, couponData)
      } else {
        await createBotCoupon(config, couponData)
      }

      onSaved()
    } catch (err) {
      // handleBotResponse уже обработал ошибку и выбросил Error с сообщением
      const errorMessage = err instanceof Error ? err.message : (typeof err === 'string' ? err : 'Ошибка сохранения купона')
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      title={editingCoupon ? 'Редактирование купона' : 'Создание купона'}
      subtitle="Купон даёт дни или бонус на баланс — выберите тип значения"
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
            <label className="block text-sm font-medium text-dim mb-2">Код купона *</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              required
              className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
              placeholder="Например: PROMO2024"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Тип значения</label>
            <DarkSelect
              value={valueType}
              onChange={(v) => setValueType(v as 'days' | 'balance')}
              groups={valueTypeGroups}
              buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary text-sm"
            />
          </div>

          {valueType === 'days' ? (
            <div>
              <label className="block text-sm font-medium text-dim mb-2">Количество дней *</label>
              <input
                type="number"
                value={formData.days}
                onChange={(e) => setFormData({ ...formData, days: e.target.value })}
                required={valueType === 'days'}
                min="1"
                className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
                placeholder="Например: 30"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-dim mb-2">Сумма баланса (₽) *</label>
              <input
                type="number"
                value={formData.balance}
                onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
                required={valueType === 'balance'}
                min="0"
                step="0.01"
                className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
                placeholder="Например: 100"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-dim mb-2">
              Лимит использований <span className="text-muted text-xs">(0 = безлимит)</span>
            </label>
            <input
              type="number"
              value={formData.max_uses}
              onChange={(e) => setFormData({ ...formData, max_uses: e.target.value })}
              min="0"
              className="w-full px-3 py-2 rounded-lg border border-default bg-transparent text-primary text-sm placeholder:text-faint"
              placeholder="0"
            />
          </div>
      </form>
    </ModalShell>
  )
}

