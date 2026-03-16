import React, { useState, useEffect, useMemo, useCallback } from 'react'
// Layout теперь применяется на уровне роутера (LayoutRoute)
import { getBotConfigAsync } from '../utils/botConfig'
import {
  getBotCouponsPage,
  getBotGiftsPage,
  deleteBotCoupon,
  deleteBotGift,
  getBotTariffs,
  getBotUtmTags,
  deleteBotUtmTag,
} from '../api/botApi'
import CouponEditModal from '../components/coupons/CouponEditModal'
import GiftEditModal from '../components/gifts/GiftEditModal'
import ConfirmModal from '../components/common/ConfirmModal'
import GlassTabs from '../components/common/GlassTabs'
import { GradientAlert } from '../components/common/GradientAlert'
import CapybaraLoader from '../components/common/CapybaraLoader'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import { formatMskDateTimeShort } from '../utils/dateUtils'
import UtmStatsModal from '../components/utm/UtmStatsModal'
import DeleteButton from '../components/ui/DeleteButton'
import EditButton from '../components/ui/EditButton'
import { useToastContext } from '../contexts/ToastContext'
import DarkSelect, { type DarkSelectGroup } from '../components/common/DarkSelect'

// UTM аналитика вынесена в отдельную модалку (см. UtmStatsModal)

interface Coupon {
  id?: number | string
  coupon_id?: number
  code?: string
  discount?: number
  discount_type?: string
  discount_percent?: number
  discount_amount?: number
  amount?: number
  balance?: number
  bonus?: number
  balance_amount?: number
  price?: number
  days?: number
  duration_days?: number
  duration?: number
  percent?: number
  max_discount_amount?: number
  min_order_amount?: number
  new_users_only?: boolean
  max_uses?: number
  used_count?: number
  uses_count?: number
  usage_count?: number
  usage_limit?: number
  valid_from?: string
  valid_until?: string
  expires_at?: string
  is_active?: boolean
  active?: boolean
  enabled?: boolean
  created_at?: string
  created?: string
  [key: string]: any
}

interface Gift {
  id?: number | string
  gift_id?: string
  sender_tg_id?: number
  recipient_tg_id?: number | null
  tariff_id?: number
  tariff_name?: string
  tariff?: string
  created_at?: string
  expiry_time?: string
  is_used?: boolean
  is_unlimited?: boolean
  max_usages?: number
  used_count?: number
  uses_count?: number
  [key: string]: any
}

interface UtmTag {
  id?: number
  name?: string
  code?: string
  type?: string
  created_by?: number
  created_at?: string
  registrations?: number
  trials?: number
  payments?: number
  total_amount?: number
  monthly?: Array<{
    month: string
    registrations: number
    trials: number
    new_purchases_count: number
    new_purchases_amount: number
    repeat_purchases_count: number
    repeat_purchases_amount: number
  }>
  [key: string]: any
}

export type CouponsViewMode = 'coupons' | 'gifts' | 'utm'

