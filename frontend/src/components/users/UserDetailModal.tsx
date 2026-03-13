import { useEffect, useState } from 'react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { getBotUser, getBotKeysByTgId, getBotPaymentsByTgId, getBotTariffs, getBotReferralsAll, deleteBotReferral, deleteBotKey, deleteBotKeyByEmail, addUserBalance, takeUserBalance, deleteBotUser } from '../../api/botApi'
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
  const [activeTab, setActiveTab] = useState<'info' | 'payments' | 'referrals'>('info')
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
  const sortedPayments = [...payments].sort((a, b) => {
    const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
    const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
    return dateB - dateA // Обратный порядок - новые сначала
  })

  // Сортируем рефералов по дате (последние сначала)
  const sortedReferrals = [...referrals].sort((a, b) => {
    const dateA = a.created_at || a.date || a.referral_date ? new Date(a.created_at || a.date || a.referral_date).getTime() : 0
    const dateB = b.created_at || b.date || b.referral_date ? new Date(b.created_at || b.date || b.referral_date).getTime() : 0
    return dateB - dateA // Обратный порядок - новые сначала
  })

  const totalReferralsPages = Math.ceil(sortedReferrals.length / referralsPerPage)
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

  const renderPaginator = (page: number, _total: number, count: number, perPage: number, setPage: (p: number) => void) => {
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
                                  {keyToDelete === key ? (
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
                              {subscriptionUrl && (
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
                          {renderPaginator(paymentsPage, Math.ceil(userOps.length / paymentsPerPage), userOps.length, paymentsPerPage, setPaymentsPage)}
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
                    {renderPaginator(referralsPage, totalReferralsPages, sortedReferrals.length, referralsPerPage, setReferralsPage)}
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
                                    onClick={async () => {
                                      if (!confirm('Удалить реферала?')) return
                                      setDeletingReferrals(true)
                                      try {
                                        const config = await getBotConfigAsync()
                                        if (config) { await deleteBotReferral(config, tgId, referredId); await loadUserData() }
                                      } catch (err: any) { setError(err.message || 'Ошибка удаления') }
                                      finally { setDeletingReferrals(false) }
                                    }}
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
                      {paginatedReferrals.map((referral) => {
                        const referredId = referral.referred_tg_id || referral.referred_id || referral.tg_id || referral.id
                        return (
                          <div key={referral.id || referredId || Math.random()} className="ud-mobile-card">
                            <div className="ud-mobile-card-top">
                              <div><div className="text-muted text-[11px]">TG ID</div><div className="font-mono text-primary text-sm font-semibold">{referredId || '-'}</div></div>
                              <button
                                onClick={async () => {
                                  if (!confirm('Удалить реферала?')) return
                                  setDeletingReferrals(true)
                                  try {
                                    const config = await getBotConfigAsync()
                                    if (config) { await deleteBotReferral(config, tgId, referredId); await loadUserData() }
                                  } catch (err: any) { setError(err.message || 'Ошибка удаления') }
                                  finally { setDeletingReferrals(false) }
                                }}
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
    </>
  )
}
