import { useMemo, useState } from 'react'
import type { RemnawaveNode } from '../../api/types'
import * as Flags from 'country-flag-icons/react/3x2'

// Форматирование байтов
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Форматирование uptime
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}д ${hours}ч`
  if (hours > 0) return `${hours}ч ${mins}м`
  return `${mins}м`
}

export interface Server {
  id: string
  uuid?: string
  number: string
  serviceName: string
  osType: 'windows' | 'linux' | 'ubuntu'
  serviceLocation: string
  countryCode: string
  ip: string
  port?: number
  dueDate: string
  cpuPercentage: number
  status: 'active' | 'paused' | 'inactive'
  usersOnline?: number
  trafficUsed?: number
  trafficLimit?: number
  uptime?: number
  tags?: string[]
}

interface ServerManagementTableProps {
  title?: string
  servers: RemnawaveNode[]
  onStatusChange?: (serverId: string, newStatus: Server['status']) => void
  onNodeClick?: (node: RemnawaveNode) => void
  className?: string
  profileId?: string
}

// Маппинг кодов стран
const countryCodeMap: Record<string, string> = {
  'de': 'DE',
  'us': 'US',
  'fr': 'FR',
  'jp': 'JP',
  'gb': 'GB',
  'ru': 'RU',
  'cn': 'CN',
  'nl': 'NL',
  'sg': 'SG',
  'au': 'AU',
  'pl': 'PL',
  'al': 'AL',
  'by': 'BY',
  'ua': 'UA',
  'kz': 'KZ',
  'ge': 'GE',
  'am': 'AM',
  'az': 'AZ',
  'lv': 'LV',
  'lt': 'LT',
  'ee': 'EE',
  'fi': 'FI',
  'se': 'SE',
  'no': 'NO',
  'dk': 'DK',
  'ie': 'IE',
  'es': 'ES',
  'it': 'IT',
  'pt': 'PT',
  'gr': 'GR',
  'tr': 'TR',
  'cz': 'CZ',
  'sk': 'SK',
  'hu': 'HU',
  'ro': 'RO',
  'bg': 'BG',
  'hr': 'HR',
  'si': 'SI',
  'at': 'AT',
  'ch': 'CH',
  'be': 'BE',
  'lu': 'LU',
  'is': 'IS',
  'mt': 'MT',
  'cy': 'CY',
}

// Получить компонент флага
function getCountryFlag(countryCode: string | undefined) {
  if (!countryCode) {
    return (
      <div className="w-6 h-6 rounded-full bg-overlay-md flex items-center justify-center text-primary text-xs font-bold">
        ??
      </div>
    )
  }
  
  const normalizedCode = countryCodeMap[countryCode.toLowerCase()] || countryCode.toUpperCase()
  const FlagComponent = (Flags as any)[normalizedCode] as React.ComponentType<{ className?: string }>
  
  if (!FlagComponent) {
    return (
      <div className="w-6 h-6 rounded-full bg-overlay-md flex items-center justify-center text-primary text-xs font-bold">
        {normalizedCode.slice(0, 2)}
      </div>
    )
  }
  
  return <FlagComponent className="w-6 h-6 rounded-full" />
}

// Преобразование RemnawaveNode в Server
function mapNodeToServer(node: RemnawaveNode, index: number): Server {
  const nodeId = node.uuid || node.id || String(index)
  
  // Определяем статус: проверяем enabled, isDisabled, status
  // Приоритет: enabled > isDisabled > status
  let status: 'active' | 'paused' | 'inactive' = 'inactive'
  
  if (typeof node.enabled === 'boolean') {
    // Если есть поле enabled, используем его
    status = node.enabled ? 'active' : 'inactive'
  } else if (typeof node.isDisabled === 'boolean') {
    // Если есть поле isDisabled, инвертируем его
    status = !node.isDisabled ? 'active' : 'inactive'
  } else if (node.status !== undefined && node.status !== null) {
    // Если есть поле status, парсим его
    const statusStr = String(node.status).toLowerCase()
    if (statusStr === 'enabled' || statusStr === 'active') {
      status = 'active'
    } else if (statusStr === 'disabled' || statusStr === 'inactive') {
      status = 'inactive'
    } else if (statusStr === 'paused') {
      status = 'paused'
    }
  }
  
  return {
    id: nodeId,
    uuid: node.uuid,
    number: String(index + 1).padStart(2, '0'),
    serviceName: node.name || `Node ${index + 1}`,
    osType: 'linux', // По умолчанию, можно определить по тегам или другим полям
    serviceLocation: node.location || node.country || 'Unknown',
    countryCode: node.country_code || '',
    ip: node.address || '0.0.0.0',
    port: node.port,
    dueDate: node.due_date || 'N/A',
    cpuPercentage: node.cpu_percentage || 0,
    status,
    usersOnline: (node as any).usersOnline ?? (node as any).users_online ?? (node as any).onlineUsers ?? undefined,
    trafficUsed: (node as any).trafficUsedBytes ?? (node as any).traffic_used_bytes ?? (node as any).trafficUsed ?? undefined,
    trafficLimit: (node as any).trafficLimitBytes ?? (node as any).traffic_limit_bytes ?? (node as any).trafficLimit ?? undefined,
    uptime: (node as any).uptime ?? (node as any).xrayUptime ?? (node as any).xray_uptime ?? undefined,
    tags: node.tags ?? [],
  }
}

export function ServerManagementTable({
  title = 'Active Services',
  servers: nodes,
  className = ''
}: ServerManagementTableProps) {
  const [hoveredServer, setHoveredServer] = useState<string | null>(null)

  const servers = useMemo(() => {
    return nodes.map((node, index) => mapNodeToServer(node, index))
  }, [nodes])

  const connectedById = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const n of nodes as any[]) {
      const id = String(n?.uuid || n?.id || '').trim()
      if (!id) continue
      if (typeof n?.isConnected === 'boolean') m.set(id, n.isConnected)
      else if (typeof n?.is_connected === 'boolean') m.set(id, n.is_connected)
    }
    return m
  }, [nodes])

  const getStatusBadge = (status: Server['status']) => {
    switch (status) {
      case 'active':
        return (
          <div className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center justify-center">
            <span className="text-green-400 text-sm font-medium">Active</span>
          </div>
        )
      case 'paused':
        return (
          <div className="px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center">
            <span className="text-yellow-400 text-sm font-medium">Paused</span>
          </div>
        )
      case 'inactive':
        return (
          <div className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <span className="text-red-400 text-sm font-medium">Inactive</span>
          </div>
        )
    }
  }

  const getStatusGradient = (status: Server['status']) => {
    switch (status) {
      case 'active':
        return 'from-green-500/10 to-transparent'
      case 'paused': 
        return 'from-yellow-500/10 to-transparent'
      case 'inactive':
        return 'from-red-500/10 to-transparent'
    }
  }

  // Вычисляем итоги
  const totalOnline = servers.reduce((sum, s) => sum + (s.usersOnline ?? 0), 0)
  const totalTraffic = servers.reduce((sum, s) => sum + (s.trafficUsed ?? 0), 0)
  const activeCount = servers.filter((s) => {
    const c = connectedById.get(s.id)
    if (c === true) return true
    if (c === false) return false
    return s.status === 'active'
  }).length
  const inactiveCount = servers.filter((s) => {
    const c = connectedById.get(s.id)
    if (c === false) return true
    if (c === true) return false
    return s.status === 'inactive'
  }).length

  return (
    <div className={`w-full ${className}`}>
      <div className="glass-table p-3 sm:p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <h1 className="text-xl font-medium text-primary">{title}</h1>
            </div>
            <div className="text-sm text-muted">
              {activeCount} Active • {inactiveCount} Inactive
            </div>
          </div>
        </div>

        {/* Mobile summary list */}
        <div className="md:hidden space-y-2">
          {servers.map((server) => {
            const node = nodes.find(n => (n.uuid || n.id) === server.id)
            const connected = (node as any)?.isConnected
            const showLimit = Number(server.trafficLimit ?? 0) > 0
            const statusMsg = ((node as any)?.lastStatusMessage ?? (node as any)?.last_status_message ?? null) as any
            const isOffline = typeof connected === 'boolean' ? !connected : server.status === 'inactive'
            const xrayV = ((node as any)?.xrayVersion ?? (node as any)?.xray_version ?? null) as any
            const nodeV = ((node as any)?.nodeVersion ?? (node as any)?.node_version ?? null) as any
            return (
              <div
                key={server.id}
                className="w-full text-left bg-overlay-xs border border-default rounded-xl p-3 hover:bg-overlay-sm transition-colors"
              >
                <div className="flex items-center gap-3">
                  {((node as any)?.countryCode || node?.country_code) ? (
                    <div className="w-8 h-8 rounded-full overflow-hidden border border-strong flex items-center justify-center flex-shrink-0">
                      {getCountryFlag((node as any)?.countryCode || node?.country_code)}
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-overlay-xs border border-default flex items-center justify-center text-xs text-dim">
                      --
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-primary font-semibold truncate">{server.serviceName}</div>
                      {typeof connected === 'boolean' && (
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                          connected ? 'bg-green-500/15 text-green-500 border-green-500/25' : 'bg-red-500/15 text-red-500 border-red-500/25'
                        }`}>
                          {connected ? 'Онлайн' : 'Офлайн'}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
                      <span className="font-mono">{server.ip}{server.port ? `:${server.port}` : ''}</span>
                      {server.usersOnline !== undefined && <span className="text-green-500">Online: {server.usersOnline}</span>}
                      {server.uptime !== undefined && <span className="text-blue-300">Uptime: {formatUptime(server.uptime)}</span>}
                      <span className="text-dim">
                        Xray: {xrayV ? String(xrayV) : '—'} • Node: {nodeV ? String(nodeV) : '—'}
                      </span>
                      {statusMsg && (
                        <span className={`${isOffline ? 'text-red-500' : 'text-dim'} truncate`} title={String(statusMsg)}>
                          {String(statusMsg)}
                        </span>
                      )}
                    </div>
                    {server.trafficUsed !== undefined && (
                      <div className="mt-1 text-xs text-[var(--accent)] font-mono truncate whitespace-nowrap">
                        {formatBytes(server.trafficUsed)}{showLimit ? ` / ${formatBytes(Number(server.trafficLimit) || 0)}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Table (desktop/tablet) */}
        <div className="space-y-2">
          {/* Headers */}
          {/* Columns: 3+2+1+1+1+2+1+1 = 12 (Status is last) */}
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 text-sm font-semibold text-dim uppercase tracking-wider border-b border-default">
            <div className="col-span-3">Service Name</div>
            <div className="col-span-2">IP Address</div>
            <div className="col-span-1 text-center">Port</div>
            <div className="col-span-1 text-center">Online</div>
            <div className="col-span-1 text-right">Traffic</div>
            <div className="col-span-2">Versions</div>
            <div className="col-span-1 text-center">Uptime</div>
            <div className="col-span-1 text-center">Status</div>
          </div>

          {/* Server Rows */}
          {servers.map((server) => (
            <div
              key={server.id}
              className="hidden md:block relative transition-all duration-200"
              onMouseEnter={() => setHoveredServer(server.id)}
              onMouseLeave={() => setHoveredServer(null)}
            >
              <div
                className={`relative bg-overlay-xs border border-default rounded-xl p-4 overflow-hidden transition-all duration-200 hover:bg-overlay-sm ${
                  hoveredServer === server.id ? 'transform -translate-y-1 shadow-lg border-strong' : ''
                }`}
              >
                {/* Status gradient overlay */}
                <div 
                  className={`absolute inset-0 bg-gradient-to-l ${getStatusGradient(connectedById.get(server.id) === false ? 'inactive' : server.status)} pointer-events-none`}
                  style={{ 
                    backgroundSize: '30% 100%', 
                    backgroundPosition: 'right',
                    backgroundRepeat: 'no-repeat'
                  }} 
                />
                
                {/* Grid Content */}
                <div className="relative grid grid-cols-12 gap-3 items-center">
                  {/* Service Name */}
                  <div className="col-span-3 flex items-center gap-3 min-w-0">
                    {((nodes.find(n => (n.uuid || n.id) === server.id) as any)?.countryCode || nodes.find(n => (n.uuid || n.id) === server.id)?.country_code) && (
                      <div className="w-6 h-6 rounded-full overflow-hidden border border-strong flex items-center justify-center flex-shrink-0">
                        {getCountryFlag((nodes.find(n => (n.uuid || n.id) === server.id) as any)?.countryCode || nodes.find(n => (n.uuid || n.id) === server.id)?.country_code)}
                      </div>
                    )}
                    <span className="text-primary font-semibold text-base truncate" title={server.serviceName}>
                      {server.serviceName}
                    </span>
                  </div>

                  {/* IP */}
                  <div className="col-span-2 min-w-0">
                    <span className="text-sky-300 font-mono text-base truncate block" title={server.ip}>
                      {server.ip}
                    </span>
                  </div>

                  {/* Port */}
                  <div className="col-span-1 text-center">
                    <span className="text-primary text-base font-semibold">
                      {server.port || '-'}
                    </span>
                  </div>

                  {/* Users Online */}
                  <div className="col-span-1 text-center">
                    {server.usersOnline !== undefined ? (
                      <span className="text-green-400 text-base font-bold">
                        {server.usersOnline}
                      </span>
                    ) : (
                      <span className="text-muted text-base">-</span>
                    )}
                  </div>

                  {/* Traffic */}
                  <div className="col-span-1 text-right min-w-0">
                    {server.trafficUsed !== undefined ? (
                      <div
                        className="text-[var(--accent)] text-base font-mono truncate whitespace-nowrap"
                        title={Number(server.trafficLimit ?? 0) > 0 ? `${formatBytes(server.trafficUsed)} / ${formatBytes(Number(server.trafficLimit) || 0)}` : formatBytes(server.trafficUsed)}
                      >
                        {formatBytes(server.trafficUsed)}
                        {Number(server.trafficLimit ?? 0) > 0 && (
                          <span className="text-muted"> / {formatBytes(Number(server.trafficLimit) || 0)}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted text-base">-</span>
                    )}
                  </div>

                  {/* Versions */}
                  <div className="col-span-2 min-w-0">
                    {(() => {
                      const node = nodes.find(n => (n.uuid || n.id) === server.id) as any
                      const xrayV = String(node?.xrayVersion ?? node?.xray_version ?? '').trim()
                      const nodeV = String(node?.nodeVersion ?? node?.node_version ?? '').trim()
                      return (
                        <div className="text-sm text-secondary">
                          <div className="font-mono truncate" title={`Xray: ${xrayV || '—'}`}>
                            Xray: <span className="text-primary">{xrayV || '—'}</span>
                          </div>
                          <div className="font-mono truncate" title={`Node: ${nodeV || '—'}`}>
                            Node: <span className="text-primary">{nodeV || '—'}</span>
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Uptime */}
                  <div className="col-span-1 text-center">
                    {server.uptime !== undefined ? (
                      <span className="text-blue-400 text-base font-semibold" title={`${server.uptime} секунд`}>
                        {formatUptime(server.uptime)}
                      </span>
                    ) : (
                      <span className="text-muted text-base">-</span>
                    )}
                  </div>

                  {/* Status */}
                  <div className="col-span-1 flex justify-center">
                    {(() => {
                      const node = nodes.find(n => (n.uuid || n.id) === server.id)
                      const msg = String((node as any)?.lastStatusMessage ?? (node as any)?.last_status_message ?? '').trim()
                      const changed = String((node as any)?.lastStatusChange ?? (node as any)?.last_status_change ?? '').trim()
                      const title = [msg || null, changed || null].filter(Boolean).join('\n')
                      if ((node as any)?.isConnected !== undefined) {
                        return (
                          <div title={title || undefined} className={`px-4 py-1.5 rounded-lg text-sm font-bold ${
                            (node as any).isConnected 
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                              : 'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {(node as any).isConnected ? 'Онлайн' : 'Офлайн'}
                          </div>
                        )
                      }
                      return <div title={title || undefined}>{getStatusBadge(server.status)}</div>
                    })()}
                  </div>
                </div>
                {(() => {
                  const node = nodes.find(n => (n.uuid || n.id) === server.id) as any
                  const isOffline = node?.isConnected === false || server.status === 'inactive'
                  const msg = String(node?.lastStatusMessage ?? node?.last_status_message ?? '').trim()
                  const changed = String(node?.lastStatusChange ?? node?.last_status_change ?? '').trim()
                  if (!isOffline || (!msg && !changed)) return null
                  return (
                    <div className="mt-2 text-sm text-red-500/90">
                      {msg ? `Последнее сообщение: ${msg}` : ''}
                      {changed ? ` • ${changed}` : ''}
                    </div>
                  )
                })()}
              </div>
            </div>
          ))}

          {/* Footer with totals */}
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-3 mt-4 border-t border-default bg-overlay-xs rounded-lg">
            <div className="col-span-3 text-muted text-sm font-medium">Итого:</div>
            <div className="col-span-2"></div>
            <div className="col-span-1"></div>
            <div className="col-span-1 text-center">
              <span className="text-green-400 text-base font-bold">
                {totalOnline}
              </span>
            </div>
            <div className="col-span-1 text-right">
              <span className="text-[var(--accent)] text-base font-mono font-semibold">
                {formatBytes(totalTraffic)}
              </span>
            </div>
            <div className="col-span-2"></div>
            <div className="col-span-1"></div>
            <div className="col-span-1"></div>
          </div>
        </div>
      </div>

      {/* Node Cards Below Table - Separate Section */}
      <div className="hidden md:grid mt-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {nodes.map((node, index) => {
            const server = servers[index]
            if (!server) return null

            return (
              <div key={node.uuid || node.id || index} className="glass-panel p-4 md:p-6 border border-default">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {((node as any).countryCode || node.country_code) && (
                      <div className="w-8 h-8 rounded-full overflow-hidden border border-strong flex items-center justify-center flex-shrink-0">
                        {getCountryFlag((node as any).countryCode || node.country_code)}
                      </div>
                    )}
                    <div>
                      <h3 className="text-lg font-bold text-primary">
                        {node.name || `Node ${index + 1}`}
                      </h3>
                      {node.location && (
                        <span className="text-sm text-muted">
                          {node.location}
                        </span>
                      )}
                    </div>
                  </div>
                  {((node as any).isConnected !== undefined) ? (
                    <div className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                      (node as any).isConnected 
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}>
                      {(node as any).isConnected ? 'Онлайн' : 'Офлайн'}
                    </div>
                  ) : (
                    getStatusBadge(server.status)
                  )}
                </div>

                <div className="space-y-4">
                  {/* Основная информация */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">Основная информация</h4>
                    <div className="grid grid-cols-2 gap-4">
                      {node.address && (
                        <div>
                          <span className="text-xs text-muted mb-1 block">IP Address:</span>
                          <div className="text-base text-primary font-mono truncate" title={node.address}>
                            {node.address}
                          </div>
                        </div>
                      )}
                      {node.port !== undefined && (
                        <div>
                          <span className="text-xs text-muted mb-1 block">Port:</span>
                          <div className="text-base text-primary font-semibold">
                            {node.port}
                          </div>
                        </div>
                      )}
                      {node.location && (
                        <div className="col-span-2">
                          <span className="text-xs text-muted mb-1 block">Location:</span>
                          <div className="text-base text-primary">
                            {node.location}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Статистика */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">Статистика</h4>
                    <div className="grid grid-cols-2 gap-4">
                      {((node as any).usersOnline !== undefined || server.usersOnline !== undefined) && (
                        <div>
                          <span className="text-xs text-muted mb-1 block">Users Online:</span>
                          <div className="text-xl text-green-400 font-bold">
                            {(node as any).usersOnline ?? server.usersOnline ?? 0}
                          </div>
                        </div>
                      )}
                      {((node as any).trafficUsedBytes !== undefined || server.trafficUsed !== undefined) && (
                        <div>
                          <span className="text-xs text-muted mb-1 block">Traffic:</span>
                          <div className="text-lg text-[var(--accent)] font-mono font-semibold">
                            {formatBytes((node as any).trafficUsedBytes ?? server.trafficUsed ?? 0)}
                            {((node as any).trafficLimitBytes || server.trafficLimit) && (
                              <span className="text-muted text-sm"> / {formatBytes((node as any).trafficLimitBytes ?? server.trafficLimit ?? 0)}</span>
                            )}
                          </div>
                        </div>
                      )}
                      {((node as any).xrayUptime !== undefined || server.uptime !== undefined) && (
                        <div className="col-span-2">
                          <span className="text-xs text-muted mb-1 block">Uptime:</span>
                          <div className="text-lg text-blue-400 font-semibold">
                            {formatUptime((node as any).xrayUptime ?? server.uptime ?? 0)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Системные характеристики */}
                  {((node as any).cpuCount || (node as any).cpuModel || (node as any).totalRam) && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">Система</h4>
                      <div className="grid grid-cols-2 gap-4">
                        {(node as any).cpuCount && (
                          <div>
                            <span className="text-xs text-muted mb-1 block">CPU:</span>
                            <div className="text-base text-primary font-semibold">
                              {(node as any).cpuCount} core{(node as any).cpuCount > 1 ? 's' : ''}
                            </div>
                          </div>
                        )}
                        {(node as any).totalRam && (
                          <div>
                            <span className="text-xs text-muted mb-1 block">RAM:</span>
                            <div className="text-base text-primary font-semibold">
                              {(node as any).totalRam}
                            </div>
                          </div>
                        )}
                      </div>
                      {(node as any).cpuModel && (
                        <div>
                          <span className="text-xs text-muted mb-1 block">CPU Model:</span>
                          <div className="text-sm text-primary font-mono truncate" title={(node as any).cpuModel}>
                            {(node as any).cpuModel}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Статусы */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">Статусы</h4>
                    <div className="grid grid-cols-2 gap-4">
                      {((node as any).isDisabled !== undefined || node.enabled !== undefined) && (
                        <div>
                          <span className="text-xs text-muted mb-1 block">Enabled:</span>
                          <div className={`text-base font-bold ${!((node as any).isDisabled ?? !node.enabled) ? 'text-green-400' : 'text-red-400'}`}>
                            {!((node as any).isDisabled ?? !node.enabled) ? 'Yes' : 'No'}
                          </div>
                        </div>
                      )}
                      {(node as any).isConnected !== undefined && (
                        <div>
                          <span className="text-xs text-muted mb-1 block">Connected:</span>
                          <div className={`text-base font-bold ${(node as any).isConnected ? 'text-green-400' : 'text-red-400'}`}>
                            {(node as any).isConnected ? 'Yes' : 'No'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Версии */}
                  {((node as any).xrayVersion || (node as any).nodeVersion) && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">Версии</h4>
                      <div className="grid grid-cols-2 gap-4">
                        {(node as any).xrayVersion && (
                          <div>
                            <span className="text-xs text-muted mb-1 block">Xray:</span>
                            <div className="text-base text-primary font-mono font-semibold">
                              {(node as any).xrayVersion}
                            </div>
                          </div>
                        )}
                        {(node as any).nodeVersion && (
                          <div>
                            <span className="text-xs text-muted mb-1 block">Node:</span>
                            <div className="text-base text-primary font-mono font-semibold">
                              {(node as any).nodeVersion}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {node.tags && node.tags.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">Теги</h4>
                      <div className="flex flex-wrap gap-2">
                        {node.tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-overlay-sm border border-strong rounded text-primary text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              </div>
            )
          })}
      </div>

    </div>
  )
}