export default function Coupons({
  initialViewMode = 'coupons',
  showTabs = true,
}: {
  initialViewMode?: CouponsViewMode
  showTabs?: boolean
}) {
  const toast = useToastContext()
  const [viewMode, setViewMode] = useState<CouponsViewMode>(initialViewMode)
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [gifts, setGifts] = useState<Gift[]>([])
  const [utmTags, setUtmTags] = useState<UtmTag[]>([])
  const [utmLoadedAt, setUtmLoadedAt] = useState<number | null>(null)
  const [tariffs, setTariffs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const missingProfile = Boolean(error && error.includes('Нет активного профиля'))
  const [searchTerm, setSearchTerm] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [remoteTotal, setRemoteTotal] = useState(0)
  const [remoteTotalPages, setRemoteTotalPages] = useState(1)
  const [giftsServerPaged, setGiftsServerPaged] = useState(false)
  const [giftsNotice, setGiftsNotice] = useState<string | null>(null)
  // Фильтры для подарков
  const [statusFilter, setStatusFilter] = useState<{ used: boolean; active: boolean }>({ used: true, active: true }) // По умолчанию все активны
  const [tariffFilter, setTariffFilter] = useState<number | null>(null) // null = все тарифы
  const [showCouponModal, setShowCouponModal] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{isOpen: boolean, coupon: Coupon | null}>({isOpen: false, coupon: null})
  const [showGiftModal, setShowGiftModal] = useState(false)
  const [editingGift, setEditingGift] = useState<Gift | null>(null)
  const [deleteGiftConfirm, setDeleteGiftConfirm] = useState<{isOpen: boolean, gift: Gift | null}>({isOpen: false, gift: null})
  const [deleteUtmConfirm, setDeleteUtmConfirm] = useState<{isOpen: boolean, utm: UtmTag | null}>({isOpen: false, utm: null})
  const [utmStatsOpen, setUtmStatsOpen] = useState<UtmTag | null>(null)
  // tariffFilter: null = все тарифы, -1 = без тарифа, иначе = tariff_id

  useEffect(() => {
    setViewMode(initialViewMode)
  }, [initialViewMode])

  // Reset pagination when view or search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [viewMode, searchTerm, pageSize, tariffFilter, statusFilter])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setGiftsNotice(null)
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setLoading(false)
        return
      }

      if (viewMode === 'coupons') {
        const resp = await getBotCouponsPage(config, {
          page: currentPage,
          limit: pageSize,
          search: searchTerm || undefined,
        })
        setCoupons(Array.isArray(resp.items) ? (resp.items as any) : [])
        setRemoteTotal(Number(resp.total || 0))
        setRemoteTotalPages(Number(resp.pages || 1))
        setGiftsServerPaged(false)
      } else if (viewMode === 'gifts') {
        // Gifts: keep old UX (filters across the whole dataset) for small totals,
        // but avoid pulling everything for large totals.
        const meta = await getBotGiftsPage(config, { page: 1, limit: 1 })
        const total = Number(meta.total || 0)

        // Load tariffs (small list) for tariff filter labels
        if (!tariffs || tariffs.length === 0) {
          const tariffsData = await getBotTariffs(config).catch(() => [])
          setTariffs(Array.isArray(tariffsData) ? tariffsData : [])
        }

        if (total > 5000) {
          // Server-paged mode: show just current page (filters apply to current page only)
          const resp = await getBotGiftsPage(config, { page: currentPage, limit: pageSize })
          setGifts(Array.isArray(resp.items) ? (resp.items as any) : [])
          setRemoteTotal(total)
          setRemoteTotalPages(Number(resp.pages || Math.max(1, Math.ceil(total / pageSize))))
          setGiftsServerPaged(true)
          setGiftsNotice('Большой объём подарков: включена постраничная загрузка. Поиск/фильтры применяются к текущей странице.')
        } else {
          // Small enough: fetch all pages to preserve correct global filtering/grouping UX
          const limit = 200
          const pages = Math.max(1, Math.ceil(total / limit))
          const maxPages = 50 // hard cap safety (<= 10k)
          const pagesToFetch = Math.min(pages, maxPages)
          const tasks: Promise<any>[] = []
          for (let p = 1; p <= pagesToFetch; p++) tasks.push(getBotGiftsPage(config, { page: p, limit }))
          const results = await Promise.all(tasks)
          const all: any[] = []
          results.forEach((r: any) => {
            if (r && Array.isArray(r.items)) all.push(...r.items)
          })
          setGifts(all as any)
          setRemoteTotal(all.length)
          setRemoteTotalPages(Math.max(1, Math.ceil(all.length / pageSize)))
          setGiftsServerPaged(false)
          if (pages > maxPages) {
            setGiftsNotice(`Показаны первые ${all.length} подарков из ${total}. Уточни поиск/фильтры, чтобы сузить.`)
          }
        }
      } else if (viewMode === 'utm') {
        // UTM tags list is usually small; load all.
        const data = await getBotUtmTags(config)
        const utmList = Array.isArray(data) ? data : []
        setUtmTags(utmList as any)
        setUtmLoadedAt(Date.now())
        setRemoteTotal(utmList.length)
        setRemoteTotalPages(Math.max(1, Math.ceil(utmList.length / pageSize)))
        setGiftsServerPaged(false)
      }
    } catch (err: any) {
      if (viewMode === 'utm' && (err.status === 404 || err.message?.includes('Not Found') || err.message?.includes('404'))) {
        setUtmTags([])
        setUtmLoadedAt(Date.now())
        setError(null)
      } else {
        setError(err.message || `Ошибка загрузки ${viewMode === 'coupons' ? 'купонов' : viewMode === 'gifts' ? 'подарков' : 'UTM меток'}`)
      }
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, searchTerm, tariffs, viewMode])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Фильтрация купонов
  const filteredCoupons = useMemo(() => {
    return coupons.filter(coupon => {
      const matchesSearch = !searchTerm || 
        String(coupon.id || coupon.coupon_id || '').includes(searchTerm) ||
        String(coupon.code || '').toLowerCase().includes(searchTerm.toLowerCase())
      
      return matchesSearch
    })
  }, [coupons, searchTerm])

  // Фильтрация, сортировка и группировка подарков
  const filteredGifts = useMemo(() => {
    const filtered = gifts.filter(gift => {
      // Фильтр по поиску
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase()
        const matchesSearch = (
          String(gift.gift_id || gift.id || '').toLowerCase().includes(searchLower) ||
          String(gift.sender_tg_id || '').includes(searchTerm) ||
          String(gift.recipient_tg_id || '').includes(searchTerm) ||
          String(gift.tariff_name || gift.tariff || '').toLowerCase().includes(searchLower)
        )
        if (!matchesSearch) return false
      }

      // Фильтр по статусу
      const isUsed = gift.is_used !== undefined ? gift.is_used : false
      if (isUsed && !statusFilter.used) return false
      if (!isUsed && !statusFilter.active) return false

      // Фильтр по тарифу
      if (tariffFilter === -1) {
        const giftTariffId = gift.tariff_id
        if (giftTariffId !== undefined && giftTariffId !== null && giftTariffId !== 0) return false
      } else if (tariffFilter !== null) {
        const giftTariffId = gift.tariff_id
        if (giftTariffId !== tariffFilter) return false
      }

      return true
    })

    // Сортировка по дате создания (по убыванию - новые сверху)
    filtered.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
      return dateB - dateA // По убыванию (новые сверху)
    })

    return filtered
  }, [gifts, searchTerm, statusFilter, tariffFilter])

  // Тарифы, сгруппированные для <select>
  const tariffsByGroup = useMemo(() => {
    const groups: Record<string, any[]> = {}
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

  const pageSizeGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: '10', label: '10' },
          { value: '25', label: '25' },
          { value: '50', label: '50' },
          { value: '100', label: '100' },
        ],
      },
    ],
    [],
  )

  const tariffSelectGroups = useMemo<DarkSelectGroup[]>(() => {
    const groups: DarkSelectGroup[] = [
      {
        options: [
          { value: '', label: 'Все тарифы' },
          { value: '-1', label: 'Без тарифа' },
        ],
      },
    ]

    tariffsByGroup.forEach((g) => {
      const options = (g.tariffs || [])
        .map((tariff: any) => {
          const tariffId = tariff.id || tariff.tariff_id
          if (tariffId === undefined || tariffId === null) return null
          const label = tariff.name || tariff.tariff_name || `Тариф ${tariffId}`
          return { value: String(tariffId), label }
        })
        .filter(Boolean) as { value: string; label: React.ReactNode }[]
      if (options.length > 0) groups.push({ groupLabel: g.groupName, options })
    })

    return groups
  }, [tariffsByGroup])

  // Группировка подарков по статусу
  const groupedGifts = useMemo(() => {
    const groups: { status: string; gifts: Gift[] }[] = []
    
    const activeGifts = filteredGifts.filter(gift => {
      const isUsed = gift.is_used !== undefined ? gift.is_used : false
      return !isUsed
    })
    
    const usedGifts = filteredGifts.filter(gift => {
      const isUsed = gift.is_used !== undefined ? gift.is_used : false
      return isUsed
    })

    // Добавляем группы только если есть подарки в них
    // Сначала активные (более важные), потом использованные
    if (activeGifts.length > 0) {
      groups.push({ status: 'active', gifts: activeGifts })
    }
    if (usedGifts.length > 0) {
      groups.push({ status: 'used', gifts: usedGifts })
    }

    return groups
  }, [filteredGifts])

  // Фильтрация UTM меток
  const filteredUtmTags = useMemo(() => {
    return utmTags.filter(utm => {
      if (!searchTerm) return true
      
      const searchLower = searchTerm.toLowerCase()
      return (
        String(utm.id || '').includes(searchTerm) ||
        String(utm.name || '').toLowerCase().includes(searchLower) ||
        String(utm.code || '').toLowerCase().includes(searchLower) ||
        String(utm.type || '').toLowerCase().includes(searchLower)
      )
    })
  }, [utmTags, searchTerm])

  const utmTotals = useMemo<{ registrations: number; trials: number; payments: number; amount: number }>(() => {
    return filteredUtmTags.reduce<{ registrations: number; trials: number; payments: number; amount: number }>(
      (acc, utm) => {
        acc.registrations += Number(utm.registrations || 0)
        acc.trials += Number(utm.trials || 0)
        acc.payments += Number(utm.payments || 0)
        acc.amount += Number(utm.total_amount || 0)
        return acc
      },
      { registrations: 0, trials: 0, payments: 0, amount: 0 },
    )
  }, [filteredUtmTags])

  // Пагинация
  const currentData = viewMode === 'coupons' ? filteredCoupons : viewMode === 'gifts' ? filteredGifts : filteredUtmTags
  const totalPages = useMemo(() => {
    if (viewMode === 'coupons') return remoteTotalPages
    if (viewMode === 'gifts' && giftsServerPaged) return remoteTotalPages
    return Math.max(1, Math.ceil(currentData.length / pageSize))
  }, [currentData.length, giftsServerPaged, pageSize, remoteTotalPages, viewMode])
  const paginatedData = useMemo(() => {
    // For server-paged views, the currentData is already a page of items.
    if (viewMode === 'coupons') return currentData
    if (viewMode === 'gifts' && giftsServerPaged) return currentData
    const startIndex = (currentPage - 1) * pageSize
    return currentData.slice(startIndex, startIndex + pageSize)
  }, [currentData, currentPage, giftsServerPaged, pageSize, viewMode])

  // Пагинация для группированных подарков
  const paginatedGroupedGifts = useMemo(() => {
    if (viewMode !== 'gifts') return []
    if (giftsServerPaged) return groupedGifts
    
    // Получаем все подарки из всех групп
    const allGifts: Gift[] = []
    groupedGifts.forEach(group => {
      allGifts.push(...group.gifts)
    })
    
    // Применяем пагинацию
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = startIndex + pageSize
    const paginated = allGifts.slice(startIndex, endIndex)
    
    // Группируем подарки на текущей странице по статусу
    const pageGroups: { status: string; gifts: Gift[] }[] = []
    let currentGroup: { status: string; gifts: Gift[] } | null = null
    
    paginated.forEach(gift => {
      const isUsed = gift.is_used !== undefined ? gift.is_used : false
      const giftStatus = isUsed ? 'used' : 'active'
      
      if (!currentGroup || currentGroup.status !== giftStatus) {
        if (currentGroup) {
          pageGroups.push(currentGroup)
        }
        currentGroup = { status: giftStatus, gifts: [gift] }
      } else {
        currentGroup.gifts.push(gift)
      }
    })
    
    if (currentGroup) {
      pageGroups.push(currentGroup)
    }
    
    return pageGroups
  }, [groupedGifts, currentPage, pageSize, viewMode])

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    setCurrentPage(1) // Сбрасываем на первую страницу при изменении фильтров
  }, [searchTerm, pageSize, viewMode, statusFilter, tariffFilter])

  return (
    <>
      {/* Page wrapper (фон страницы, без отдельной "панели" поверх) */}
      <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2 mb-6">
          {viewMode === 'coupons' && (
            <button
              onClick={() => {
                setEditingCoupon(null)
                setShowCouponModal(true)
              }}
              className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg transition-all duration-200 flex items-center gap-2 hover:scale-105 active:scale-95 border border-green-500/30"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Создать купон
            </button>
          )}
          {viewMode === 'gifts' && (
            <button
              onClick={() => {
                setEditingGift(null)
                setShowGiftModal(true)
              }}
              className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg transition-all duration-200 flex items-center gap-2 hover:scale-105 active:scale-95 border border-green-500/30"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Создать подарок
            </button>
          )}
        </div>

        {/* Navigation tabs */}
        {showTabs && (
          <div className="mb-6">
            <GlassTabs
              tabs={[
                { id: 'coupons', label: 'Купоны' },
                { id: 'gifts', label: 'Подарки' },
                { id: 'utm', label: 'UTM метки' },
              ]}
              activeTab={viewMode}
              onTabChange={(tabId) => setViewMode(tabId as CouponsViewMode)}
            />
          </div>
        )}

        {error && (
          <div className="mb-6">
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
          </div>
        )}

        {loading ? (
          <div className="glass-table p-3">
            <CapybaraLoader />
          </div>
        ) : (
          <>
            {/* Фильтры и поиск */}
            <div className="glass-table p-4 mb-3 relative">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">Поиск</label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={
                      viewMode === 'coupons' ? 'ID, код купона...' : 
                      viewMode === 'gifts' ? 'ID, отправитель, получатель, тариф...' :
                      'ID, название UTM метки...'
                    }
                    className="filter-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">На странице</label>
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

              {/* Фильтры для подарков */}
              {viewMode === 'gifts' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-default" style={{ position: 'relative', zIndex: 10 }}>
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Статус</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setStatusFilter(prev => ({ ...prev, used: !prev.used }))}
                        className={`px-4 py-2 rounded-lg transition-colors font-medium ${
                          statusFilter.used
                            ? 'bg-red-500/70 text-primary'
                            : 'bg-overlay-xs text-muted hover:bg-overlay-sm hover:text-primary border border-default'
                        }`}
                      >
                        Использован
                      </button>
                      <button
                        onClick={() => setStatusFilter(prev => ({ ...prev, active: !prev.active }))}
                        className={`px-4 py-2 rounded-lg transition-colors font-medium ${
                          statusFilter.active
                            ? 'bg-green-500/70 text-primary'
                            : 'bg-overlay-xs text-muted hover:bg-overlay-sm hover:text-primary border border-default'
                        }`}
                      >
                        Активен
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Тариф</label>
                    <DarkSelect
                      value={tariffFilter === null ? '' : String(tariffFilter)}
                      onChange={(v) => {
                        setTariffFilter(v === '' ? null : Number(v))
                        setCurrentPage(1)
                      }}
                      groups={tariffSelectGroups}
                      buttonClassName="filter-field"
                    />
                  </div>
                </div>
              )}
            </div>


            {/* Таблица купонов */}
            {viewMode === 'coupons' && (
              <>
                {remoteTotal === 0 ? (
                  <div className="glass-panel p-2">
                    <p className="text-muted text-center py-8">Купоны не найдены</p>
                  </div>
                ) : (
                  <div className="w-full mb-2">
                    {/* Desktop Table */}
                    <div className="hidden md:block table-wrapper">
                      <table className="data-table" style={{ tableLayout: 'fixed' }}>
                        <colgroup>
                          <col />
                          <col />
                          <col />
                          <col />
                          <col />
                          <col />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="px-3 py-3 text-left text-sm font-semibold">ID</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold">Код</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap">Тип</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap">Значение</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap">Использовано</th>
                            <th className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap">Действия</th>
                          </tr>
                        </thead>
                      <tbody>
                        {(paginatedData as Coupon[]).map((coupon: Coupon, index) => {
                          // Detect coupon type & value
                          const pct = Number(coupon.percent || 0)
                          const daysVal = Number(coupon.days || coupon.duration_days || coupon.duration || 0)
                          const amountVal = Number(coupon.amount || coupon.balance || coupon.bonus || coupon.balance_amount || coupon.discount_amount || coupon.discount || coupon.price || 0)

                          let typeLabel: string
                          let typeColor: string
                          let valueDisplay: string
                          if (pct > 0) {
                            typeLabel = 'Процент'
                            typeColor = 'text-purple-400'
                            const parts = [`${pct}%`]
                            if (coupon.max_discount_amount) parts.push(`макс ${coupon.max_discount_amount} ₽`)
                            if (coupon.min_order_amount) parts.push(`от ${coupon.min_order_amount} ₽`)
                            valueDisplay = parts.join(' · ')
                          } else if (daysVal > 0) {
                            typeLabel = 'Время'
                            typeColor = 'text-sky-400'
                            valueDisplay = `${daysVal} дн`
                          } else if (amountVal > 0) {
                            typeLabel = 'Баланс'
                            typeColor = 'text-emerald-400'
                            valueDisplay = `${amountVal} ₽`
                          } else {
                            typeLabel = '-'
                            typeColor = 'text-muted'
                            valueDisplay = '-'
                          }

                          // Used count
                          let usedCount = 0
                          for (const f of ['used_count', 'uses_count', 'usage_count', 'used', 'count', 'times_used']) {
                            if (f in coupon && coupon[f] != null) { usedCount = Number(coupon[f]); break }
                          }
                          // Usage limit
                          let maxUses: number | null = null
                          for (const f of ['max_uses', 'max_use', 'limit', 'max_count', 'usage_limit']) {
                            if (f in coupon && coupon[f] != null) { maxUses = Number(coupon[f]); break }
                          }

                          const isLast = index === paginatedData.length - 1
                          const couponKey = coupon.id || coupon.coupon_id || index
                          return (
                            <React.Fragment key={couponKey}>
                              <tr className="transition-colors">
                                <td className="px-3 py-3 text-sm truncate" title={String(coupon.id || coupon.coupon_id || '-')}>{coupon.id || coupon.coupon_id || '-'}</td>
                                <td className="px-3 py-3 text-sm font-medium truncate" title={coupon.code || '-'}>{coupon.code || '-'}</td>
                                <td className={`px-3 py-3 text-sm whitespace-nowrap font-medium ${typeColor}`}>{typeLabel}</td>
                                <td className="px-3 py-3 text-sm whitespace-nowrap">{valueDisplay}</td>
                                <td className="px-3 py-3 text-sm whitespace-nowrap">
                                  {usedCount}{maxUses != null && maxUses > 0 ? ` / ${maxUses}` : ''}
                                </td>
                                <td className="px-2.5 py-2 pl-6">
                                  <div className="flex items-center justify-end gap-1.5 flex-shrink-0">
                                    <EditButton
                                      size="sm"
                                      onClick={() => {
                                        setEditingCoupon(coupon)
                                        setShowCouponModal(true)
                                      }}
                                      ariaLabel="Редактировать купон"
                                      title="Редактировать"
                                    />
                                    <DeleteButton size="sm" onClick={() => setDeleteConfirm({ isOpen: true, coupon })} ariaLabel="Удалить купон" title="Удалить" variant="big" />
                                  </div>
                                </td>
                              </tr>
                              {!isLast && (
                                <tr key={`${couponKey}-spacer`}>
                                  <td colSpan={6} className="h-1 bg-overlay-sm"></td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                      </div>
                    
                      {/* Mobile Cards */}
                      <div className="md:hidden space-y-2 p-2">
                      {(paginatedData as Coupon[]).map((coupon: Coupon) => {
                        const pct = Number(coupon.percent || 0)
                        const daysVal = Number(coupon.days || coupon.duration_days || coupon.duration || 0)
                        const amountVal = Number(coupon.amount || coupon.balance || coupon.bonus || coupon.balance_amount || coupon.discount_amount || coupon.discount || coupon.price || 0)

                        let typeLabel: string
                        let typeColor: string
                        let valueDisplay: string
                        if (pct > 0) {
                          typeLabel = 'Процент'
                          typeColor = 'text-purple-400'
                          valueDisplay = `${pct}%`
                        } else if (daysVal > 0) {
                          typeLabel = 'Время'
                          typeColor = 'text-sky-400'
                          valueDisplay = `${daysVal} дн`
                        } else if (amountVal > 0) {
                          typeLabel = 'Баланс'
                          typeColor = 'text-emerald-400'
                          valueDisplay = `${amountVal} ₽`
                        } else {
                          typeLabel = '-'
                          typeColor = 'text-muted'
                          valueDisplay = '-'
                        }

                        let usedCount = 0
                        for (const f of ['used_count', 'uses_count', 'usage_count', 'used', 'count']) {
                          if (f in coupon && coupon[f] != null) { usedCount = Number(coupon[f]); break }
                        }
                        let maxUses: number | null = null
                        for (const f of ['max_uses', 'max_use', 'limit', 'max_count', 'usage_limit']) {
                          if (f in coupon && coupon[f] != null) { maxUses = Number(coupon[f]); break }
                        }

                        return (
                          <div key={coupon.id || coupon.code || Math.random()} className="bg-overlay-xs backdrop-blur-sm rounded border border-default p-2">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="text-primary text-sm font-semibold mb-1">{coupon.code || '-'}</div>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="text-muted">ID: {coupon.id || '-'}</span>
                                  <span className={`font-medium ${typeColor}`}>{typeLabel}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <EditButton
                                  size="sm"
                                  onClick={() => {
                                    setEditingCoupon(coupon)
                                    setShowCouponModal(true)
                                  }}
                                  ariaLabel="Редактировать купон"
                                  title="Редактировать"
                                />
                                <DeleteButton size="sm" onClick={() => setDeleteConfirm({ isOpen: true, coupon })} ariaLabel="Удалить купон" title="Удалить" variant="big" />
                              </div>
                            </div>
                            <div className="space-y-1.5 text-xs">
                              <div>
                                <span className="text-muted">Значение:</span>
                                <span className="text-dim ml-1">{valueDisplay}</span>
                              </div>
                              <div>
                                <span className="text-muted">Использовано:</span>
                                <span className="text-dim ml-1">{usedCount}{maxUses != null && maxUses > 0 ? ` / ${maxUses}` : ''}</span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      </div>
                    </div>
                )}
              </>
            )}

            {/* Таблица подарков */}
            {viewMode === 'gifts' && (
              <>
                {giftsNotice && (
                  <div className="mb-3 rounded-xl border border-default bg-[var(--bg-surface-hover)]/60 px-4 py-3 text-sm text-dim">
                    {giftsNotice}
                  </div>
                )}
                {/* Пагинация сверху */}
                {totalPages > 1 && (giftsServerPaged ? remoteTotal > 0 : filteredGifts.length > 0) && (
                  <div className="flex justify-between items-center mb-4">
                    <div className="text-muted text-sm">
                      {(() => {
                        const total = giftsServerPaged ? remoteTotal : filteredGifts.length
                        const from = total === 0 ? 0 : ((currentPage - 1) * pageSize) + 1
                        const to = total === 0 ? 0 : Math.min(currentPage * pageSize, total)
                        return <>Показано {from} - {to} из {total}</>
                      })()}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-default bg-overlay-md text-primary hover:bg-overlay-md"
                      >
                        Назад
                      </button>
                      <span className="px-4 py-2 rounded-lg border border-default bg-overlay-md text-primary">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-default bg-overlay-md text-primary hover:bg-overlay-md"
                      >
                        Вперед
                      </button>
                    </div>
                  </div>
                )}

                {filteredGifts.length === 0 ? (
                  <div className="glass-table p-3">
                    <p className="text-muted text-center py-8">
                      {giftsServerPaged ? 'Нет подарков по фильтрам на этой странице' : 'Подарки не найдены'}
                    </p>
                  </div>
                ) : (
                  <div className="w-full mb-2">
                    <div className="hidden md:block table-wrapper">
                      <table className="data-table min-w-[700px]" style={{ tableLayout: 'fixed' }}>
                        <colgroup>
                          <col />
                          <col />
                          <col />
                          <col />
                          <col />
                          <col />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap">Отправитель</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap">Получатель</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold">Тариф</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold">Даты</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap">Статус</th>
                            <th className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap">Действия</th>
                          </tr>
                        </thead>
                      <tbody>
                        {paginatedGroupedGifts.map((group, groupIndex) => {
                          const groupStatusText = group.status === 'used' ? 'Использован' : 'Активен'
                          const groupStatusColor = group.status === 'used' ? 'text-red-400' : 'text-green-400'
                          const groupBgColor = group.status === 'used' ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'
                          const isLastGroup = groupIndex === paginatedGroupedGifts.length - 1
                          
                          return (
                            <React.Fragment key={`group-${group.status}-${groupIndex}`}>
                              {/* Заголовок группы */}
                              <tr className={`${groupBgColor} border-y-2`}>
                                <td colSpan={6} className="px-2.5 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`${groupStatusColor} font-bold text-sm`}>
                                      {groupStatusText}
                                    </span>
                                    <span className="text-muted text-sm">
                                      ({group.gifts.length} {group.gifts.length === 1 ? 'подарок' : group.gifts.length < 5 ? 'подарка' : 'подарков'})
                                    </span>
                                  </div>
                                </td>
                              </tr>
                              
                              {/* Подарки в группе */}
                              {group.gifts.map((gift, giftIndex) => {
                                // Форматируем дату создания
                                const formatDate = (dateString?: string) => {
                                  if (!dateString) return '-'
                                  try {
                                    return formatMskDateTimeShort(dateString)
                                  } catch {
                                    return dateString
                                  }
                                }

                                // Определяем статус
                                const isUsed = gift.is_used !== undefined ? gift.is_used : false
                                const statusText = isUsed ? 'Использован' : 'Активен'
                                const statusColor = isUsed ? 'text-red-400' : 'text-green-400'

                                // Получаем тариф по tariff_id
                                let tariffName = '-'
                                if (gift.tariff_id) {
                                  const tariff = tariffs.find(t => 
                                    (t.id || t.tariff_id) === gift.tariff_id
                                  )
                                  if (tariff) {
                                    tariffName = tariff.name || tariff.tariff_name || '-'
                                  }
                                } else if (gift.tariff_name || gift.tariff) {
                                  tariffName = gift.tariff_name || gift.tariff || '-'
                                }

                                const giftId = gift.gift_id || gift.id || '-'

                                const giftKey = giftId || `gift-${giftIndex}`
                                return (
                                  <React.Fragment key={giftKey}>
                                    <tr 
                                      className="transition-colors"
                                      
                                      onMouseEnter={() => { void 0 }}
                                      onMouseLeave={() => { void 0 }}
                                    >
                                      <td
                                        className="px-3 py-3 text-sm whitespace-nowrap"
                                       
                                        title={String(giftId)}
                                      >
                                        {gift.sender_tg_id ? gift.sender_tg_id : '-'}
                                      </td>
                                      <td className="px-3 py-3 text-sm whitespace-nowrap">
                                        {gift.recipient_tg_id ? gift.recipient_tg_id : '-'}
                                      </td>
                                      <td className="px-3 py-3 text-sm truncate" title={tariffName}>
                                        {tariffName}
                                      </td>
                                      <td className="px-3 py-3 text-sm">
                                        <div className="flex flex-col">
                                          <span className="text-dim text-sm leading-snug">Создан: {formatDate(gift.created_at)}</span>
                                          <span className="text-dim text-sm leading-snug mt-0.5">Истекает: {formatDate(gift.expiry_time)}</span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-3">
                                        <span className={`${statusColor} text-sm font-medium`}>{statusText}</span>
                                      </td>
                                      <td className="px-3 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                          <EditButton
                                            size="sm"
                                            onClick={() => {
                                              setEditingGift(gift)
                                              setShowGiftModal(true)
                                            }}
                                            ariaLabel="Редактировать подарок"
                                            title="Редактировать"
                                          />
                                          <DeleteButton size="sm" onClick={() => setDeleteGiftConfirm({ isOpen: true, gift })} ariaLabel="Удалить подарок" title="Удалить" variant="big" />
                                        </div>
                                      </td>
                                    </tr>
                                  </React.Fragment>
                                )
                              })}
                              
                              {/* Разделитель между группами */}
                              {!isLastGroup && (
                                <tr key={`group-spacer-${groupIndex}`}>
                                  <td colSpan={6} className="h-2 bg-overlay-md"></td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                      </div>
                      {/* Mobile Cards для подарков */}
                    <div className="md:hidden space-y-3 p-3 glass-table">
                        {paginatedGroupedGifts.map((group, groupIndex) => {
                          const groupStatusText = group.status === 'used' ? 'Использован' : 'Активен'
                          const groupStatusColor = group.status === 'used' ? 'text-red-400' : 'text-green-400'
                          const groupBgColor = group.status === 'used' ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'
                          
                          return (
                            <div key={`mobile-group-${group.status}-${groupIndex}`} className="space-y-2">
                              {/* Заголовок группы */}
                              <div className={`${groupBgColor} border rounded-lg p-2`}>
                                <span className={`${groupStatusColor} font-bold text-sm`}>
                                  {groupStatusText} ({group.gifts.length} {group.gifts.length === 1 ? 'подарок' : group.gifts.length < 5 ? 'подарка' : 'подарков'})
                                </span>
                              </div>
                              
                              {/* Карточки подарков */}
                              {group.gifts.map((gift) => {
                                const formatDate = (dateString?: string) => {
                                  if (!dateString) return '-'
                                  try {
                                    const date = new Date(dateString)
                                    return date.toLocaleDateString('ru-RU', { 
                                      day: '2-digit', 
                                      month: '2-digit', 
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })
                                  } catch {
                                    return dateString
                                  }
                                }

                                const isUsed = gift.is_used !== undefined ? gift.is_used : false
                                const statusText = isUsed ? 'Использован' : 'Активен'
                                const statusColor = isUsed ? 'text-red-400' : 'text-green-400'

                                let tariffName = '-'
                                if (gift.tariff_id) {
                                  const tariff = tariffs.find(t => 
                                    (t.id || t.tariff_id) === gift.tariff_id
                                  )
                                  if (tariff) {
                                    tariffName = tariff.name || tariff.tariff_name || '-'
                                  }
                                } else if (gift.tariff_name || gift.tariff) {
                                  tariffName = gift.tariff_name || gift.tariff || '-'
                                }

                                const giftId = gift.gift_id || gift.id || '-'
                                
                                return (
                                  <div key={giftId} className="glass-panel p-3">
                                    <div className="flex items-start justify-between mb-2">
                                      <div className="flex-1">
                                        <div className="text-xs text-muted mb-1">ID: {giftId}</div>
                                        <div className="flex items-center gap-2 mb-2">
                                          <span className={`${statusColor} text-sm font-medium`}>{statusText}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          onClick={() => {
                                            setEditingGift(gift)
                                            setShowGiftModal(true)
                                          }}
                                          className="btn-edit btn-edit-icon"
                                          title="Редактировать"
                                        >
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                        </button>
                                        <DeleteButton
                                          size="sm"
                                          variant="small"
                                          onClick={() => setDeleteGiftConfirm({ isOpen: true, gift })}
                                          ariaLabel="Удалить подарок"
                                          title="Удалить"
                                        />
                                      </div>
                                    </div>
                                    <div className="space-y-1.5 text-xs">
                                      <div>
                                        <span className="text-muted">Отправитель:</span>
                                        <span className="ml-1 text-primary">{gift.sender_tg_id || '-'}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted">Получатель:</span>
                                        <span className="ml-1 text-primary">{gift.recipient_tg_id || '-'}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted">Тариф:</span>
                                        <span className="ml-1 text-primary">{tariffName}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted">Создан:</span>
                                        <span className="ml-1 text-primary">{formatDate(gift.created_at)}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted">Истекает:</span>
                                        <span className="ml-1 text-primary">{formatDate(gift.expiry_time)}</span>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* UTM метки */}
            {viewMode === 'utm' && (
              <>
                {/* Пагинация сверху */}
                {totalPages > 1 && filteredUtmTags.length > 0 && (
                  <div className="flex justify-between items-center mb-4">
                    <div className="text-muted text-sm">
                      Показано {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredUtmTags.length)} из {filteredUtmTags.length}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-default bg-overlay-md text-primary hover:bg-overlay-md"
                      >
                        Назад
                      </button>
                      <span className="px-4 py-2 rounded-lg border border-default bg-overlay-md text-primary">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-default bg-overlay-md text-primary hover:bg-overlay-md"
                      >
                        Вперед
                      </button>
                    </div>
                  </div>
                )}

                {/* UTM summary / refresh */}
                <div className="glass-table p-4 mb-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="glass-panel px-3 py-2">
                        <div className="text-xs text-muted">Регистрации</div>
                        <div className="text-primary text-[18px] font-bold">{utmTotals.registrations.toLocaleString('ru-RU')}</div>
                      </div>
                      <div className="glass-panel px-3 py-2">
                        <div className="text-xs text-muted">Триалы</div>
                        <div className="text-primary text-[18px] font-bold">{utmTotals.trials.toLocaleString('ru-RU')}</div>
                      </div>
                      <div className="glass-panel px-3 py-2">
                        <div className="text-xs text-muted">Платежи</div>
                        <div className="text-primary text-[18px] font-bold">{utmTotals.payments.toLocaleString('ru-RU')}</div>
                      </div>
                      <div className="glass-panel px-3 py-2">
                        <div className="text-xs text-muted">Сумма</div>
                        <div className="text-green-500 text-[18px] font-bold whitespace-nowrap">
                          {Math.round(utmTotals.amount).toLocaleString('ru-RU')} ₽
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3">
                      <div className="text-xs text-muted">
                        {utmLoadedAt ? `обновлено: ${new Date(utmLoadedAt).toLocaleString('ru-RU')}` : '—'}
                      </div>
                      <button
                        onClick={() => loadData()}
                        className="px-3 py-2 rounded-lg border border-default bg-overlay-xs hover:bg-overlay-sm transition-colors text-sm font-semibold text-primary"
                        title="Обновить список UTM"
                      >
                        Обновить
                      </button>
                    </div>
                  </div>
                </div>

                {filteredUtmTags.length === 0 ? (
                  <div className="glass-table p-3">
                    <p className="text-muted text-center py-8">UTM метки не найдены</p>
                  </div>
                ) : (
                  <div
                    className="hidden md:block glass-table overflow-x-auto table-container mx-0 mb-2"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[780px] text-left">
                      <thead>
                        <tr className="border-b border-default bg-[var(--table-thead-bg)]">
                          <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap text-secondary w-[52px]">ID</th>
                          <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap text-secondary">Название</th>
                          <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap text-secondary">Код</th>
                          <th className="px-3 py-3 text-left text-sm font-semibold whitespace-nowrap text-secondary w-[70px]">Тип</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap text-secondary w-[110px]">Регистрации</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap text-secondary w-[90px]">Триалы</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap text-secondary w-[90px]">Платежи</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap text-secondary w-[110px]">Сумма</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap text-secondary w-[150px]">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(paginatedData as UtmTag[]).map((utm: UtmTag, index) => {
                          const utmKey = utm.id || index
                          return (
                            <React.Fragment key={utmKey}>
                              <tr className="border-b border-default transition-colors hover:bg-overlay-xs">

                                <td className="px-3 py-3 text-primary text-[15px] whitespace-nowrap font-semibold">{utm.id || '-'}</td>
                                <td className="px-3 py-3 text-primary text-[15px] font-semibold truncate max-w-[220px]" title={utm.name || ''}>
                                  {utm.name || '-'}
                                </td>
                                <td className="px-3 py-3 text-secondary text-[14px] truncate font-mono max-w-[220px]" title={utm.code || ''}>
                                  {utm.code || '-'}
                                </td>
                                <td className="px-3 py-3 text-secondary text-[14px] whitespace-nowrap" title={utm.type || ''}>
                                  <span className="px-2 py-1 bg-overlay-sm border border-default rounded-lg text-[13px]">{utm.type || '-'}</span>
                                </td>
                                <td className="px-3 py-3 text-secondary text-[15px] whitespace-nowrap text-right font-semibold">
                                  {utm.registrations !== undefined ? utm.registrations.toLocaleString('ru-RU') : '-'}
                                </td>
                                <td className="px-3 py-3 text-secondary text-[15px] whitespace-nowrap text-right font-semibold">
                                  {utm.trials !== undefined ? utm.trials.toLocaleString('ru-RU') : '-'}
                                </td>
                                <td className="px-3 py-3 text-secondary text-[15px] whitespace-nowrap text-right font-semibold">
                                  {utm.payments !== undefined ? utm.payments.toLocaleString('ru-RU') : '-'}
                                </td>
                                <td className="px-3 py-3 text-green-500 text-[15px] font-bold whitespace-nowrap text-right">
                                  {utm.total_amount !== undefined ? `${utm.total_amount.toLocaleString('ru-RU')} ₽` : '-'}
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center justify-end gap-1.5 flex-shrink-0">
                                    <button
                                      onClick={() => setUtmStatsOpen(utm)}
                                      className="h-9 px-3 rounded-lg transition-colors bg-accent-15 hover:bg-[var(--accent)]/25 text-[var(--accent)] border border-accent-20 inline-flex items-center gap-2"
                                      title="Статистика"
                                      aria-label="Статистика"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                      </svg>
                                      <span className="text-[13px] font-semibold text-[var(--accent)]">Статистика</span>
                                    </button>
                                    <DeleteButton
                                      size="sm"
                                      variant="small"
                                      onClick={() => setDeleteUtmConfirm({ isOpen: true, utm })}
                                      ariaLabel="Удалить UTM метку"
                                      title="Удалить"
                                    />
                                  </div>
                                </td>
                              </tr>
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>
                    {/* Mobile Cards для UTM меток */}
                    <div className="md:hidden space-y-2 p-3 glass-table">
                      {(paginatedData as UtmTag[]).map((utm: UtmTag) => {
                        const utmKey = utm.id || Math.random()
                        return (
                          <div key={utmKey} className="glass-panel p-3">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="text-primary text-[15px] leading-6 font-semibold mb-1">{utm.name || '-'}</div>
                                <div className="text-muted text-[13px] mb-1">ID: {utm.id || '-'}</div>
                                <div className="text-secondary text-[13px] font-mono">{utm.code || '-'}</div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => setUtmStatsOpen(utm)}
                                  className="p-2 rounded-lg transition-colors bg-accent-15 hover:bg-[var(--accent)]/25 text-[var(--accent)] border border-accent-20"
                                  title="Аналитика"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                  </svg>
                                </button>
                                <DeleteButton
                                  size="sm"
                                  variant="small"
                                  onClick={() => setDeleteUtmConfirm({ isOpen: true, utm })}
                                  ariaLabel="Удалить UTM метку"
                                  title="Удалить"
                                />
                              </div>
                            </div>
                            <div className="space-y-1.5 text-[13px]">
                              <div>
                                <span className="text-muted">Тип:</span>
                                <span className="ml-1 text-primary">{utm.type || '-'}</span>
                              </div>
                              <div>
                                <span className="text-muted">Регистрации:</span>
                                <span className="ml-1 text-primary">{utm.registrations !== undefined ? utm.registrations.toLocaleString('ru-RU') : '-'}</span>
                              </div>
                              <div>
                                <span className="text-muted">Триалы:</span>
                                <span className="ml-1 text-primary">{utm.trials !== undefined ? utm.trials.toLocaleString('ru-RU') : '-'}</span>
                              </div>
                              <div>
                                <span className="text-muted">Платежи:</span>
                                <span className="ml-1 text-primary">{utm.payments !== undefined ? utm.payments.toLocaleString('ru-RU') : '-'}</span>
                              </div>
                              <div>
                                <span className="text-muted">Сумма:</span>
                                <span className="ml-1 font-semibold text-green-500">
                                  {utm.total_amount !== undefined ? `${utm.total_amount.toLocaleString('ru-RU')} ₽` : '-'}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Пагинация снизу */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-4">
                <div className="text-muted text-sm">
                  {(() => {
                    const total =
                      viewMode === 'coupons'
                        ? remoteTotal
                        : viewMode === 'gifts' && giftsServerPaged
                          ? remoteTotal
                          : currentData.length
                    const from = total === 0 ? 0 : ((currentPage - 1) * pageSize) + 1
                    const to = total === 0 ? 0 : Math.min(currentPage * pageSize, total)
                    return <>Показано {from} - {to} из {total}</>
                  })()}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-default bg-overlay-md text-primary hover:bg-overlay-md"
                  >
                    Назад
                  </button>
                  <span className="px-4 py-2 rounded-lg border border-default bg-overlay-md text-primary">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-default bg-overlay-md text-primary hover:bg-overlay-md"
                  >
                    Вперед
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Модальные окна */}
        {/* Аналитика UTM */}
        {utmStatsOpen && (
          <UtmStatsModal
            isOpen={!!utmStatsOpen}
            utm={utmStatsOpen}
            onClose={() => setUtmStatsOpen(null)}
          />
        )}

        {/* Модальное окно создания/редактирования купона */}
        {showCouponModal && (
          <CouponEditModal
          editingCoupon={editingCoupon || undefined}
          onClose={() => {
            setShowCouponModal(false)
            setEditingCoupon(null)
          }}
          onSaved={() => {
            setShowCouponModal(false)
            setEditingCoupon(null)
            loadData()
          }}
          />
        )}

        {/* Модальное окно создания/редактирования подарка */}
        {showGiftModal && (
          <GiftEditModal
          editingGift={editingGift || undefined}
          onClose={() => {
            setShowGiftModal(false)
            setEditingGift(null)
          }}
          onSaved={() => {
            setShowGiftModal(false)
            setEditingGift(null)
            loadData()
          }}
          />
        )}

        {/* Модальное окно подтверждения удаления купона */}
        {deleteConfirm.isOpen && deleteConfirm.coupon && (
          <ConfirmModal
          isOpen={deleteConfirm.isOpen}
          title="Удаление купона"
          message={`Вы уверены, что хотите удалить купон "${deleteConfirm.coupon.code || deleteConfirm.coupon.id}"?`}
          onConfirm={async () => {
              try {
                const config = await getBotConfigAsync()
                if (!config) {
                  alert('Нет активного профиля')
                  return
                }
                // API может принимать либо ID, либо код купона
                // Приоритет: код купона (если есть), затем ID
                const couponId = deleteConfirm.coupon!.code || deleteConfirm.coupon!.id || deleteConfirm.coupon!.coupon_id
                if (!couponId) {
                  throw new Error('Не удалось определить ID купона')
                }
                await deleteBotCoupon(config, couponId)
                setDeleteConfirm({ isOpen: false, coupon: null })
                loadData()
              } catch (err: any) {
                alert(err.message || 'Ошибка удаления купона')
                setDeleteConfirm({ isOpen: false, coupon: null })
              }
            }}
            onCancel={() => setDeleteConfirm({ isOpen: false, coupon: null })}
          />
        )}

        {/* Модальное окно подтверждения удаления подарка */}
        {deleteGiftConfirm.isOpen && deleteGiftConfirm.gift && (
          <ConfirmModal
          isOpen={deleteGiftConfirm.isOpen}
          title="Удаление подарка"
          message={`Вы уверены, что хотите удалить подарок с ID "${deleteGiftConfirm.gift.gift_id || deleteGiftConfirm.gift.id || 'неизвестно'}"?`}
          onConfirm={async () => {
            try {
              const config = await getBotConfigAsync()
              if (!config) {
                toast.showError('Ошибка', 'Нет активного профиля')
                return
              }
              const giftId = deleteGiftConfirm.gift!.id || deleteGiftConfirm.gift!.gift_id
              if (!giftId) {
                throw new Error('Не удалось определить ID подарка')
              }
              await deleteBotGift(config, giftId)
              setDeleteGiftConfirm({ isOpen: false, gift: null })
              toast.showSuccess('Удалено', 'Подарок успешно удалён')
              loadData()
            } catch (err: any) {
              toast.showError('Ошибка удаления', err?.message || 'Ошибка удаления подарка')
              setDeleteGiftConfirm({ isOpen: false, gift: null })
            }
            }}
            onCancel={() => setDeleteGiftConfirm({ isOpen: false, gift: null })}
          />
        )}

        {/* Модальное окно подтверждения удаления UTM метки */}
        {deleteUtmConfirm.isOpen && deleteUtmConfirm.utm && (
          <ConfirmModal
          isOpen={deleteUtmConfirm.isOpen}
          title="Удаление UTM метки"
          message={`Вы уверены, что хотите удалить UTM метку "${deleteUtmConfirm.utm.name || deleteUtmConfirm.utm.id || deleteUtmConfirm.utm.utm_id || 'неизвестно'}"?`}
          onConfirm={async () => {
              try {
                const config = await getBotConfigAsync()
                if (!config) {
                  alert('Нет активного профиля')
                  return
                }
                const utmId = deleteUtmConfirm.utm!.id || deleteUtmConfirm.utm!.utm_id
                if (!utmId) {
                  throw new Error('Не удалось определить ID UTM метки')
                }
                await deleteBotUtmTag(config, utmId)
                setDeleteUtmConfirm({ isOpen: false, utm: null })
                loadData()
              } catch (err: any) {
                alert(err.message || 'Ошибка удаления UTM метки')
                setDeleteUtmConfirm({ isOpen: false, utm: null })
              }
            }}
            onCancel={() => setDeleteUtmConfirm({ isOpen: false, utm: null })}
          />
        )}
      </div>
      {/* End page wrapper */}
    </>
  )
}
