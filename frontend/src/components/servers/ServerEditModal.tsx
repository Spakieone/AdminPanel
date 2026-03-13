import { useId, useMemo, useState, useEffect, useRef } from 'react'
import { getBotConfigAsync } from '../../utils/botConfig'
import { createBotServer, updateBotServer, getBotServers, getBotTariffs } from '../../api/botApi'
import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../common/ModalShell'
import DarkSelect, { type DarkSelectGroup } from '../common/DarkSelect'

interface ServerEditModalProps {
  editingServer?: any
  onClose: () => void
  onSaved: () => void
}

export default function ServerEditModal({ editingServer, onClose, onSaved }: ServerEditModalProps) {
  const formId = useId()
  const [formData, setFormData] = useState({
    name: '',
    cluster_name: '',
    cluster: '',
    group: '',
    api_url: '',
    url_3x_ui: '',
    inbound_id: '',
    panel: '',
    key_limit: '',
    tariff_group: '',
    is_enabled: true
  })
  const [existingClusters, setExistingClusters] = useState<string[]>([])
  const [tariffGroups, setTariffGroups] = useState<string[]>([])
  const [clusterInputMode, setClusterInputMode] = useState<'select' | 'input'>('select')
  const [clustersLoaded, setClustersLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const modeSetRef = useRef(false) // Отслеживаем, был ли режим установлен после загрузки списка

  const currentClusterValue = formData.cluster_name || formData.cluster || formData.group || ''

  const clusterGroups = useMemo<DarkSelectGroup[]>(() => {
    const opts: any[] = [{ value: '', label: '— выберите кластер —' }]
    existingClusters.forEach((c) => opts.push({ value: c, label: c }))
    if (
      editingServer &&
      clustersLoaded &&
      currentClusterValue &&
      !existingClusters.includes(currentClusterValue)
    ) {
      opts.push({ value: currentClusterValue, label: `${currentClusterValue} (не в списке)`, disabled: true })
    }
    return [{ options: opts }]
  }, [clustersLoaded, currentClusterValue, editingServer, existingClusters])

  const panelGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: '', label: '— выберите панель —' },
          { value: '3x-ui', label: '3x-ui' },
          { value: 'Remnawave', label: 'Remnawave' },
        ],
      },
    ],
    [],
  )

  const tariffGroupGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [{ value: '', label: '— без группы —' }, ...tariffGroups.map((g) => ({ value: g, label: g }))],
      },
    ],
    [tariffGroups],
  )

  const yesNoGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: 'yes', label: 'Да' },
          { value: 'no', label: 'Нет' },
        ],
      },
    ],
    [],
  )

  // Загружаем существующие кластеры и группы тарифов один раз
  useEffect(() => {
    const loadData = async () => {
      try {
        const config = await getBotConfigAsync()
        if (!config) return

        const [serversData, tariffsData] = await Promise.all([
          getBotServers(config).catch(() => []),
          getBotTariffs(config).catch(() => [])
        ])
        
        const serversList = Array.isArray(serversData) ? serversData : []
        const tariffsList = Array.isArray(tariffsData) ? tariffsData : []
        
        // Извлекаем уникальные кластеры
        const clusters = new Set<string>()
        serversList.forEach((server) => {
          const cluster = (server.cluster_name || server.cluster || server.group || server.cluster_id) as string | undefined
          const serverName = (server.name || server.server_name || server.id) as string | number | undefined
          if (cluster && typeof cluster === 'string' && cluster !== String(serverName)) {
            clusters.add(cluster)
          }
        })
        
        setExistingClusters(Array.from(clusters).sort())
        
        // Извлекаем уникальные группы тарифов
        const groups = new Set<string>()
        tariffsList.forEach((tariff) => {
          const group = (tariff.group_code || tariff.group || tariff.subgroup || tariff.category) as string | undefined
          if (group && typeof group === 'string') {
            groups.add(group)
          }
        })
        
        setTariffGroups(Array.from(groups).sort())
        setClustersLoaded(true)
      } catch {
        // Игнорируем ошибки загрузки
      }
    }

    loadData()
  }, [])

  // Заполняем форму при изменении editingServer
  useEffect(() => {
    if (editingServer) {
      const cluster = editingServer.cluster_name || editingServer.cluster || editingServer.group || editingServer.cluster_id || ''
      
      const isEnabled = editingServer.is_enabled !== undefined 
        ? editingServer.is_enabled 
        : (editingServer.enabled !== undefined ? editingServer.enabled : true)
      
      const panelValue = editingServer.panel_type || editingServer.panel || editingServer.panel_name || ''
      let normalizedPanel = panelValue
      // Нормализуем значение панели для соответствия опциям select
      if (panelValue.toLowerCase() === 'remnawave' || panelValue.toLowerCase() === 'remna') {
        normalizedPanel = 'Remnawave'
      } else if (panelValue.toLowerCase() === '3x-ui' || panelValue.toLowerCase() === '3xui') {
        normalizedPanel = '3x-ui'
      }
      
      setFormData({
        name: editingServer.server_name || editingServer.name || '',
        cluster_name: cluster,
        cluster: cluster,
        group: cluster,
        api_url: editingServer.api_url || editingServer.url_api || '',
        url_3x_ui: editingServer.subscription_url || editingServer.url_3x_ui || editingServer.url_3xui || '',
        inbound_id: editingServer.inbound_id || editingServer.inbound || '',
        panel: normalizedPanel,
        key_limit: (editingServer.max_keys !== undefined && editingServer.max_keys !== null ? editingServer.max_keys : (editingServer.key_limit !== undefined && editingServer.key_limit !== null ? editingServer.key_limit : 0)).toString(),
        tariff_group: editingServer.tariff_group || editingServer.group_code || editingServer.group || '',
        is_enabled: isEnabled
      })
    } else {
      // Сброс формы при создании нового сервера
      setFormData({
        name: '',
        cluster_name: '',
        cluster: '',
        group: '',
        api_url: '',
        url_3x_ui: '',
        inbound_id: '',
        panel: '',
        key_limit: '0',
        tariff_group: '',
        is_enabled: true
      })
      setClusterInputMode('select')
    }
  }, [editingServer])

  // Устанавливаем режим кластера только один раз после загрузки списка, чтобы избежать "прыгания"
  useEffect(() => {
    // Если список еще не загружен, используем 'select' по умолчанию
    // и не устанавливаем финальный режим, чтобы избежать "прыгания"
    if (!clustersLoaded) {
      if (!modeSetRef.current) {
        setClusterInputMode('select')
      }
      return
    }

    // Список загружен - устанавливаем правильный режим только один раз
    if (!modeSetRef.current && editingServer) {
      const cluster = formData.cluster_name || formData.cluster || formData.group || ''
      
      if (cluster) {
        // Проверяем наличие кластера в списке и устанавливаем финальный режим
        const isInExistingClusters = existingClusters.includes(cluster)
        setClusterInputMode(isInExistingClusters ? 'select' : 'input')
        modeSetRef.current = true // Помечаем, что режим установлен
      } else {
        setClusterInputMode('select')
        modeSetRef.current = true
      }
    } else if (!editingServer) {
      setClusterInputMode('select')
      modeSetRef.current = true
    }
  }, [clustersLoaded, existingClusters, editingServer, formData.cluster_name, formData.cluster, formData.group])

  // Сбрасываем флаг при смене editingServer
  useEffect(() => {
    modeSetRef.current = false
  }, [editingServer])

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

      const serverData: any = {}
      
      // Название сервера - API использует server_name (обязательное)
      if (formData.name) {
        serverData.server_name = formData.name
      } else if (!editingServer) {
        setError('Название сервера обязательно')
        setLoading(false)
        return
      }
      
      // Кластер - API использует cluster_name (обязательное)
      const clusterValue = formData.cluster_name || formData.cluster || formData.group
      if (clusterValue) {
        serverData.cluster_name = clusterValue
      } else if (!editingServer) {
        setError('Кластер обязателен')
        setLoading(false)
        return
      }
      
      // URL API - API использует api_url (обязательное)
      if (formData.api_url) {
        serverData.api_url = formData.api_url
      } else if (!editingServer) {
        setError('API URL обязателен')
        setLoading(false)
        return
      }
      
      // URL 3X-UI - API использует subscription_url (опциональное)
      if (formData.url_3x_ui) {
        serverData.subscription_url = formData.url_3x_ui
      }
      
      // Inbound ID - API использует inbound_id (обязательное)
      if (formData.inbound_id) {
        serverData.inbound_id = formData.inbound_id
      } else if (!editingServer) {
        setError('Inbound ID обязателен')
        setLoading(false)
        return
      }
      
      // Панель - API использует panel_type (обязательное)
      if (formData.panel) {
        serverData.panel_type = formData.panel
      } else if (!editingServer) {
        setError('Панель обязательна')
        setLoading(false)
        return
      }
      
      // Лимит ключей - API использует max_keys (опциональное)
      if (formData.key_limit !== '' && formData.key_limit !== null && formData.key_limit !== undefined) {
        serverData.max_keys = parseInt(formData.key_limit) || 0
      } else {
        serverData.max_keys = 0
      }
      
      // Группа тарифов (опциональное)
      if (formData.tariff_group) {
        serverData.tariff_group = formData.tariff_group
      } else {
        serverData.tariff_group = ""
      }
      
      // Статус включен/выключен - API использует enabled (опциональное, по умолчанию true)
      serverData.enabled = Boolean(formData.is_enabled)

      if (editingServer) {
        // Обновление существующего сервера
        // API использует server_name как идентификатор, а не ID
        const identifier = editingServer.server_name || editingServer.name || editingServer.id || editingServer.server_id
        
        if (!identifier) {
          setError('Не удалось определить идентификатор сервера для обновления')
          setLoading(false)
          return
        }
        
        await updateBotServer(config, identifier, serverData)
      } else {
        // Создание нового сервера
        await createBotServer(config, serverData)
      }

      onSaved()
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения сервера')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      title={editingServer ? 'Редактирование сервера' : 'Создание сервера'}
      subtitle={editingServer ? 'Измените параметры и сохраните' : 'Заполните параметры и создайте новый сервер'}
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
            d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
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
            {loading ? 'Сохранение...' : editingServer ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Имя:</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 focus:border-default text-primary text-sm"
              placeholder="Например: Server-1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Кластер:</label>
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <DarkSelect
                    value={clusterInputMode === 'input' ? '' : currentClusterValue}
                    disabled={clusterInputMode === 'input'}
                    onChange={(v) => {
                      if (v) {
                        setFormData({
                          ...formData,
                          cluster_name: v,
                          cluster: v,
                          group: v,
                        })
                        setClusterInputMode('select')
                      }
                    }}
                    groups={clusterGroups}
                    buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                {clusterInputMode === 'select' && (
                  <button
                    type="button"
                    onClick={() => {
                      setClusterInputMode('input')
                      setFormData({ 
                        ...formData, 
                        cluster_name: '',
                        cluster: '',
                        group: ''
                      })
                    }}
                    className={modalSecondaryButtonClass}
                  >
                    Добавить новый
                  </button>
                )}
              </div>
              {clusterInputMode === 'input' && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={formData.cluster_name || formData.cluster || formData.group || ''}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      cluster_name: e.target.value,
                      cluster: e.target.value,
                      group: e.target.value
                    })}
                    className="flex-1 px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary"
                    placeholder="Введите название кластера"
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setClusterInputMode('select')
                      setFormData({ 
                        ...formData, 
                        cluster_name: '',
                        cluster: '',
                        group: ''
                      })
                    }}
                    className={modalSecondaryButtonClass}
                  >
                    Отмена
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">API URL:</label>
            <input
              type="url"
              value={formData.api_url}
              onChange={(e) => setFormData({ ...formData, api_url: e.target.value })}
              className="w-full px-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 focus:border-default text-primary text-sm"
              placeholder="https://panel.example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">URL 3x-ui:</label>
            <input
              type="url"
              value={formData.url_3x_ui}
              onChange={(e) => setFormData({ ...formData, url_3x_ui: e.target.value })}
              className="w-full px-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 focus:border-default text-primary text-sm"
              placeholder="https://3x-ui.example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Inbound ID:</label>
            <input
              type="text"
              value={formData.inbound_id}
              onChange={(e) => setFormData({ ...formData, inbound_id: e.target.value })}
              className="w-full px-2.5 sm:px-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500/50 text-primary text-xs sm:text-sm font-mono"
              placeholder="6d782b2e-89b2-..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Панель:</label>
            <DarkSelect
              value={formData.panel}
              onChange={(v) => setFormData({ ...formData, panel: v })}
              groups={panelGroups}
              buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Лимит ключей:</label>
            <input
              type="number"
              value={formData.key_limit}
              onChange={(e) => setFormData({ ...formData, key_limit: e.target.value })}
              min="0"
              className="w-full px-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 focus:border-default text-primary text-sm"
              placeholder="0"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Группа тарифов:</label>
            <DarkSelect
              value={formData.tariff_group}
              onChange={(v) => setFormData({ ...formData, tariff_group: v })}
              groups={tariffGroupGroups}
              buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dim mb-2">Включён:</label>
            <DarkSelect
              value={formData.is_enabled ? 'yes' : 'no'}
              onChange={(v) => setFormData({ ...formData, is_enabled: v === 'yes' })}
              groups={yesNoGroups}
              buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary text-sm"
            />
          </div>
      </form>
    </ModalShell>
  )
}

