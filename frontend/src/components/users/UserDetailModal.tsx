import { useEffect, useMemo, useState } from 'react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { getBotUser, getBotKeysByTgId, getBotPaymentsByTgId, getBotTariffs, getBotReferralsAll, deleteBotReferral, deleteBotKey, deleteBotKeyByEmail, addUserBalance, takeUserBalance, deleteBotUser, getUserPartner, setUserPartnerPercent, setUserPartnerCode, resetUserPartner, addUserPartnerBalance, subtractUserPartnerBalance, addUserPartnerReferral } from '../../api/botApi'
import type { UserPartnerData } from '../../api/botApi'
import { getProviderColor as getSharedProviderColor } from '../../utils/providerColor'
import KeyEditModal from './KeyEditModal'
import ModalShell from '../common/ModalShell'
import { formatMskDateTime, formatMskDateTimeLocal } from '../../utils/dateUtils'
import DeleteButton from '../ui/DeleteButton'
import EditButton from '../ui/EditButton'
import CopyText from '../ui/CopyText'
import ConfirmModal from '../common/ConfirmModal'

interface UserDetailModalProps {
  tgId: number
  onClose: () => void
  onDeleted?: () => void
}

export default function UserDetailModal({ tgId, onClose, onDeleted }: UserDetailModalProps) {
  const [user, setUser] = useState<any>(null)
  const [keys, setKeys] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [referrals, setReferrals] = useState<any[]>([])
  const [referralsStats, setReferralsStats] = useState<any>(null)
  const [tariffs, setTariffs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'info' | 'payments' | 'referrals' | 'partner'>('info')
  const [partnerData, setPartnerData] = useState<UserPartnerData | null>(null)
  const [partnerLoading, setPartnerLoading] = useState(false)
  const [partnerError, setPartnerError] = useState<string | null>(null)
  // partner edit states
  const [editPercent, setEditPercent] = useState(false)
  const [percentInput, setPercentInput] = useState('')
  const [editCode, setEditCode] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [partnerSaving, setPartnerSaving] = useState(false)
  // partner management
  const [partnerBalanceMode, setPartnerBalanceMode] = useState<'add' | 'subtract' | null>(null)
  const [partnerBalanceInput, setPartnerBalanceInput] = useState('')
  const [addReferralMode, setAddReferralMode] = useState(false)
  const [addReferralInput, setAddReferralInput] = useState('')
  const [showKeyEditor, setShowKeyEditor] = useState(false)
  const [editingKey, setEditingKey] = useState<any>(null)
  const [keyToDelete, setKeyToDelete] = useState<any | null>(null)
  const [paymentsPage, setPaymentsPage] = useState(1)
  const paymentsPerPage = 10
  const [referralsPage, setReferralsPage] = useState(1)
  const referralsPerPage = 10
  const [deletingReferrals, setDeletingReferrals] = useState(false)
  const [balanceMode, setBalanceMode] = useState<'add' | 'take' | null>(null)
  const [balanceAmount, setBalanceAmount] = useState('')
  const [updatingBalance, setUpdatingBalance] = useState(false)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(false)
  const [deletingUser, setDeletingUser] = useState(false)
  const [referralToDelete, setReferralToDelete] = useState<{ referrerId: number; referredId: number } | null>(null)

  useEffect(() => {
    loadUserData()
  }, [tgId])

  const loadUserData = async () => {
    setLoading(true)
    setError(null)

    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля')
        setLoading(false)
        return
      }

      const [userData, keysData, paymentsData, referralsData, tariffsData] = await Promise.all([
        getBotUser(config, tgId).catch(() => null),
        getBotKeysByTgId(config, tgId).catch(() => []),
        getBotPaymentsByTgId(config, tgId).catch(() => []),
        getBotReferralsAll(config, tgId).catch(() => ({ referrals: [], stats: {} })),
        getBotTariffs(config).catch(() => []),
      ]) as [any, any[], any[], any, any[]]

      setUser(userData)
      const keysList = Array.isArray(keysData) ? keysData : []
      
      // Обогащаем ключи данными о тарифах
      const enrichedKeys = keysList.map(key => {
        if (key.tariff_id || key.tariffId) {
          const tariff = tariffsData.find((t: any) => 
            (t.id || t.tariff_id) === (key.tariff_id || key.tariffId)
          )
          if (tariff) {
            return { ...key, tariff_name: tariff.name || tariff.tariff_name || key.tariff_id || key.tariffId }
          }
        }
        return key
      })
      
      setKeys(enrichedKeys)
      setPayments(Array.isArray(paymentsData) ? paymentsData : [])
      
      // Используем детальную статистику рефералов из /api/referrals/all/{tg_id}
      // referralsData может быть объектом с referrals и stats, или просто массивом
      let userReferrals: any[] = []
      let stats: any = null
      
      if (Array.isArray(referralsData)) {
        userReferrals = referralsData
      } else if (referralsData && referralsData.referrals) {
        userReferrals = Array.isArray(referralsData.referrals) ? referralsData.referrals : []
        // Сохраняем статистику, если она есть
        if (referralsData.stats) {
          stats = referralsData.stats
        }
      }
      
      setReferrals(userReferrals)
      setReferralsStats(stats)
      
      setTariffs(Array.isArray(tariffsData) ? tariffsData : [])
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }

  const loadPartnerData = async () => {
    setPartnerLoading(true)
    setPartnerError(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) { setPartnerError('Нет активного профиля'); return }
      const data = await getUserPartner(config, tgId)
      setPartnerData(data)
    } catch (err: any) {
      setPartnerError(err.message || 'Ошибка загрузки')
    } finally {
      setPartnerLoading(false)
    }
  }

  const handlePartnerSavePercent = async () => {
    const val = percentInput.trim()
    const pct = val === '' ? null : parseFloat(val.replace(',', '.'))
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setPartnerError('Введите процент от 0 до 100')
      return
    }
    setPartnerSaving(true)
    setPartnerError(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) return
      await setUserPartnerPercent(config, tgId, pct)
      setEditPercent(false)
      setPercentInput('')
      await loadPartnerData()
    } catch (err: any) {
      setPartnerError(err.message || 'Ошибка')
    } finally {
      setPartnerSaving(false)
    }
  }

  const handlePartnerSaveCode = async () => {
    const code = codeInput.trim() || null
    setPartnerSaving(true)
    setPartnerError(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) return
      await setUserPartnerCode(config, tgId, code)
      setEditCode(false)
      setCodeInput('')
      await loadPartnerData()
    } catch (err: any) {
      setPartnerError(err.message || 'Ошибка')
    } finally {
      setPartnerSaving(false)
    }
  }

  const handlePartnerReset = async () => {
    setPartnerSaving(true)
    setPartnerError(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) return
      await resetUserPartner(config, tgId)
      await loadPartnerData()
    } catch (err: any) {
      setPartnerError(err.message || 'Ошибка')
    } finally {
      setPartnerSaving(false)
    }
  }

  const handlePartnerBalanceApply = async () => {
    const amount = parseFloat(partnerBalanceInput.replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) { setPartnerError('Введите корректную сумму'); return }
    setPartnerSaving(true)
    setPartnerError(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) return
      if (partnerBalanceMode === 'add') await addUserPartnerBalance(config, tgId, amount)
      else await subtractUserPartnerBalance(config, tgId, amount)
      setPartnerBalanceMode(null)
      setPartnerBalanceInput('')
      await loadPartnerData()
    } catch (err: any) { setPartnerError(err.message || 'Ошибка') }
    finally { setPartnerSaving(false) }
  }

  const handleAddReferral = async () => {
    const refId = parseInt(addReferralInput.trim(), 10)
    if (!Number.isFinite(refId) || refId <= 0) { setPartnerError('Введите корректный TG ID'); return }
    setPartnerSaving(true)
    setPartnerError(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) return
      await addUserPartnerReferral(config, tgId, refId)
      setAddReferralMode(false)
      setAddReferralInput('')
      await loadPartnerData()
    } catch (err: any) { setPartnerError(err.message || 'Ошибка') }
    finally { setPartnerSaving(false) }
  }

  const handleCreateKey = () => {
    setEditingKey(null)
    setShowKeyEditor(true)
  }

  const handleEditKey = (key: any) => {
    setEditingKey(key)
    setShowKeyEditor(true)
  }

  const handleDeleteKey = (key: any) => {
    setKeyToDelete(key)
  }

  const confirmDelete = async () => {
    if (!keyToDelete) return
    
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля')
        setKeyToDelete(null)
        return
      }
      const keyId = keyToDelete.client_id || keyToDelete.clientId || keyToDelete.id || null
      if (keyId) {
        await deleteBotKey(config, String(keyId))
      } else {
        // Legacy fallback
        await deleteBotKeyByEmail(config, keyToDelete.email)
      }
      setKeyToDelete(null)
      await loadUserData()
    } catch (err: any) {
      setError(err.message || 'Ошибка удаления ключа')
      setKeyToDelete(null)
    }
  }

  const handleKeySaved = () => {
    setShowKeyEditor(false)
    setEditingKey(null)
    loadUserData()
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    return formatMskDateTime(dateString)
  }

  // For payments - backend sends MSK time, no need to convert
  const formatDatePayment = (dateString?: string) => {
    if (!dateString) return '-'
    return formatMskDateTimeLocal(dateString)
  }

  const formatCurrency = (amount?: number) => {
    if (amount === undefined || amount === null) return '0 ₽'
    return `${amount.toLocaleString('ru-RU')} ₽`
  }

  const getDaysLeft = (dateString?: string) => {
    if (!dateString) return null
    const date = new Date(dateString)
    const now = Date.now()
    const diff = date.getTime() - now
    if (diff <= 0) return null
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    return days
  }

  const getKeyStatus = (key: any) => {
    if (key.is_frozen || key.frozen) {
      return { text: 'Заморожена', class: 'bg-yellow-500/20 text-yellow-400' }
    }
    
    if (!key.expiry_time) {
      return { text: 'Активна', class: 'bg-green-500/20 text-green-400' }
    }
    
    const isExpired = new Date(key.expiry_time).getTime() <= Date.now()
    if (isExpired) {
      return { text: 'Истекла', class: 'bg-red-500/20 text-red-400' }
    }
    
    return { text: 'Активна', class: 'bg-green-500/20 text-green-400' }
  }

  // Сортируем платежи по дате (последние сначала)
  const sortedPayments = useMemo(() => [...payments].sort((a, b) => {
    const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
    const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
    return dateB - dateA
  }), [payments])

  // Сортируем рефералов по дате (последние сначала)
  const sortedReferrals = useMemo(() => [...referrals].sort((a, b) => {
    const dateA = a.created_at || a.date || a.referral_date ? new Date(a.created_at || a.date || a.referral_date).getTime() : 0
    const dateB = b.created_at || b.date || b.referral_date ? new Date(b.created_at || b.date || b.referral_date).getTime() : 0
    return dateB - dateA
  }), [referrals])

  const paginatedReferrals = sortedReferrals.slice(
    (referralsPage - 1) * referralsPerPage,
    referralsPage * referralsPerPage
  )

  // Provider badge style using shared utility
  const providerBadgeStyle = (provider: string): React.CSSProperties => {
    if (!provider || provider === 'Не указан') return {}
    const ps = getSharedProviderColor(provider)
    return { background: ps.bg, color: ps.color }
  }

  // Функция для определения цвета статуса
  const getStatusColor = (status: string) => {
    const statusLower = (status || '').toLowerCase()
    if (statusLower === 'success' || statusLower === 'completed' || statusLower === 'успешно') {
      return 'bg-green-500/20 text-green-400'
    } else if (statusLower === 'pending' || statusLower === 'в обработке' || statusLower === 'ожидание') {
      return 'bg-yellow-500/20 text-yellow-400'
    } else if (statusLower === 'failed' || statusLower === 'error' || statusLower === 'ошибка' || statusLower === 'отменен') {
      return 'bg-red-500/20 text-red-400'
    } else {
      return 'bg-overlay-sm text-muted'
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      // Можно добавить уведомление об успешном копировании
    } catch {
      // Игнорируем ошибки копирования
    }
  }

  const handleBalanceApply = async () => {
    if (!user || !balanceMode) return
    const amount = parseFloat(balanceAmount.replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Введите корректную сумму')
      return
    }
    setUpdatingBalance(true)
    setError(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) { setError('Нет активного профиля'); return }
      if (balanceMode === 'add') {
        await addUserBalance(config, tgId, amount)
      } else {
        await takeUserBalance(config, tgId, amount)
      }
      setBalanceMode(null)
      setBalanceAmount('')
      await loadUserData()
    } catch (err: any) {
      setError(err.message || 'Ошибка изменения баланса')
    } finally {
      setUpdatingBalance(false)
    }
  }

  const handleBalanceCancel = () => {
    setBalanceMode(null)
    setBalanceAmount('')
  }


  // Проверка наличия активного триала
  const hasActiveTrial = keys.some(key => {
    const keyName = (key.name || key.email || '').toLowerCase()
    const tariffName = (key.tariff_name || '').toLowerCase()
    return keyName.includes('trial') || keyName.includes('триал') || 
           tariffName.includes('trial') || tariffName.includes('триал') || 
           tariffName.includes('пробн')
  })

  // Определение статуса триала из данных пользователя
  const getTrialInfo = () => {
    if (user?.trial === undefined || user?.trial === null) {
      return null
    }
    if (user.trial === -1) {
      return { text: 'Триал использован', color: 'text-red-400', bg: 'bg-red-500/20' }
    } else if (user.trial === 0) {
      return { text: 'Триал доступен', color: 'text-green-400', bg: 'bg-green-500/20' }
    } else if (user.trial > 0 || hasActiveTrial) {
      return { text: 'Триал активен', color: 'text-sky-100', bg: 'bg-sky-500/10 border-sky-500/20' }
    }
    return null
  }

  const trialInfo = getTrialInfo()

  const performDeleteUser = async () => {
    if (deletingUser) return
    setDeletingUser(true)
    setError(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля')
        setDeletingUser(false)
        return
      }
      await deleteBotUser(config, tgId)
      setConfirmDeleteUser(false)
      onClose()
      try {
        onDeleted?.()
      } catch {
        // ignore
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка удаления пользователя')
      setConfirmDeleteUser(false)
      setDeletingUser(false)
    }
  }

  const getUserSourceCode = (u: any): string => {
    return String(u?.source_code ?? u?.sourceCode ?? u?.source ?? '').trim()
  }

  const classifySourceCode = (rawCode: string): { label: string; code?: string } => {
    const raw = String(rawCode || '').trim()
    if (!raw) return { label: 'Start (без метки)' }
    const lower = raw.toLowerCase()
    if (lower.startsWith('gift_')) return { label: 'Подарок', code: raw }
    if (lower.startsWith('ref_') || lower.startsWith('referral_')) return { label: 'Рефералка', code: raw }
    if (lower.startsWith('invite_') || lower.startsWith('inv_')) return { label: 'Приглашение', code: raw }
    return { label: 'UTM / источник', code: raw }
  }

  if (showKeyEditor) {
    return (
      <KeyEditModal
        tgId={tgId}
        editingKey={editingKey}
        tariffs={tariffs}
        onClose={() => {
          setShowKeyEditor(false)
          setEditingKey(null)
        }}
        onUpdated={() => {
          loadUserData()
        }}
        onSaved={handleKeySaved}
      />
    )
  }

  const renderPaginator = (page: number, count: number, perPage: number, setPage: (p: number) => void) => {
    if (count <= perPage) return null
    const totalPages = Math.ceil(count / perPage)
    return (
      <div className="ud-pager">
        <span className="ud-pager-info">{(page - 1) * perPage + 1}–{Math.min(page * perPage, count)} из {count}</span>
        <div className="ud-pager-btns">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="ud-pager-btn">‹</button>
          <span className="ud-pager-cur">{page} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="ud-pager-btn">›</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <ModalShell
        isOpen={true}
        title={user ? (user.username ? `@${user.username}` : `#${tgId}`) : 'Пользователь'}
        onClose={onClose}
        closeOnBackdropClick={false}
        closeOnEsc={false}
        closeButtonTone="danger"
        shellTone="neutral"
        size="lg"
        zIndexClassName="z-[100001]"
        icon={
          <svg className="w-5 h-5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        }
      >
        {loading ? (
          <div className="text-center py-8">
            <p className="text-dim text-sm">Загрузка...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : (
          <div className="ud-root">
            {/* Табы */}
            <div className="ud-tabs">
              <button type="button" onClick={() => setActiveTab('info')} className={`ud-tab${activeTab === 'info' ? ' active' : ''}`}>
                Информация
              </button>
              <button type="button" onClick={() => { setActiveTab('payments'); setPaymentsPage(1) }} className={`ud-tab${activeTab === 'payments' ? ' active' : ''}`}>
                Платежи {payments.length > 0 && <span className="ud-tab-count">{payments.length}</span>}
              </button>
              <button type="button" onClick={() => { setActiveTab('referrals'); setReferralsPage(1) }} className={`ud-tab${activeTab === 'referrals' ? ' active' : ''}`}>
                Рефералы {referrals.length > 0 && <span className="ud-tab-count">{referrals.length}</span>}
              </button>
              <button type="button" onClick={() => { setActiveTab('partner'); if (!partnerData && !partnerLoading) loadPartnerData() }} className={`ud-tab${activeTab === 'partner' ? ' active' : ''}`}>
                Партнёрка
              </button>
            </div>

            {/* === ВКЛ: ИНФОРМАЦИЯ === */}
            {activeTab === 'info' && user && (() => {
              const src = classifySourceCode(getUserSourceCode(user))
              return (
                <div className="ud-info">
                  {/* Единая карточка: данные + баланс */}
                  <div className="ud-card">
                    <div className="ud-card-header">
                      <span className="ud-card-title">Данные</span>
                      <DeleteButton variant="big" size="sm" disabled={deletingUser} onClick={() => setConfirmDeleteUser(true)} ariaLabel="Удалить пользователя" title="Удалить пользователя" label="Удалить пользователя" />
                    </div>
                    <div className="ud-rows">
                      <div className="ud-row">
                        <span className="ud-label">TG ID</span>
                        <span className="ud-val ud-val-row">
                          <span className="font-mono text-primary font-semibold">{String(user.tg_id || tgId)}</span>
                          <CopyText text={String(user.tg_id || tgId)} label={<span className="sr-only">Копировать</span>} toastMessage="TG ID скопирован" className="ud-copy-btn" />
                        </span>
                      </div>
                      {user.username && (
                        <div className="ud-row">
                          <span className="ud-label">Username</span>
                          <span className="ud-val font-medium text-sky-400">@{user.username}</span>
                        </div>
                      )}
                      <div className="ud-row">
                        <span className="ud-label">Регистрация</span>
                        <span className="ud-val">{formatDate(user.created_at)}</span>
                      </div>
                      <div className="ud-row">
                        <span className="ud-label">Источник</span>
                        <span className="ud-val ud-val-row ud-val-wrap">
                          <span className="ud-source-label">{src.label}</span>
                          {src.code ? <span className="ud-code">{src.code}</span> : null}
                        </span>
                      </div>
                      {trialInfo && (
                        <div className="ud-row">
                          <span className="ud-label">Триал</span>
                          <span className="ud-trial-badge" style={{ background: trialInfo.bg.startsWith('bg-') ? undefined : trialInfo.bg }} data-trial={trialInfo.text === 'Триал использован' ? 'used' : trialInfo.text === 'Триал доступен' ? 'available' : 'active'}>{trialInfo.text}</span>
                        </div>
                      )}
                      {/* Баланс встроен в карточку */}
                      <div className="ud-row ud-balance-row">
                        <span className="ud-label">Баланс</span>
                        <span className="ud-val ud-val-row">
                          {balanceMode ? (
                            <>
                              <span className="ud-bal-mode-label">{balanceMode === 'add' ? '+' : '−'}</span>
                              <input
                                type="number"
                                value={balanceAmount}
                                onChange={(e) => setBalanceAmount(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleBalanceApply(); if (e.key === 'Escape') handleBalanceCancel() }}
                                className="ud-balance-input-inline"
                                placeholder="0"
                                min="0"
                                step="0.01"
                                autoFocus
                              />
                              <button onClick={handleBalanceApply} disabled={updatingBalance} className="ud-bal-save" title="Применить">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              </button>
                              <button onClick={handleBalanceCancel} disabled={updatingBalance} className="ud-bal-cancel" title="Отмена">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </>
                          ) : (
                            <>
                              <span className={`ud-balance-inline${user.balance < 0 ? ' ud-balance-negative' : ''}`}>{formatCurrency(user.balance)}</span>
                              <button onClick={() => setBalanceMode('add')} className="ud-icon-btn ud-icon-btn-add" title="Пополнить">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                              </button>
                              <button onClick={() => setBalanceMode('take')} className="ud-icon-btn ud-icon-btn-take" title="Списать">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Подписки */}
                  <div className="ud-keys-section">
                    <div className="ud-keys-header">
                      <span className="ud-card-title">Подписки <span className="ud-count-muted">{keys.length}</span></span>
                      <button onClick={handleCreateKey} className="ud-btn-create">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Создать
                      </button>
                    </div>

                    {keys.length === 0 ? (
                      <p className="ud-empty">Нет подписок</p>
                    ) : (
                      <div className="ud-keys-list">
                        {keys.map((key, index) => {
                          const daysLeft = getDaysLeft(key.expiry_time)
                          const status = getKeyStatus(key)
                          const subscriptionUrl = key.remnawave_link || key.remnawaveLink || key.subscribe_url || key.config_url
                          const tariffText = String(key.tariff_name || key.tariff_id || key.tariffId || '').trim()
                          const serverText = String(key.server_name || key.cluster_name || key.server_id || key.cluster_id || '').trim()

                          return (
                            <div key={index} className="ud-key-card">
                              <div className="ud-key-top">
                                <div className="ud-key-left">
                                  <span className={`ud-key-status ${status.class}`}>{status.text}</span>
                                  <span className="ud-key-name">{key.name || key.email || `#${index + 1}`}</span>
                                </div>
                                <div className="ud-key-actions">
                                  <EditButton size="sm" onClick={() => handleEditKey(key)} ariaLabel="Редактировать" title="Редактировать" />
                                  {keyToDelete && (keyToDelete.client_id || keyToDelete.clientId || keyToDelete.id) === (key.client_id || key.clientId || key.id) ? (
                                    <>
                                      <button type="button" onClick={() => setKeyToDelete(null)} className="ud-key-cancel">Отмена</button>
                                      <button type="button" onClick={() => void confirmDelete()} className="ud-key-confirm-del">Удалить</button>
                                    </>
                                  ) : (
                                    <DeleteButton size="sm" onClick={() => handleDeleteKey(key)} ariaLabel="Удалить" title="Удалить" variant="big" />
                                  )}
                                </div>
                              </div>
                              {(tariffText || serverText || daysLeft) && (
                                <div className="ud-key-meta">
                                  {tariffText && <span className="ud-key-meta-item"><span className="ud-key-meta-label">Тариф</span>{tariffText}</span>}
                                  {serverText && <span className="ud-key-meta-item"><span className="ud-key-meta-label">Сервер</span>{serverText}</span>}
                                  {daysLeft && <span className="ud-key-meta-item"><span className="ud-key-meta-label">Осталось</span>{daysLeft} дн.</span>}
                                </div>
                              )}
                              {subscriptionUrl && /^https?:\/\//i.test(subscriptionUrl) && (
                                <div className="ud-key-link-row">
                                  <span className="ud-key-link-label">Ссылка</span>
                                  <div className="ud-key-link-box">
                                    <a href={subscriptionUrl} target="_blank" rel="noopener noreferrer" className="ud-key-link" title={subscriptionUrl}>
                                      {subscriptionUrl}
                                    </a>
                                    <button onClick={(e) => { e.stopPropagation(); copyToClipboard(subscriptionUrl) }} className="ud-icon-btn" title="Копировать">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* === ВКЛ: ПЛАТЕЖИ === */}
            {activeTab === 'payments' && (
              <div className="ud-tab-content">
                {payments.length === 0 ? (
                  <p className="ud-empty">Нет платежей</p>
                ) : (() => {
                  const adminOps = sortedPayments.filter(p => (p.payment_system || p.provider || p.payment_provider) === 'admin')
                  const userOps = sortedPayments.filter(p => (p.payment_system || p.provider || p.payment_provider) !== 'admin')
                  const renderPaymentRow = (payment: any, index: number) => {
                    const provider = payment.payment_system || payment.provider || payment.payment_provider || 'Не указан'
                    const status = payment.status || 'pending'
                    const amount = payment.amount ?? 0
                    const amountColor = amount >= 0 ? 'text-emerald-400' : 'text-red-400'
                    return (
                      <tr key={payment.id || index}>
                        <td className="font-mono text-xs text-muted">{payment.id || '-'}</td>
                        <td className={`font-semibold ${amountColor}`}>{amount >= 0 ? '+' : ''}{formatCurrency(amount)}</td>
                        <td><span className="ud-provider-badge" style={providerBadgeStyle(provider)}>{provider}</span></td>
                        <td><span className={`ud-status-badge ${getStatusColor(status)}`}>{status}</span></td>
                        <td className="text-muted text-xs">{formatDatePayment(payment.created_at)}</td>
                      </tr>
                    )
                  }
                  return (
                    <>
                      {/* Операции админа */}
                      {adminOps.length > 0 && (
                        <div className="mb-4">
                          <div className="ud-section-label">📊 Операции админа ({adminOps.length})</div>
                          <div className="ud-table-wrap">
                            <table className="ud-table">
                              <colgroup>
                                <col style={{ width: '12%' }} />
                                <col style={{ width: '18%' }} />
                                <col style={{ width: '18%' }} />
                                <col style={{ width: '18%' }} />
                                <col style={{ width: '34%' }} />
                              </colgroup>
                              <thead><tr><th>ID</th><th>Сумма</th><th>Система</th><th>Статус</th><th>Дата</th></tr></thead>
                              <tbody>{adminOps.map((p, i) => renderPaymentRow(p, i))}</tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      {/* Остальные платежи */}
                      {userOps.length > 0 && (
                        <div>
                          <div className="ud-section-label">💸 Платежи пользователя ({userOps.length})</div>
                          {renderPaginator(paymentsPage, userOps.length, paymentsPerPage, setPaymentsPage)}
                          <div className="ud-table-wrap">
                            <table className="ud-table">
                              <colgroup>
                                <col style={{ width: '12%' }} />
                                <col style={{ width: '14%' }} />
                                <col style={{ width: '22%' }} />
                                <col style={{ width: '18%' }} />
                                <col style={{ width: '34%' }} />
                              </colgroup>
                              <thead><tr><th>ID</th><th>Сумма</th><th>Провайдер</th><th>Статус</th><th>Дата</th></tr></thead>
                              <tbody>
                                {userOps.slice((paymentsPage - 1) * paymentsPerPage, paymentsPage * paymentsPerPage).map((p, i) => renderPaymentRow(p, i))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {/* === ВКЛ: ПАРТНЁРКА === */}
            {activeTab === 'partner' && (
              <div className="ud-tab-content">
                {partnerLoading && <p className="ud-empty">Загрузка...</p>}
                {partnerError && <p className="text-red-400 text-sm py-2">{partnerError}</p>}
                {!partnerLoading && partnerData && (partnerData.no_module ? (
                  <p className="ud-empty">Модуль партнёрской программы не установлен</p>
                ) : (
                  <div className="space-y-3">
                    {/* Основная карточка */}
                    <div className="ud-card">
                      <div className="ud-card-header">
                        <span className="ud-card-title">🤝 Партнёрская программа</span>
                        <button
                          onClick={() => void handlePartnerReset()}
                          disabled={partnerSaving}
                          className="ud-btn-danger-sm"
                        >Сбросить к дефолту</button>
                      </div>
                      <div className="ud-rows">
                        {partnerData.who_invited && (
                          <div className="ud-row">
                            <span className="ud-label">🤝 Кто пригласил</span>
                            <CopyText text={String(partnerData.who_invited)} toastMessage="ID скопирован" className="ud-copy-btn font-mono text-sky-400 text-sm" label={<span className="font-mono text-sky-400">{partnerData.who_invited}</span>} />
                          </div>
                        )}
                        <div className="ud-row">
                          <span className="ud-label">💰 Баланс</span>
                          <span className="ud-val font-mono text-emerald-400 font-semibold">{partnerData.partner_balance.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽</span>
                        </div>
                        <div className="ud-row">
                          <span className="ud-label">👥 Привлёк</span>
                          <span className="ud-val font-mono font-semibold text-primary">{partnerData.referred_count}</span>
                        </div>
                        {/* Процент */}
                        <div className="ud-row ud-balance-row">
                          <span className="ud-label">📊 Процент</span>
                          <span className="ud-val ud-val-row">
                            {editPercent ? (
                              <>
                                <input
                                  type="number" value={percentInput}
                                  onChange={e => setPercentInput(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') void handlePartnerSavePercent(); if (e.key === 'Escape') { setEditPercent(false); setPercentInput('') } }}
                                  className="ud-balance-input-inline" placeholder={String(partnerData.percent)} min="0" max="100" step="0.01" autoFocus
                                />
                                <span className="text-muted text-sm">%</span>
                                <button onClick={() => void handlePartnerSavePercent()} disabled={partnerSaving} className="ud-bal-save" title="Сохранить">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                </button>
                                <button onClick={() => { setEditPercent(false); setPercentInput('') }} disabled={partnerSaving} className="ud-bal-cancel" title="Отмена">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="font-mono font-semibold text-primary">{partnerData.percent}%</span>
                                {partnerData.percent_custom && <span className="text-xs text-yellow-400 ml-1">(кастом)</span>}
                                <button onClick={() => { setEditPercent(true); setPercentInput(String(partnerData.percent)) }} className="ud-icon-btn ud-icon-btn-add" title="Изменить %">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                        {/* Реферальный код/ссылка */}
                        <div className="ud-row ud-balance-row">
                          <span className="ud-label">🔗 Код ссылки</span>
                          <span className="ud-val ud-val-row">
                            {editCode ? (
                              <>
                                <input
                                  type="text" value={codeInput}
                                  onChange={e => setCodeInput(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') void handlePartnerSaveCode(); if (e.key === 'Escape') { setEditCode(false); setCodeInput('') } }}
                                  className="ud-balance-input-inline" placeholder="Оставьте пустым для сброса" autoFocus
                                />
                                <button onClick={() => void handlePartnerSaveCode()} disabled={partnerSaving} className="ud-bal-save" title="Сохранить">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                </button>
                                <button onClick={() => { setEditCode(false); setCodeInput('') }} disabled={partnerSaving} className="ud-bal-cancel" title="Отмена">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="font-mono text-sm text-primary">{partnerData.partner_code ?? '—'}</span>
                                <button onClick={() => { setEditCode(true); setCodeInput(partnerData.partner_code ?? '') }} className="ud-icon-btn ud-icon-btn-add" title="Изменить код">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                        {partnerData.referral_link && (
                          <div className="ud-row">
                            <span className="ud-label">🔗 Ссылка</span>
                            <span className="ud-val ud-val-row" style={{ minWidth: 0 }}>
                              <span className="font-mono text-xs text-sky-400 break-all">{partnerData.referral_link}</span>
                              <CopyText text={partnerData.referral_link} toastMessage="Ссылка скопирована" label={<span className="sr-only">Копировать</span>} className="ud-copy-btn" />
                            </span>
                          </div>
                        )}
                        {partnerData.payout_method && (
                          <div className="ud-row">
                            <span className="ud-label">💳 Способ вывода</span>
                            <span className="ud-val text-sm text-primary">{partnerData.payout_method_label || partnerData.payout_method}{partnerData.requisites_masked ? ` · ${partnerData.requisites_masked}` : ''}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Управление */}
                    <div className="ud-card">
                      <div className="ud-card-header"><span className="ud-card-title">⚙️ Управление</span></div>
                      <div className="ud-rows">
                        {/* Партнёрский баланс */}
                        <div className="ud-row ud-balance-row">
                          <span className="ud-label">💰 Партнёрский баланс</span>
                          <span className="ud-val ud-val-row">
                            {partnerBalanceMode ? (
                              <>
                                <span className="ud-bal-mode-label">{partnerBalanceMode === 'add' ? '+' : '−'}</span>
                                <input
                                  type="number" value={partnerBalanceInput}
                                  onChange={e => setPartnerBalanceInput(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') void handlePartnerBalanceApply(); if (e.key === 'Escape') { setPartnerBalanceMode(null); setPartnerBalanceInput('') } }}
                                  className="ud-balance-input-inline" placeholder="0" min="0" step="0.01" autoFocus
                                />
                                <button onClick={() => void handlePartnerBalanceApply()} disabled={partnerSaving} className="ud-bal-save" title="Применить">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                </button>
                                <button onClick={() => { setPartnerBalanceMode(null); setPartnerBalanceInput('') }} disabled={partnerSaving} className="ud-bal-cancel" title="Отмена">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="font-mono text-emerald-400 font-semibold">{partnerData.partner_balance.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽</span>
                                <button onClick={() => setPartnerBalanceMode('add')} className="ud-icon-btn ud-icon-btn-add" title="Начислить">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                </button>
                                <button onClick={() => setPartnerBalanceMode('subtract')} className="ud-icon-btn ud-icon-btn-take" title="Списать">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                        {/* Добавить реферала */}
                        <div className="ud-row ud-balance-row">
                          <span className="ud-label">👥 Добавить реферала</span>
                          <span className="ud-val ud-val-row">
                            {addReferralMode ? (
                              <>
                                <input
                                  type="number" value={addReferralInput}
                                  onChange={e => setAddReferralInput(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') void handleAddReferral(); if (e.key === 'Escape') { setAddReferralMode(false); setAddReferralInput('') } }}
                                  className="ud-balance-input-inline" placeholder="TG ID" min="1" step="1" autoFocus
                                />
                                <button onClick={() => void handleAddReferral()} disabled={partnerSaving} className="ud-bal-save" title="Добавить">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                </button>
                                <button onClick={() => { setAddReferralMode(false); setAddReferralInput('') }} disabled={partnerSaving} className="ud-bal-cancel" title="Отмена">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </>
                            ) : (
                              <button onClick={() => setAddReferralMode(true)} className="ud-icon-btn ud-icon-btn-add" title="Добавить реферала">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                              </button>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Статистика выплат */}
                    <div className="ud-card">
                      <div className="ud-card-header"><span className="ud-card-title">💸 Статистика выводов</span></div>
                      <div className="ud-rows">
                        <div className="ud-row"><span className="ud-label">Сегодня</span><span className="ud-val font-mono text-[var(--accent)]">{partnerData.paid_today.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽</span></div>
                        <div className="ud-row"><span className="ud-label">За месяц</span><span className="ud-val font-mono text-emerald-400">{partnerData.paid_month.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽</span></div>
                        <div className="ud-row"><span className="ud-label">Всего выплачено</span><span className="ud-val font-mono text-emerald-400">{partnerData.paid_total.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽</span></div>
                        {partnerData.pending_count > 0 && (
                          <div className="ud-row"><span className="ud-label">⏳ Ожидают вывода</span><span className="ud-val font-mono text-yellow-400">{partnerData.pending_count} ({partnerData.pending_amount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽)</span></div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* === ВКЛ: РЕФЕРАЛЫ === */}
            {activeTab === 'referrals' && (
              <div className="ud-tab-content">
                {referralsStats && (
                  <div className="ud-ref-stats">
                    {referralsStats.total_referrals !== undefined && (
                      <div className="ud-stat-card"><span className="ud-stat-label">Всего</span><span className="ud-stat-val">{referralsStats.total_referrals}</span></div>
                    )}
                    {referralsStats.active_referrals !== undefined && (
                      <div className="ud-stat-card"><span className="ud-stat-label">Активных</span><span className="ud-stat-val text-emerald-400">{referralsStats.active_referrals}</span></div>
                    )}
                    {referralsStats.total_rewards !== undefined && (
                      <div className="ud-stat-card"><span className="ud-stat-label">Наград</span><span className="ud-stat-val text-yellow-400">{referralsStats.total_rewards}</span></div>
                    )}
                    {referralsStats.total_earnings !== undefined && (
                      <div className="ud-stat-card"><span className="ud-stat-label">Заработано</span><span className="ud-stat-val">{referralsStats.total_earnings}</span></div>
                    )}
                  </div>
                )}
                {referrals.length === 0 ? (
                  <p className="ud-empty">Нет рефералов</p>
                ) : (
                  <>
                    {renderPaginator(referralsPage, sortedReferrals.length, referralsPerPage, setReferralsPage)}
                    <div className="ud-table-wrap">
                      <table className="ud-table">
                        <colgroup>
                          <col style={{ width: '70%' }} />
                          <col style={{ width: '30%' }} />
                        </colgroup>
                        <thead><tr><th>TG ID реферала</th><th>Действия</th></tr></thead>
                        <tbody>
                          {paginatedReferrals.map((referral, index) => {
                            const referredId = referral.referred_tg_id || referral.referred_id || referral.tg_id || referral.id
                            return (
                              <tr key={referral.id || referredId || index}>
                                <td className="font-mono text-primary">{referredId || '-'}</td>
                                <td>
                                  <button
                                    onClick={() => setReferralToDelete({ referrerId: tgId, referredId })}
                                    disabled={deletingReferrals}
                                    className="ud-ref-del-btn"
                                  >Удалить</button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="ud-mobile-cards">
                      {paginatedReferrals.map((referral, idx) => {
                        const referredId = referral.referred_tg_id || referral.referred_id || referral.tg_id || referral.id
                        return (
                          <div key={referral.id || referredId || `ref-${idx}`} className="ud-mobile-card">
                            <div className="ud-mobile-card-top">
                              <div><div className="text-muted text-[11px]">TG ID</div><div className="font-mono text-primary text-sm font-semibold">{referredId || '-'}</div></div>
                              <button
                                onClick={() => setReferralToDelete({ referrerId: tgId, referredId })}
                                disabled={deletingReferrals}
                                className="ud-ref-del-btn"
                              >Удалить</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </ModalShell>

      {confirmDeleteUser && (
        <ConfirmModal
          isOpen={true}
          title="Удалить пользователя?"
          message={`Пользователь ${tgId} будет удалён из БД бота вместе с его ключами/платежами/рефералами. Действие необратимо.`}
          onConfirm={() => void performDeleteUser()}
          onCancel={() => setConfirmDeleteUser(false)}
          confirmText={deletingUser ? 'Удаление...' : 'Удалить'}
          cancelText="Отмена"
          zIndexClassName="z-[100002]"
        />
      )}

      {referralToDelete && (
        <ConfirmModal
          isOpen={true}
          title="Удалить реферала?"
          message={`Реферал ${referralToDelete.referredId} будет удалён.`}
          onConfirm={async () => {
            setDeletingReferrals(true)
            try {
              const config = await getBotConfigAsync()
              if (config) {
                await deleteBotReferral(config, referralToDelete.referrerId, referralToDelete.referredId)
                await loadUserData()
              }
            } catch (err: any) {
              setError(err.message || 'Ошибка удаления')
            } finally {
              setDeletingReferrals(false)
              setReferralToDelete(null)
            }
          }}
          onCancel={() => setReferralToDelete(null)}
          confirmText={deletingReferrals ? 'Удаление...' : 'Удалить'}
          cancelText="Отмена"
          zIndexClassName="z-[100002]"
        />
      )}
    </>
  )
}
