import { useState, useEffect } from 'react'
// Layout теперь применяется на уровне роутера (LayoutRoute)
import { getBotConfigAsync } from '../utils/botConfig'
import { getBotServers, deleteBotServer, updateBotServer } from '../api/botApi'
import ServerEditModal from '../components/servers/ServerEditModal'
import ConfirmModal from '../components/common/ConfirmModal'
import CapybaraLoader from '../components/common/CapybaraLoader'
import { GradientAlert } from '../components/common/GradientAlert'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import type { BotServer } from '../api/types'
import NeoToggle from '../components/common/NeoToggle'
import DeleteButton from '../components/ui/DeleteButton'
import EditButton from '../components/ui/EditButton'

export default function Servers({ embedded = false }: { embedded?: boolean } = {}) {
  const [servers, setServers] = useState<BotServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingServer, setEditingServer] = useState<BotServer | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{isOpen: boolean, server: BotServer | null}>({isOpen: false, server: null})
  const [serverToggleLoading, setServerToggleLoading] = useState<{[key: string]: boolean}>({})
  const missingProfile = Boolean(error && error.includes('Нет активного профиля'))
  const shellClass = embedded ? 'space-y-4' : 'w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-3 sm:p-4'

  useEffect(() => {
    loadServers()
  }, [])

  const loadServers = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setLoading(false)
        return
      }

      const data = await getBotServers(config)
      const serversList = Array.isArray(data) ? data : []
      setServers(serversList)
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка загрузки серверов'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingServer(null)
    setShowModal(true)
  }

  const handleEdit = (server: BotServer) => {
    setEditingServer(server)
    setShowModal(true)
  }

  const handleDelete = async () => {
    if (!deleteConfirm.server) return

    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        return
      }

      const identifier = deleteConfirm.server.server_name || deleteConfirm.server.name || deleteConfirm.server.id || deleteConfirm.server.server_id
      if (!identifier || identifier === '') {
        setError('Не удалось определить идентификатор сервера')
        return
      }

      await deleteBotServer(config, identifier as string | number)
      setDeleteConfirm({ isOpen: false, server: null })
      loadServers()
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка удаления сервера'
      setError(errorMessage)
    }
  }

  const handleToggleStatus = async (server: BotServer) => {
    const serverKey = String(server.id || server.server_id || '')
    if (!serverKey) {
      setError('Не удалось определить ключ сервера')
      return
    }

    setServerToggleLoading(prev => ({ ...prev, [serverKey]: true }))

    try {
      const config = await getBotConfigAsync()
      if (!config) {
        setError('Нет активного профиля. Создайте профиль в настройках.')
        setServerToggleLoading(prev => ({ ...prev, [serverKey]: false }))
        return
      }

      // API использует server_name как идентификатор, а не ID
      const identifier = server.server_name || server.name || server.id || server.server_id
      if (!identifier || identifier === '') {
        setError('Не удалось определить идентификатор сервера')
        setServerToggleLoading(prev => ({ ...prev, [serverKey]: false }))
        return
      }

      const currentStatus = server.enabled !== undefined ? server.enabled : (server.is_enabled !== undefined ? server.is_enabled : true)
      const newStatus = !currentStatus

      // API использует enabled, а не is_enabled (как в ServerEditModal)
      const updatedServer = await updateBotServer(config, identifier as string | number, {
        enabled: newStatus
      })

      // Обновляем локальное состояние на основе ответа API
      setServers(prevServers => 
        prevServers.map(s => {
          const sKey = String(s.id || s.server_id || '')
          const sIdentifier = s.server_name || s.name || s.id || s.server_id
          
          // Сравниваем по идентификатору, так как API использует server_name
          if (sIdentifier === identifier || sKey === serverKey) {
            const serverData = updatedServer as BotServer
            const updatedEnabled = serverData.enabled !== undefined && serverData.enabled !== null
              ? Boolean(serverData.enabled)
              : (serverData.is_enabled !== undefined && serverData.is_enabled !== null
                ? Boolean(serverData.is_enabled)
                : newStatus)
            return { ...s, enabled: updatedEnabled, is_enabled: updatedEnabled }
          }
          return s
        })
      )

      // Очищаем ошибку при успехе
      setError(null)
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка обновления статуса сервера'
      setError(errorMessage)
    } finally {
      setServerToggleLoading(prev => ({ ...prev, [serverKey]: false }))
    }
  }


  if (loading) {
    return (
      <div className={shellClass}>
        <div className={embedded ? 'flex justify-center items-center py-10' : 'flex justify-center items-center min-h-[400px]'}>
          <CapybaraLoader />
        </div>
      </div>
    )
  }

  return (
    <div className={shellClass}>
      <div className="flex items-center justify-end mb-4 sm:mb-6">
        <button
          onClick={handleCreate}
          className="px-3 sm:px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 border border-green-500/30 hover:scale-105 active:scale-95 text-sm sm:text-base"
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Создать сервер</span>
          <span className="sm:hidden">Создать</span>
        </button>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {servers.length === 0 ? (
          <div className="col-span-full text-center text-muted py-10 rounded-xl border border-default bg-overlay-xs">
            Нет серверов
          </div>
        ) : (
          servers.map((server) => {
            const serverId: string = String(server.id || server.server_id || '-')
            const serverName: string = String(server.server_name || server.name || '-')
            const clusterName: string = String(server.cluster_name || server.cluster || server.group || server.cluster_id || '-')
            const apiUrl: string = String(server.api_url || server.url_api || '-')
            const url3xUi: string = String(server.subscription_url || server.url_3x_ui || server.url_3xui || '-')
            const inboundId: string = String(server.inbound_id || server.inbound || '-')
            const panel: string = String(server.panel_type || server.panel || server.panel_name || '-')
            const keyLimit: number =
              server.max_keys !== undefined && server.max_keys !== null
                ? Number(server.max_keys)
                : server.key_limit !== undefined && server.key_limit !== null
                  ? Number(server.key_limit)
                  : 0
            const tariffGroup: string = String(server.tariff_group || server.group_code || server.group || '-')
            const isEnabled = server.enabled !== undefined ? server.enabled : (server.is_enabled !== undefined ? server.is_enabled : true)
            const serverKey = String(server.id || server.server_id || Math.random())

            return (
              <div key={serverKey}>
                <div
                  className="rounded-xl p-4 border border-default bg-overlay-xs hover:shadow-lg transition-colors duration-200 flex flex-col h-full"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-semibold text-primary truncate">{serverName}</h3>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        {(() => {
                          const key = String(serverKey)
                          const busy = serverToggleLoading[key] === true
                          return (
                            <>
                              <div
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                }}
                                className="flex-shrink-0"
                              >
                                <NeoToggle
                                  checked={Boolean(isEnabled)}
                                  disabled={busy}
                                  onChange={() => !busy && handleToggleStatus(server)}
                                  width={60}
                                  height={28}
                                  showStatus={false}
                                />
                              </div>
                              <span className={`text-sm font-medium whitespace-nowrap ${isEnabled ? 'text-green-400' : 'text-red-400'}`}>
                                {isEnabled ? 'Включен' : 'Выключен'}
                              </span>
                            </>
                          )
                        })()}
                      </div>
                      <div className="text-xs text-muted mb-3">ID: {serverId}</div>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 space-y-2.5 text-sm mb-3">
                    <div>
                      <span className="text-muted text-xs">Кластер:</span>
                      <p className="text-secondary break-all leading-snug">{clusterName}</p>
                    </div>
                    <div>
                      <span className="text-muted text-xs">Панeль:</span>
                      <p className="text-secondary break-all leading-snug">{panel}</p>
                    </div>
                    <div>
                      <span className="text-muted text-xs">URL API:</span>
                      <p className="text-secondary break-all leading-snug font-mono text-xs">{apiUrl}</p>
                    </div>
                    {url3xUi !== '-' && (
                      <div>
                        <span className="text-muted text-xs">URL 3X-UI:</span>
                        <p className="text-secondary break-all leading-snug font-mono text-xs">{url3xUi}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-muted text-xs">INBOUND ID:</span>
                      <p className="text-secondary break-all leading-snug font-mono text-xs">{inboundId}</p>
                    </div>
                    <div>
                      <span className="text-muted text-xs">Лимит ключей:</span>
                      <p className="text-secondary leading-snug">{keyLimit}</p>
                    </div>
                    <div>
                      <span className="text-muted text-xs">Группа тарифов:</span>
                      <p className="text-secondary break-all leading-snug">{tariffGroup}</p>
                    </div>
                  </div>

                  <div className="mt-auto pt-3 grid grid-cols-2 gap-2">
                    <EditButton
                      variant="big"
                      size="sm"
                      className="w-full"
                      onClick={() => handleEdit(server)}
                      ariaLabel="Редактировать сервер"
                      title="Редактировать"
                    />
                    <DeleteButton
                      size="sm"
                      className="w-full"
                      onClick={() => setDeleteConfirm({ isOpen: true, server })}
                      ariaLabel="Удалить сервер"
                      title="Удалить"
                      variant="big"
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

        {showModal && (
          <ServerEditModal
            editingServer={editingServer || undefined}
            onClose={() => {
              setShowModal(false)
              setEditingServer(null)
            }}
            onSaved={() => {
              setShowModal(false)
              setEditingServer(null)
              loadServers()
            }}
          />
        )}

        {deleteConfirm.isOpen && deleteConfirm.server && (
          <ConfirmModal
            isOpen={deleteConfirm.isOpen}
            title="Удалить сервер?"
            message={`Вы уверены, что хотите удалить сервер "${deleteConfirm.server.name || deleteConfirm.server.server_name || deleteConfirm.server.id || deleteConfirm.server.server_id}"?`}
            onConfirm={handleDelete}
            onCancel={() => setDeleteConfirm({ isOpen: false, server: null })}
          />
        )}
    </div>
  )
}

