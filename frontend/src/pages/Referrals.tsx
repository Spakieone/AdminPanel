import { useState, useEffect, useMemo } from 'react'
import { getBotConfigAsync } from '../utils/botConfig'
import { getBotReferralsPage, deleteBotReferral, getPartnerStats, getTopPartners, type PartnerStats, type Partner } from '../api/botApi'
import CapybaraLoader from '../components/common/CapybaraLoader'
import { GradientAlert } from '../components/common/GradientAlert'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import DeleteButton from '../components/ui/DeleteButton'
import DarkSelect, { type DarkSelectGroup } from '../components/common/DarkSelect'

interface Referral {
  referrer_tg_id?: number
  referred_tg_id?: number
  [key: string]: any
}

interface GroupedReferral {
  referrerId: number | string
  referrals: Referral[]
  count: number
}

export default function Referrals() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const missingProfile = Boolean(error && error.includes('Нет активного профиля'))
  const [searchTerm, setSearchTerm] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [remoteTotal, setRemoteTotal] = useState(0)
  const [remoteTotalPages, setRemoteTotalPages] = useState(1)
  const [expandedReferrers, setExpandedReferrers] = useState<Set<number | string>>(new Set())
  const [deletingReferrals, setDeletingReferrals] = useState<Set<string>>(new Set())

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

  // Партнёрская программа
  const [partnerStats, setPartnerStats] = useState<PartnerStats | null>(null)
  const [topPartners, setTopPartners] = useState<Partner[]>([])
  const [partnerLoading, setPartnerLoading] = useState(true)
  const [hasPartnerModule, setHasPartnerModule] = useState(false)

  useEffect(() => {
    loadReferrals()
    loadPartnerData()
  }, [currentPage, pageSize])

  const loadReferrals = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setLoading(false)
        return
      }

      // Server-side pagination via Bot API module
      const pageResp = await getBotReferralsPage(config, { page: currentPage, limit: pageSize })
      const referralsList = Array.isArray(pageResp.items) ? pageResp.items : []
      setReferrals(referralsList)
      setRemoteTotal(Number(pageResp.total || 0))
      setRemoteTotalPages(Number(pageResp.pages || 1))
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки рефералов')
    } finally {
      setLoading(false)
    }
  }

  const loadPartnerData = async () => {
    setPartnerLoading(true)
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setPartnerLoading(false)
        return
      }

      // Пробуем загрузить данные партнёрской программы
      const [stats, top] = await Promise.all([
        getPartnerStats(config),
        getTopPartners(config, 5)
      ])
      
      setPartnerStats(stats)
      setTopPartners(top)
      setHasPartnerModule(true)
    } catch (err: any) {
      // Если модуль партнёрской программы не установлен, просто скрываем секцию
      setHasPartnerModule(false)
    } finally {
      setPartnerLoading(false)
    }
  }

  // Группировка по рефереру
  const groupedReferrals = useMemo(() => {
    const grouped: Record<number | string, Referral[]> = {}
    
    referrals.forEach(ref => {
      const referrerId = ref.referrer_tg_id || 'unknown'
      if (!grouped[referrerId]) {
        grouped[referrerId] = []
      }
      grouped[referrerId].push(ref)
    })

    const result: GroupedReferral[] = Object.entries(grouped).map(([referrerId, refs]) => {
      const id = referrerId === 'unknown' ? 'unknown' : Number(referrerId)
      return {
        referrerId: id,
        referrals: refs,
        count: refs.length
      }
    })

    return result
  }, [referrals])

  // Фильтрация и поиск
  const filteredReferrals = useMemo(() => {
    return groupedReferrals.filter(group => {
      if (!searchTerm) return true
      
      const searchLower = searchTerm.toLowerCase()
      const referrerIdStr = String(group.referrerId)
      const hasReferrerMatch = referrerIdStr.includes(searchLower)
      
      const hasReferralMatch = group.referrals.some(ref => 
        String(ref.referred_tg_id || '').includes(searchLower)
      )
      
      return hasReferrerMatch || hasReferralMatch
    })
  }, [groupedReferrals, searchTerm])

  // Сортировка по количеству (по убыванию) — только в рамках текущей страницы
  const sortedReferrals = useMemo(() => {
    const sorted = [...filteredReferrals]
    sorted.sort((a, b) => b.count - a.count)
    return sorted
  }, [filteredReferrals])

  // Статистика
  const stats = useMemo(() => {
    const total = remoteTotal || referrals.length
    const uniqueReferrers = new Set(referrals.map(r => r.referrer_tg_id).filter((id): id is number => Boolean(id)))
    
    return {
      total,
      uniqueReferrers: uniqueReferrers.size
    }
  }, [referrals, remoteTotal])

  // Пагинация выполняется на сервере, тут отображаем текущую страницу
  const totalPages = remoteTotalPages
  const paginatedReferrals = sortedReferrals

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleReferrer = (referrerId: number | string) => {
    const newExpanded = new Set(expandedReferrers)
    if (newExpanded.has(referrerId)) {
      newExpanded.delete(referrerId)
    } else {
      newExpanded.add(referrerId)
    }
    setExpandedReferrers(newExpanded)
  }

  const handleDeleteReferral = async (referrerId: number, referredId: number) => {
    if (!confirm('Удалить этого реферала?')) return

    const key = `${referrerId}-${referredId}`
    setDeletingReferrals(prev => new Set(prev).add(key))

    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        return
      }

      await deleteBotReferral(config, referrerId, referredId)
      await loadReferrals()
    } catch (err: any) {
      setError(err.message || 'Ошибка удаления реферала')
    } finally {
      setDeletingReferrals(prev => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
    }
  }

  const getReferralWord = (count: number) => {
    if (count === 1) return 'реферал'
    if (count >= 2 && count <= 4) return 'реферала'
    return 'рефералов'
  }

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, pageSize])

  return (
    <>
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

        {/* Партнёрская программа */}
        {hasPartnerModule && !partnerLoading && partnerStats && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
              <span>🤝</span> Партнёрская программа
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="glass-panel p-4">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-secondary">👥 Партнёров с рефералами</span>
                    <span className="text-primary font-semibold">
                      {partnerStats.total_partners.toLocaleString('ru-RU')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-secondary">👥 Всего привлечено</span>
                    <span className="text-primary font-semibold">
                      {partnerStats.total_referred.toLocaleString('ru-RU')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pb-2 border-b border-default">
                    <span className="text-secondary">💼 Суммарный партнёрский баланс</span>
                    <span className="text-green-400 font-semibold">
                      {partnerStats.total_balance.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-secondary">⏳ Выводов в ожидании</span>
                    <span className="text-primary font-semibold">
                      {partnerStats.pending_withdrawals_count.toLocaleString('ru-RU')} на {partnerStats.pending_withdrawals_amount.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-secondary">💸 Выплачено сегодня</span>
                    <span className="text-primary font-semibold">
                      {partnerStats.paid_today_amount.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-secondary">📆 Выплачено за месяц</span>
                    <span className="text-primary font-semibold">
                      {partnerStats.paid_month_amount.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽
                    </span>
                  </div>
                </div>
              </div>

              <div className="glass-panel p-4">
                <div className="text-base sm:text-lg font-semibold text-primary mb-3">🏅 ТОП-5 партнёров по приглашениям</div>
                {topPartners.length > 0 ? (
                  <div className="space-y-2 text-base">
                    {topPartners.map((partner, idx) => (
                      <div key={partner.tg_id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={idx === 0 ? 'text-yellow-400 font-bold' : idx === 1 ? 'text-dim' : idx === 2 ? 'text-amber-600' : 'text-muted'}>
                            {idx + 1}.
                          </span>
                          <span className="text-primary font-mono">{partner.tg_id}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-green-400 font-semibold">
                            {partner.balance.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₽
                          </span>
                          <span className="text-secondary">👥 {partner.referred_count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted text-sm">Нет данных</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Рефералы */}
        <h2 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
          <span>👥</span> Рефералы
        </h2>

        {loading ? (
          <div className="glass-panel p-4 sm:p-6">
            <CapybaraLoader />
          </div>
        ) : (
          <>
            {/* Статистика */}
            <div className="grid grid-cols-2 md:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
              <div className="glass-panel p-3 sm:p-4">
                <div className="text-xs sm:text-sm text-muted mb-1">Всего рефералов</div>
                <div className="text-xl sm:text-2xl font-bold text-primary">{stats.total.toLocaleString('ru-RU')}</div>
              </div>
              <div className="glass-panel p-3 sm:p-4">
                <div className="text-xs sm:text-sm text-muted mb-1">Рефереров</div>
                <div className="text-xl sm:text-2xl font-bold text-primary">{stats.uniqueReferrers.toLocaleString('ru-RU')}</div>
              </div>
            </div>

            {/* Фильтры и поиск */}
            <div className="glass-panel p-3 sm:p-4 mb-3 sm:mb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-muted mb-1.5 sm:mb-2">Поиск</label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="ID реферера, реферала..."
                    className="filter-field"
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
                    Показано {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, sortedReferrals.length)} из {sortedReferrals.length}
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

            {/* Список рефералов */}
            {sortedReferrals.length === 0 ? (
              <div className="glass-table p-2">
                <p className="text-muted text-center py-6 sm:py-8 text-sm sm:text-base">Рефералы не найдены</p>
              </div>
            ) : (
              <div className="space-y-4">
                {paginatedReferrals.map((group) => {
                  const isExpanded = expandedReferrers.has(group.referrerId)
                  
                  return (
                    <div
                      key={group.referrerId}
                      className="glass-panel rounded-lg border border-default hover:border-strong hover:shadow-lg transition-smooth overflow-hidden"
                    >
                      <div 
                        className="w-full p-3 sm:p-6 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 sm:gap-0 hover:bg-overlay-sm transition-colors cursor-pointer"
                        onClick={() => toggleReferrer(group.referrerId)}
                      >
                        <div className="flex items-center gap-4 flex-1">
                            <h3 className="text-lg font-bold text-primary">Реферер: {group.referrerId}</h3>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-sm font-medium">
                            {group.count} {getReferralWord(group.count)}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleReferrer(group.referrerId)
                            }}
                            className="p-1"
                          >
                            <svg
                              className={`w-5 h-5 text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-6 pb-6">
                          {/* Список рефералов */}
                          <div className="space-y-2 mt-4">
                            {group.referrals.map((ref) => {
                              const referrerId = group.referrerId
                              const referredId = ref.referred_tg_id || 0
                              const key = `${referrerId}-${referredId}`
                              const isDeleting = deletingReferrals.has(key)
                              
                              return (
                                <div 
                                  key={key} 
                                  className="flex justify-between items-center text-sm bg-overlay-sm rounded-lg px-3 py-2 hover:bg-overlay-md transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="text-dim font-medium">Реферал: {referredId || '-'}</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <DeleteButton
                                      size="sm"
                                      disabled={isDeleting}
                                      label={isDeleting ? 'Удаление...' : 'Удалить'}
                                      ariaLabel="Удалить реферала"
                                      title="Удалить"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (typeof referrerId === 'number') {
                                          handleDeleteReferral(referrerId, referredId)
                                        }
                                      }}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Пагинация снизу */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mt-4">
                <div className="text-muted text-xs sm:text-sm">
                  Показано {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, sortedReferrals.length)} из {sortedReferrals.length}
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
    </>
  )
}
