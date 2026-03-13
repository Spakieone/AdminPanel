import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSessionFilters } from '../hooks/useSessionFilters'
// Layout теперь применяется на уровне роутера (LayoutRoute)
import { getBotConfigAsync } from '../utils/botConfig'
import { getPaymentProviders } from '../api/botApi'
import { getCachedPayments } from '../api/client'
import CapybaraLoader from '../components/common/CapybaraLoader'
import { GradientAlert } from '../components/common/GradientAlert'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import { formatMskDateTimeLocal } from '../utils/dateUtils'
import DarkSelect, { type DarkSelectGroup } from '../components/common/DarkSelect'
import CopyText from '../components/ui/CopyText'
import { getProviderColor } from '../utils/providerColor'

interface Payment {
  id?: number
  payment_id?: number
  tg_id?: number
  amount?: number
  created_at?: string
  status?: string
  provider?: string
  payment_system?: string
  payment_provider?: string
  [key: string]: any
}

export default function Payments() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const [pFilters, setPFilter] = useSessionFilters('payments-filters', {
    searchTerm: '',
    pageSize: 25,
    statusFilter: 'all',
    providerFilter: 'all',
  })
  const searchTerm = pFilters.searchTerm
  const setSearchTerm = (v: string) => { setPFilter('searchTerm', v); setCurrentPage(1) }
  const pageSize = pFilters.pageSize as number
  const setPageSize = (v: number) => { setPFilter('pageSize', v); setCurrentPage(1) }
  const statusFilter = pFilters.statusFilter
  const setStatusFilter = (v: string) => { setPFilter('statusFilter', v); setCurrentPage(1) }
  const providerFilter = pFilters.providerFilter
  const setProviderFilter = (v: string) => { setPFilter('providerFilter', v); setCurrentPage(1) }
  const [remoteTotal, setRemoteTotal] = useState(0)
  const [remoteTotalPages, setRemoteTotalPages] = useState(1)
  const [allProviders, setAllProviders] = useState<string[]>([])
  const missingProfile = Boolean(error && error.includes('Нет активного профиля'))

  // Load providers list once
  useEffect(() => {
    const loadProviders = async () => {
      try {
        const config = await getBotConfigAsync()
        if (config) {
          const providers = await getPaymentProviders(config)
          setAllProviders(providers)
        }
      } catch {
        // ignore - will fallback to current page providers
      }
    }
    loadProviders()
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 400)
    return () => window.clearTimeout(t)
  }, [searchTerm])

  useEffect(() => {
    // reset pagination when filters change
    setCurrentPage(1)
  }, [searchTerm, statusFilter, providerFilter, pageSize])

  const loadPayments = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setLoading(false)
        return
      }

      // Серверная пагинация (быстро на больших БД)
      const response = await getCachedPayments({
        page: currentPage,
        per_page: pageSize,
        search: debouncedSearchTerm || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter as any,
        provider: providerFilter === 'all' ? undefined : providerFilter,
      })

      const paymentsList: Payment[] = Array.isArray(response.items) ? response.items : []
      setPayments(paymentsList)
      setRemoteTotal(Number((response as any)?.total || 0))
      setRemoteTotalPages(Number((response as any)?.total_pages || 1))
    } catch (err: any) {
      // IMPORTANT: do NOT fallback to full-list loading on large DBs.
      setPayments([])
      setError(err.message || 'Ошибка загрузки платежей (проверь работу Bot API модуля и серверную пагинацию)')
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, debouncedSearchTerm, statusFilter, providerFilter])

  useEffect(() => {
    loadPayments()
  }, [loadPayments])

  // Получение провайдера из разных возможных полей
  const getPaymentProvider = (payment: Payment) => {
    return payment.payment_system || payment.provider || payment.payment_provider || 'Не указан'
  }


  // Данные уже отфильтрованы и отпагинированы на сервере
  const filteredPayments = useMemo(() => payments, [payments])

  // Пагинация
  const totalPages = remoteTotalPages
  const paginatedPayments = filteredPayments

  // Уникальные статусы и провайдеры для фильтров
  const uniqueStatuses = useMemo(() => {
    const statuses = new Set<string>()
    payments.forEach(p => {
      if (p.status) statuses.add(p.status.toLowerCase())
    })
    return Array.from(statuses).sort()
  }, [payments])

  const uniqueProviders = useMemo(() => {
    // Prefer pre-loaded providers from API
    if (allProviders.length > 0) {
      return allProviders
    }
    // Fallback to current page providers
    const providers = new Set<string>()
    payments.forEach(p => {
      const provider = getPaymentProvider(p)
      if (provider && provider !== 'Не указан') {
        providers.add(provider)
      }
    })
    return Array.from(providers).sort()
  }, [payments, allProviders])

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

  const statusGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [{ value: 'all', label: 'Все' }, ...uniqueStatuses.map((s) => ({ value: s, label: s }))],
      },
    ],
    [uniqueStatuses],
  )

  const providerGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [{ value: 'all', label: 'Все' }, ...uniqueProviders.map((p) => ({ value: p, label: p }))],
      },
    ],
    [uniqueProviders],
  )

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    return formatMskDateTimeLocal(dateString)
  }

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      {/* Page wrapper (фон страницы, без отдельной "панели" поверх) */}
      <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">
        {error && (
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
        )}

        {loading ? (
          <div className="glass-panel p-4 sm:p-6">
            <CapybaraLoader />
          </div>
        ) : (
          <>
            {/* Фильтры и поиск */}
            <div className="glass-panel p-3 sm:p-4 mb-3 sm:mb-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-muted mb-1.5 sm:mb-2">Поиск</label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="ID, TG ID..."
                    className="filter-field"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-muted mb-1.5 sm:mb-2">Статус</label>
                  <DarkSelect
                    value={statusFilter}
                    onChange={(v) => setStatusFilter(v)}
                    groups={statusGroups}
                    buttonClassName="filter-field"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-muted mb-1.5 sm:mb-2">Провайдер</label>
                  <DarkSelect
                    value={providerFilter}
                    onChange={(v) => setProviderFilter(v)}
                    groups={providerGroups}
                    buttonClassName="filter-field"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-muted mb-1.5 sm:mb-2">На странице</label>
                  <DarkSelect
                    value={String(pageSize)}
                    onChange={(v) => {
                      setPageSize(Number(v))
                      setCurrentPage(1)
                    }}
                    groups={pageSizeGroups}
                    buttonClassName="filter-field"
                  />
                </div>
              </div>
            </div>

            {/* Пагинация сверху */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mb-3 sm:mb-4">
                <div className="text-muted text-xs sm:text-sm">
                  Показано {remoteTotal === 0 ? 0 : ((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, remoteTotal)} из {remoteTotal}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-4 py-2.5 min-h-[44px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm border border-default bg-overlay-md text-primary hover:bg-overlay-md touch-manipulation active:opacity-70"
                    aria-label="Предыдущая страница"
                  >
                    Назад
                  </button>
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2.5 min-h-[44px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm border border-default bg-overlay-md text-primary hover:bg-overlay-md touch-manipulation active:opacity-70"
                    aria-label="Следующая страница"
                  >
                    Вперед
                  </button>
                </div>
              </div>
            )}

            {/* Таблица */}
            {filteredPayments.length === 0 ? (
              <div className="glass-table p-2">
                <p className="text-muted text-center py-6 sm:py-8 text-sm sm:text-base">Платежи не найдены</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>TG ID</th>
                      <th>Сумма</th>
                      <th>Провайдер</th>
                      <th>Статус</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedPayments.map((payment, index) => {
                      const provider = getPaymentProvider(payment)
                      const providerStyle = getProviderColor(provider)
                      const st = String(payment.status || 'pending').toLowerCase()
                      const statusBadge = st.includes('success') || st.includes('paid') ? 'completed' : st.includes('pending') ? 'pending' : st.includes('process') ? 'processing' : 'failed'
                      return (
                        <tr key={payment.id || payment.payment_id || index}>
                          <td>{payment.id || payment.payment_id || '—'}</td>
                          <td>
                            {payment.tg_id ? (
                              <CopyText
                                text={String(payment.tg_id)}
                                showToast={false}
                                className="inline-flex items-center gap-1 text-[12px] font-mono text-secondary hover:text-primary transition-colors"
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="table-amount">{Number(payment.amount || 0).toLocaleString('ru-RU')} ₽</td>
                          <td>
                            <span
                              className="status-badge"
                              style={{ background: providerStyle.bg, color: providerStyle.color, verticalAlign: 'middle' }}
                            >
                              {provider}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge ${statusBadge}`}>{payment.status || 'pending'}</span>
                          </td>
                          <td>{formatDate(payment.created_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Пагинация снизу */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mt-3 sm:mt-4">
                <div className="text-muted text-xs sm:text-sm">
                  Показано {remoteTotal === 0 ? 0 : ((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, remoteTotal)} из {remoteTotal}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-4 py-2.5 min-h-[44px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm border border-default bg-overlay-md text-primary hover:bg-overlay-md touch-manipulation active:opacity-70"
                  >
                    Назад
                  </button>
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2.5 min-h-[44px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm border border-default bg-overlay-md text-primary hover:bg-overlay-md touch-manipulation active:opacity-70"
                  >
                    Вперед
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* End page wrapper */}
    </>
  )
}
