import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
// Layout теперь применяется на уровне роутера (LayoutRoute)
import { getBotConfigAsync } from '../utils/botConfig'
import { getBotTariffs, deleteBotTariff, updateBotTariff, updateBotTariffById, deleteBotTariffById } from '../api/botApi'
import TariffEditModal from '../components/tariffs/TariffEditModal'
import ConfirmModal from '../components/common/ConfirmModal'
import CapybaraLoader from '../components/common/CapybaraLoader'
import { GradientAlert } from '../components/common/GradientAlert'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import NeoToggle from '../components/common/NeoToggle'
import DeleteButton from '../components/ui/DeleteButton'
import EditButton from '../components/ui/EditButton'

interface Tariff {
  id?: number
  tariff_id?: number
  name: string
  tariff_name?: string
  price?: number
  duration_days?: number
  duration?: number
  group_code?: string
  group?: string
  subgroup?: string | number
  subgroup_title?: string | number
  sub_group?: string | number
  subgroup_name?: string | number
  category?: string
  [key: string]: any
}

interface TariffData {
  name: string
  price: number | undefined
  duration: number
  trafficGB: string | null
  devices: number | null
  isEnabled: boolean
  tariff: Tariff
}

export default function Tariffs() {
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingTariff, setEditingTariff] = useState<Tariff | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{isOpen: boolean, tariff: Tariff | null}>({isOpen: false, tariff: null})
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [toggling, setToggling] = useState<Set<string>>(new Set())
  const missingProfile = Boolean(error && error.includes('Нет активного профиля'))

  useEffect(() => {
    loadTariffs()
  }, [])

  const loadTariffs = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setLoading(false)
        return
      }

      const data = await getBotTariffs(config)
      const tariffsList = Array.isArray(data) ? data : []
      setTariffs(tariffsList)
      
      // Разворачиваем все группы по умолчанию
      const groups = new Set<string>()
      tariffsList.forEach((tariff) => {
        const group = (tariff.group_code || tariff.group || tariff.category || 'Без группы') as string
        groups.add(group)
      })
      setExpandedGroups(groups)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка загрузки тарифов'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // Группировка тарифов: сначала по группам, затем по подгруппам
  const groupedTariffs = useMemo(() => {
    // Структура: groups[groupName][subgroupName] = Tariff[]
    const groups: Record<string, Record<string, Tariff[]>> = {}
    
    tariffs.forEach((tariff) => {
      // Определяем группу (приоритет: group_code > group > category)
      const group = tariff.group_code || tariff.group || tariff.category || 'Без группы'
      // Определяем подгруппу (если есть и не пустая, иначе используем 'Без подгруппы')
      // Проверяем все возможные варианты поля subgroup
      // ВАЖНО: API использует subgroup_title, а не subgroup!
      const subgroupValue = tariff.subgroup_title || tariff.subgroup || tariff.sub_group || tariff.subgroup_name || ''
      const subgroup = (subgroupValue && String(subgroupValue).trim() !== '') ? String(subgroupValue).trim() : 'Без подгруппы'
      
      if (!groups[group]) {
        groups[group] = {}
      }
      if (!groups[group][subgroup]) {
        groups[group][subgroup] = []
      }
      groups[group][subgroup].push(tariff)
    })
    
    // Сортируем группы, подгруппы и тарифы внутри подгрупп
    const sortedGroups: Record<string, Record<string, Tariff[]>> = {}
    Object.keys(groups).sort().forEach(groupKey => {
      sortedGroups[groupKey] = {}
      Object.keys(groups[groupKey]).sort().forEach(subgroupKey => {
        sortedGroups[groupKey][subgroupKey] = groups[groupKey][subgroupKey].sort((a, b) => {
          const nameA = (a.name || a.tariff_name || '').toLowerCase()
          const nameB = (b.name || b.tariff_name || '').toLowerCase()
          return nameA.localeCompare(nameB)
        })
      })
    })
    
    return sortedGroups
  }, [tariffs])

  // Функция для получения данных тарифа
  const getTariffData = (tariff: Tariff): TariffData => {
    const tariffName = tariff.name || tariff.tariff_name || 'Без названия'
    
    let tariffPrice: number | undefined = undefined
    if (tariff.price !== undefined && tariff.price !== null) {
      if (typeof tariff.price === 'string' && tariff.price !== '') {
        tariffPrice = parseFloat(tariff.price)
      } else if (typeof tariff.price === 'number') {
        tariffPrice = tariff.price
      }
    } else if (tariff.price_rub !== undefined && tariff.price_rub !== null) {
      if (typeof tariff.price_rub === 'string' && tariff.price_rub !== '') {
        tariffPrice = parseFloat(tariff.price_rub)
      } else if (typeof tariff.price_rub === 'number') {
        tariffPrice = tariff.price_rub
      }
    }
    
    const tariffDuration = tariff.duration_days || tariff.duration || 0
    const trafficLimit = tariff.traffic_limit !== undefined && tariff.traffic_limit !== null 
      ? tariff.traffic_limit 
      : (tariff.max_traffic !== undefined && tariff.max_traffic !== null ? tariff.max_traffic : null)
    
    let maxTrafficGB: string | null = null
    if (trafficLimit !== null && trafficLimit !== undefined && trafficLimit > 0) {
      maxTrafficGB = Number(trafficLimit).toFixed(2)
    }
    
    const maxDevices = tariff.device_limit !== undefined && tariff.device_limit !== null
      ? tariff.device_limit
      : (tariff.max_devices !== undefined && tariff.max_devices !== null ? tariff.max_devices : null)
    
    let isEnabled = true
    if ('is_enabled' in tariff && tariff.is_enabled !== undefined && tariff.is_enabled !== null) {
      isEnabled = tariff.is_enabled === true || tariff.is_enabled === 'true' || tariff.is_enabled === 1
    } else if ('enabled' in tariff && tariff.enabled !== undefined && tariff.enabled !== null) {
      isEnabled = tariff.enabled === true || tariff.enabled === 'true' || tariff.enabled === 1
    } else if ('active' in tariff && tariff.active !== undefined && tariff.active !== null) {
      isEnabled = tariff.active === true || tariff.active === 'true' || tariff.active === 1
    } else if ('is_active' in tariff && tariff.is_active !== undefined && tariff.is_active !== null) {
      isEnabled = tariff.is_active === true || tariff.is_active === 'true' || tariff.is_active === 1
    }
    
    return {
      name: tariffName,
      price: tariffPrice,
      duration: tariffDuration,
      trafficGB: maxTrafficGB,
      devices: maxDevices,
      isEnabled,
      tariff
    }
  }

  const handleCreate = () => {
    setEditingTariff(null)
    setShowModal(true)
  }

  const handleEdit = (tariff: Tariff) => {
    setEditingTariff(tariff)
    setShowModal(true)
  }

  const handleDelete = (tariff: Tariff) => {
    setDeleteConfirm({ isOpen: true, tariff })
  }

  const handleToggleStatus = async (tariff: Tariff) => {
    const tariffIdKey = String(tariff.id ?? tariff.tariff_id ?? tariff.name ?? tariff.tariff_name ?? '')
    setToggling((prev) => new Set(prev).add(tariffIdKey))
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        return
      }

      // Определяем текущий статус
      const currentStatus = tariff.is_enabled !== undefined 
        ? Boolean(tariff.is_enabled) 
        : (tariff.enabled !== undefined 
          ? Boolean(tariff.enabled) 
          : (tariff.active !== undefined 
            ? Boolean(tariff.active) 
            : (tariff.is_active !== undefined ? Boolean(tariff.is_active) : true)))
      
      const newStatus = !currentStatus
      const tariffId = tariff.id ?? tariff.tariff_id
      const originalName = tariff.name || tariff.tariff_name
      
      if (typeof tariffId !== 'number' || !Number.isFinite(tariffId)) {
        // Fallback (old API by name) — can crash if duplicates exist in DB.
        if (!originalName) {
          setError('Не удалось определить тариф для обновления (нет id/name)')
          return
        }
        await updateBotTariff(config, originalName, { is_active: newStatus })
        setTariffs(prevTariffs =>
          prevTariffs.map(t => {
            if ((t.name || t.tariff_name) === originalName) {
              return { ...t, is_active: newStatus, is_enabled: newStatus, enabled: newStatus, active: newStatus }
            }
            return t
          }),
        )
        return
      }

      // Обновляем статус через API
      await updateBotTariffById(config, tariffId, { is_active: newStatus } as any)
      
      // Обновляем локальное состояние
      setTariffs(prevTariffs => 
        prevTariffs.map(t => {
          const tid = (t.id ?? t.tariff_id)
          if (tid === tariffId) {
            return { ...t, is_active: newStatus, is_enabled: newStatus, enabled: newStatus, active: newStatus }
          }
          return t
        })
      )
    } catch (err: any) {
      setError(err.message || 'Ошибка обновления статуса тарифа')
    } finally {
      setToggling((prev) => {
        const next = new Set(prev)
        next.delete(tariffIdKey)
        return next
      })
    }
  }

  const confirmDelete = async () => {
    if (!deleteConfirm.tariff) return
    
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setDeleteConfirm({ isOpen: false, tariff: null })
        return
      }

      const tariffId = deleteConfirm.tariff.id ?? deleteConfirm.tariff.tariff_id
      if (typeof tariffId === 'number' && Number.isFinite(tariffId)) {
        await deleteBotTariffById(config, tariffId)
      } else {
        // Fallback (old API by name)
        const tariffName = deleteConfirm.tariff.name || deleteConfirm.tariff.tariff_name
        if (!tariffName) {
          setError('Не удалось определить тариф для удаления (нет id/name)')
          setDeleteConfirm({ isOpen: false, tariff: null })
          return
        }
        await deleteBotTariff(config, tariffName)
      }

      await loadTariffs()
      setDeleteConfirm({ isOpen: false, tariff: null })
    } catch (err: any) {
      setError(err.message || 'Ошибка удаления тарифа')
      setDeleteConfirm({ isOpen: false, tariff: null })
    }
  }

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupName)) {
        newSet.delete(groupName)
      } else {
        newSet.add(groupName)
      }
      return newSet
    })
  }


  // Получаем список существующих групп
  const existingGroups = useMemo(() => {
    const groups = new Set<string>()
    tariffs.forEach((tariff) => {
      const group = tariff.group_code || tariff.group || (tariff.subgroup ? String(tariff.subgroup) : null) || tariff.category
      if (group) {
        groups.add(String(group))
      }
    })
    return Array.from(groups).sort()
  }, [tariffs])

  // Рендер тарифов
  const renderTariffs = (groupTariffs: Tariff[]) => {
    return renderTableView(groupTariffs)
  }

  // Вариант 1: Таблица
  const renderTableView = (groupTariffs: Tariff[]) => (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block w-full overflow-x-auto">
        <table className="w-full min-w-[980px] text-left" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead className="border-b border-default bg-overlay-md">
            <tr className="text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-3 font-semibold">Название</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Дни</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Трафик</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Устройства</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Цена</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap">Статус</th>
              <th className="px-3 py-3 font-semibold whitespace-nowrap text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {groupTariffs.map((tariff) => {
              const data = getTariffData(tariff)
              const tariffId = `${tariff.id || tariff.tariff_id || data.name}`
              return (
                <tr key={tariffId} className="hover:bg-overlay-xs transition-colors">
                  <td className="px-3 py-3 text-sm font-semibold text-primary truncate" title={data.name}>
                    {data.name}
                  </td>
                  <td className="px-3 py-3 text-sm text-muted/85 whitespace-nowrap">{data.duration > 0 ? `${data.duration} дн` : '—'}</td>
                  <td className="px-3 py-3 text-sm text-muted/85 whitespace-nowrap">
                    {data.trafficGB && parseFloat(data.trafficGB) > 0 ? `${data.trafficGB} ГБ` : 'Безлимит'}
                  </td>
                  <td className="px-3 py-3 text-sm text-muted/85 whitespace-nowrap">
                    {data.devices !== null && data.devices > 0 ? data.devices : 'Безлимит'}
                  </td>
                  <td className="px-3 py-3 text-sm font-semibold text-primary whitespace-nowrap">
                    {data.price !== undefined && !isNaN(data.price) ? `${data.price} ₽` : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <NeoToggle
                        checked={data.isEnabled}
                        disabled={toggling.has(String(tariff.id ?? tariff.tariff_id ?? tariff.name ?? tariff.tariff_name ?? ''))}
                        onChange={() => handleToggleStatus(tariff)}
                        width={60}
                        height={28}
                        showStatus={false}
                      />
                      <span className={`text-xs font-semibold ${data.isEnabled ? 'text-emerald-400' : 'text-rose-300'}`} style={{ minWidth: 44 }}>
                        {data.isEnabled ? 'ВКЛ' : 'ВЫКЛ'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1 flex-shrink-0">
                      <EditButton size="sm" onClick={() => handleEdit(tariff)} ariaLabel="Редактировать тариф" title="Редактировать" />
                      <DeleteButton size="sm" onClick={() => handleDelete(tariff)} ariaLabel="Удалить тариф" title="Удалить" variant="big" />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden divide-y divide-white/[0.05]">
        {groupTariffs.map((tariff) => {
          const data = getTariffData(tariff)
          const tariffId = `${tariff.id || tariff.tariff_id || data.name}`
          return (
            <div key={tariffId} className="py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-secondary/92 truncate" title={data.name}>
                    {data.name}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted/70">
                    <span>
                      <span className="text-muted/45">Дни:</span> {data.duration > 0 ? `${data.duration} дн` : '—'}
                    </span>
                    <span>
                      <span className="text-muted/45">Трафик:</span> {data.trafficGB && parseFloat(data.trafficGB) > 0 ? `${data.trafficGB} ГБ` : 'Безлимит'}
                    </span>
                    <span>
                      <span className="text-muted/45">Устройства:</span> {data.devices !== null && data.devices > 0 ? data.devices : 'Безлимит'}
                    </span>
                    <span>
                      <span className="text-muted/45">Цена:</span> {data.price !== undefined && !isNaN(data.price) ? `${data.price} ₽` : '—'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <NeoToggle
                    checked={data.isEnabled}
                    disabled={toggling.has(String(tariff.id ?? tariff.tariff_id ?? tariff.name ?? tariff.tariff_name ?? ''))}
                    onChange={() => handleToggleStatus(tariff)}
                    width={56}
                    height={26}
                    showStatus={false}
                  />
                  <div className="flex items-center gap-1">
                    <EditButton size="sm" onClick={() => handleEdit(tariff)} ariaLabel="Редактировать тариф" title="Редактировать" />
                    <DeleteButton size="sm" onClick={() => handleDelete(tariff)} ariaLabel="Удалить тариф" title="Удалить" variant="big" />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )

  return (
    <>
      {/* Page wrapper (фон страницы, без отдельной "панели" поверх) */}
      <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2 mb-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/bot-settings?tab=tariffs"
              className="px-3 sm:px-4 py-2 min-h-[44px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-[10px] flex items-center gap-2 text-sm font-medium border border-blue-500/30 transition-all hover:scale-105 active:scale-95 touch-manipulation"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">Настройки тарификации</span>
            </Link>
            <button
              onClick={handleCreate}
              className="btn-create px-4 py-2 min-h-[44px] rounded-[10px] flex items-center gap-2 text-sm font-medium touch-manipulation"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Создать тариф</span>
              <span className="sm:hidden">Создать</span>
            </button>
          </div>
        </div>

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
          <div className="p-2">
            <CapybaraLoader />
          </div>
        ) : Object.keys(groupedTariffs).length === 0 ? (
          <div className="p-2">
            <p className="text-center py-6 text-xs">Нет тарифов</p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-5">
            {Object.entries(groupedTariffs).map(([groupName, subgroups]) => {
              const totalTariffs = Object.values(subgroups).reduce((sum, tariffs) => sum + tariffs.length, 0)
              const isOpen = expandedGroups.has(groupName)
              return (
                <div key={groupName} className="glass-panel p-4 sm:p-5">
                  <button
                    onClick={() => toggleGroup(groupName)}
                    className="w-full flex items-center justify-between gap-3 pb-3 border-b border-default"
                    aria-label={`${isOpen ? 'Свернуть' : 'Развернуть'} группу ${groupName}`}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <div className="text-sm sm:text-base font-extrabold tracking-wide uppercase text-secondary truncate">
                        {groupName}
                      </div>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded flex-shrink-0 border border-sky-400/40 bg-sky-500/15 text-sky-400 dark:text-sky-200">
                        {totalTariffs} {totalTariffs === 1 ? 'тариф' : totalTariffs < 5 ? 'тарифа' : 'тарифов'}
                      </span>
                    </div>
                    <svg
                      className={`w-5 h-5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      style={{ color: undefined }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isOpen ? (
                    <div className="pt-3">
                      {Object.entries(subgroups).map(([subgroupName, subgroupTariffs]) => {
                        const subgroupKey = `${groupName}::${subgroupName}`
                        const isRealSubgroup = subgroupName !== 'Без подгруппы' && subgroupName !== '' && String(subgroupName).trim() !== ''
                        if (!isRealSubgroup) {
                          return (
                            <div key={subgroupKey} className="pt-1">
                              {renderTariffs(subgroupTariffs)}
                            </div>
                          )
                        }

                        return (
                          <div key={subgroupKey} className="pt-4">
                            <div className="flex items-center gap-2 pb-2 border-b border-default">
                              <div className="text-xs sm:text-sm font-semibold text-secondary truncate">{subgroupName}</div>
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded border border-sky-400/25 bg-sky-500/12 text-sky-200">
                                {subgroupTariffs.length}
                              </span>
                            </div>
                            <div className="pt-2">{renderTariffs(subgroupTariffs)}</div>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {/* Модальное окно создания/редактирования тарифа */}
        {showModal && (
          <TariffEditModal
            editingTariff={editingTariff || undefined}
            existingGroups={existingGroups}
            onClose={() => {
              setShowModal(false)
              setEditingTariff(null)
            }}
            onSaved={() => {
              setShowModal(false)
              setEditingTariff(null)
              loadTariffs()
            }}
          />
        )}

        {/* Модальное окно подтверждения удаления */}
        {deleteConfirm.isOpen && (
          <ConfirmModal
            isOpen={deleteConfirm.isOpen}
            title="Удаление тарифа"
            message={`Вы уверены, что хотите удалить тариф "${deleteConfirm.tariff?.name || deleteConfirm.tariff?.tariff_name}"?`}
            onConfirm={confirmDelete}
            onCancel={() => setDeleteConfirm({ isOpen: false, tariff: null })}
          />
        )}
      </div>
      {/* End page wrapper */}
    </>
  )
}
