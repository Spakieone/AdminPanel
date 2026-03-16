import { useState, useEffect, useCallback } from 'react'
import {
  getRemnawaveHosts,
  getRemnawaveInbounds,
  updateRemnawaveHost,
  deleteRemnawaveHost,
} from '../api/client'
import * as Flags from 'country-flag-icons/react/3x2'
import ConfirmModal from '../components/common/ConfirmModal'
import HostEditModal from '../components/remnawave/HostEditModal'
import NeoToggle from '../components/common/NeoToggle'
import DeleteButton from '../components/ui/DeleteButton'
import EditButton from '../components/ui/EditButton'
import { useRwProfile } from '../hooks/useRwProfile'

const getFlagComponent = (countryCode: string) => {
  if (!countryCode || countryCode.length !== 2) return null
  const flagName = countryCode.toUpperCase() as keyof typeof Flags
  return (Flags[flagName] as React.ComponentType<{ className?: string }>) || null
}

export default function RwHosts() {
  const { profileId } = useRwProfile()
  const [hosts, setHosts] = useState<any[]>([])
  const [inbounds, setInbounds] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hostSearchQuery, setHostSearchQuery] = useState('')
  const [hostToggleLoading, setHostToggleLoading] = useState<Record<string, boolean>>({})

  // Modals
  const [showHostModal, setShowHostModal] = useState(false)
  const [editingHost, setEditingHost] = useState<any>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; host: any }>({ isOpen: false, host: null })

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const pid = profileId || undefined

      const hostsResponse: any = await getRemnawaveHosts(pid)
      let hostsList: any[] = []
      if (hostsResponse?.response && Array.isArray(hostsResponse.response)) hostsList = hostsResponse.response
      else if (hostsResponse?.response?.hosts) hostsList = hostsResponse.response.hosts
      else if (Array.isArray(hostsResponse)) hostsList = hostsResponse
      else if (hostsResponse?.hosts) hostsList = hostsResponse.hosts
      else if (hostsResponse?.data) hostsList = hostsResponse.data
      setHosts(hostsList)

      try {
        const inboundsData: any = await getRemnawaveInbounds(pid)
        let list: any[] = []
        if (inboundsData?.response && Array.isArray(inboundsData.response)) list = inboundsData.response
        else if (inboundsData?.response?.inbounds) list = inboundsData.response.inbounds
        else if (Array.isArray(inboundsData)) list = inboundsData
        else if (inboundsData?.data) list = inboundsData.data
        setInbounds(list)
      } catch {
        // ignore inbounds error
      }
    } catch (err: any) {
      if (err.message?.includes('not configured') || err.message?.includes('400')) {
        setError('Remnawave не настроен. Настройте профиль в разделе "Настройки".')
      } else {
        setError(err.message || 'Ошибка загрузки хостов')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [profileId])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const interval = setInterval(() => loadData(true), 30000)
    return () => clearInterval(interval)
  }, [loadData])

  // Helpers
  const getHostKey = (host: any, index?: number) => String(host?.uuid || host?.id || index || '')
  const isHostActive = (host: any) => {
    if (typeof host?.isDisabled === 'boolean') return !host.isDisabled
    if (typeof host?.enabled === 'boolean') return host.enabled
    return true
  }

  const toggleHost = async (host: any, key: string) => {
    if (!key || hostToggleLoading[key]) return
    setHostToggleLoading(prev => ({ ...prev, [key]: true }))
    try {
      const pid = profileId || undefined
      const hostId = host?.uuid || host?.id
      if (!hostId) throw new Error('ID хоста не найден')
      const active = isHostActive(host)
      await updateRemnawaveHost(pid, hostId, { isDisabled: active })
      await loadData(true)
    } catch (err: any) {
      setError(err.message || 'Ошибка изменения статуса')
    } finally {
      setHostToggleLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  const handleDeleteHost = async () => {
    if (!deleteConfirm.host) return
    try {
      const pid = profileId || undefined
      const hostId = deleteConfirm.host.id || deleteConfirm.host.uuid
      await deleteRemnawaveHost(pid, hostId)
      setDeleteConfirm({ isOpen: false, host: null })
      loadData(true)
    } catch (err: any) {
      setError(err.message || 'Ошибка удаления хоста')
      setDeleteConfirm({ isOpen: false, host: null })
    }
  }

  // Inbounds lookup
  const inboundsByUuid: Record<string, any> = {}
  for (const ib of inbounds) {
    const uuid = String(ib?.uuid || ib?.id || '').trim()
    if (uuid) {
      inboundsByUuid[uuid] = ib
      if (ib?.profileUuid) inboundsByUuid[`${ib.profileUuid}|${uuid}`] = ib
    }
  }

  const resolveInbound = (host: any) => {
    const inbound = host?.inbound || host?.inboundConfig || null
    const inboundUuid = inbound?.configProfileInboundUuid || inbound?.uuid || inbound?.id || null
    const profileUuid = inbound?.configProfileUuid || inbound?.profileUuid || null
    if (!inboundUuid) return null
    let ib = profileUuid ? inboundsByUuid[`${profileUuid}|${inboundUuid}`] : null
    if (!ib) ib = inboundsByUuid[inboundUuid]
    return ib
  }

  // Filter
  const filteredHosts = hosts.filter(host => {
    if (!hostSearchQuery) return true
    const q = hostSearchQuery.toLowerCase()
    return (
      (host.address || '').toLowerCase().includes(q) ||
      (host.port || '').toString().includes(q) ||
      (host.remark || host.name || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">Хосты Remnawave</h1>
          <p className="text-sm text-muted mt-0.5">Управление хостами и инбаундами</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => loadData()} disabled={loading} className="px-3 py-1.5 text-xs rounded-xl border border-default text-muted hover:text-dim disabled:opacity-40">↻</button>
          <button onClick={() => { setEditingHost(null); setShowHostModal(true) }} className="px-3 py-1.5 text-xs rounded-xl border border-[var(--accent)]/30 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors">+ Создать хост</button>
        </div>
      </div>

      {error && (
        <div className="glass-card p-3 rounded-xl border border-red-500/20 text-red-400 text-sm">{error}
          <button onClick={() => setError('')} className="ml-2 text-muted hover:text-dim">✕</button>
        </div>
      )}

      {/* Search */}
      {hosts.length > 0 && (
        <input
          type="text"
          value={hostSearchQuery}
          onChange={(e) => setHostSearchQuery(e.target.value)}
          placeholder="Поиск по адресу, порту, примечанию..."
          className="w-full sm:w-80 px-3 py-2 bg-overlay-xs border border-default rounded-xl text-primary text-sm placeholder:text-faint focus:outline-none focus:border-[var(--accent)]"
        />
      )}

      {loading ? (
        <>
          {/* Desktop skeleton */}
          <div className="hidden md:block glass-card rounded-xl overflow-hidden">
            <table className="w-full text-left" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '18%' }} /><col style={{ width: '8%' }} /><col style={{ width: '18%' }} />
                <col style={{ width: '15%' }} /><col style={{ width: '12%' }} /><col style={{ width: '29%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Адрес</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Порт</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Инбаунд</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Примечание</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Статус</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted">Действия</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="px-3 py-2.5"><div className="h-4 w-28 bg-overlay-xs rounded animate-pulse" /><div className="h-3 w-16 bg-overlay-xs rounded mt-1.5 animate-pulse" /></td>
                    <td className="px-3 py-2.5"><div className="h-4 w-10 bg-overlay-xs rounded animate-pulse" /></td>
                    <td className="px-3 py-2.5"><div className="h-4 w-20 bg-overlay-xs rounded animate-pulse" /></td>
                    <td className="px-3 py-2.5"><div className="h-4 w-16 bg-overlay-xs rounded animate-pulse" /></td>
                    <td className="px-3 py-2.5"><div className="h-7 w-14 bg-overlay-xs rounded-full animate-pulse" /></td>
                    <td className="px-3 py-2.5"><div className="flex gap-1.5 justify-end"><div className="h-7 w-7 bg-overlay-xs rounded-lg animate-pulse" /><div className="h-7 w-7 bg-overlay-xs rounded-lg animate-pulse" /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile skeleton */}
          <div className="md:hidden space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card p-3 rounded-xl animate-pulse">
                <div className="flex items-start justify-between mb-2">
                  <div><div className="h-4 w-32 bg-overlay-xs rounded mb-2" /><div className="h-3 w-20 bg-overlay-xs rounded" /></div>
                  <div className="h-7 w-14 bg-overlay-xs rounded-full" />
                </div>
                <div className="space-y-1.5"><div className="h-3 w-40 bg-overlay-xs rounded" /><div className="h-3 w-32 bg-overlay-xs rounded" /></div>
                <div className="mt-2 flex gap-2"><div className="flex-1 h-8 bg-overlay-xs rounded-lg" /><div className="flex-1 h-8 bg-overlay-xs rounded-lg" /></div>
              </div>
            ))}
          </div>
        </>
      ) : hosts.length === 0 ? (
        <div className="text-center py-10 text-faint">Нет хостов</div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block glass-card rounded-xl overflow-hidden">
            <table className="w-full text-left" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '18%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '29%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Адрес</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Порт</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Инбаунд</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Примечание</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted">Статус</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredHosts.map((host: any, index: number) => {
                  const key = getHostKey(host, index)
                  const active = isHostActive(host)
                  const busy = hostToggleLoading[key] === true
                  const ib = resolveInbound(host)
                  const remark = String(host.remark || host.name || '').trim()
                  const match = remark.match(/^([A-Z]{2})(\s|$)/)
                  const FlagComponent = match ? getFlagComponent(match[1]) : null

                  return (
                    <tr key={key} className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.02] transition-colors" style={{ animation: 'fadeInUp 0.25s ease-out both', animationDelay: `${index * 0.03}s` }}>
                      <td className="px-3 py-2.5">
                        <div className="text-primary text-sm font-mono">{host.address || '-'}</div>
                        {host.id && <div className="text-faint text-xs mt-0.5">ID: {host.id}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-dim text-sm">{host.port || '-'}</td>
                      <td className="px-3 py-2.5">
                        {ib ? (
                          <div className="text-dim text-sm">
                            <div className="font-medium">{ib.tag || ib.name || ib.type || 'Unnamed'}</div>
                            {ib.port && <div className="text-faint text-xs mt-0.5">:{ib.port}</div>}
                          </div>
                        ) : (
                          <div className="text-faint text-sm italic">По умолчанию</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {FlagComponent && <FlagComponent className="w-4 h-3 rounded-sm flex-shrink-0" />}
                          <span className="text-dim text-sm truncate" title={remark}>{remark || '-'}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <NeoToggle checked={active} disabled={busy} onChange={() => !busy && toggleHost(host, key)} width={60} height={28} showStatus={false} />
                          <span className={`text-sm font-medium ${active ? 'text-emerald-400' : 'text-red-400'}`}>{active ? 'Вкл' : 'Выкл'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <EditButton size="sm" onClick={() => { setEditingHost(host); setShowHostModal(true) }} ariaLabel="Редактировать хост" title="Редактировать" />
                          <DeleteButton size="sm" onClick={() => setDeleteConfirm({ isOpen: true, host })} ariaLabel="Удалить хост" title="Удалить" variant="big" />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {filteredHosts.map((host: any, index: number) => {
              const key = getHostKey(host, index)
              const active = isHostActive(host)
              const busy = hostToggleLoading[key] === true
              const ib = resolveInbound(host)
              const remark = host.remark || host.name || '-'
              const match = remark.match(/^([A-Z]{2})\s/)
              const FlagComponent = match ? getFlagComponent(match[1]) : null

              return (
                <div key={key} className="glass-card p-3 rounded-xl" style={{ animation: 'fadeInUp 0.3s ease-out both', animationDelay: `${index * 0.05}s` }}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="text-primary text-sm font-semibold font-mono mb-1">{host.address || '-'}</div>
                      {host.id && <div className="text-faint text-[10px] mb-1">ID: {host.id}</div>}
                      <div className="text-muted text-xs">Порт: {host.port || '-'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <NeoToggle checked={active} disabled={busy} onChange={() => !busy && toggleHost(host, key)} width={60} height={28} showStatus={false} />
                      <span className={`text-xs font-medium ${active ? 'text-emerald-400' : 'text-red-400'}`}>{active ? 'Вкл' : 'Выкл'}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div>
                      <span className="text-muted">Инбаунд:</span>
                      {ib ? (
                        <span className="text-dim ml-1">{ib.tag || ib.name || ib.type}{ib.port ? ` :${ib.port}` : ''}</span>
                      ) : (
                        <span className="text-faint ml-1 italic">По умолчанию</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted">Примечание:</span>
                      {FlagComponent && <FlagComponent className="w-4 h-3 rounded-sm flex-shrink-0" />}
                      <span className="text-dim">{remark}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <EditButton size="sm" containerClassName="flex-1" className="w-full" onClick={() => { setEditingHost(host); setShowHostModal(true) }} ariaLabel="Редактировать" title="Редактировать" />
                    <DeleteButton size="sm" containerClassName="flex-1" className="w-full" onClick={() => setDeleteConfirm({ isOpen: true, host })} ariaLabel="Удалить" title="Удалить" variant="big" />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Host Edit/Create Modal */}
      {showHostModal && (
        <HostEditModal
          host={editingHost}
          inbounds={inbounds}
          onClose={() => { setShowHostModal(false); setEditingHost(null) }}
          onSaved={() => { setShowHostModal(false); setEditingHost(null); loadData() }}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm.isOpen && (
        <ConfirmModal
          isOpen={deleteConfirm.isOpen}
          title="Удаление хоста"
          message={`Вы уверены, что хотите удалить хост "${deleteConfirm.host?.address || deleteConfirm.host?.id}"?`}
          onConfirm={handleDeleteHost}
          onCancel={() => setDeleteConfirm({ isOpen: false, host: null })}
        />
      )}
    </div>
  )
}
