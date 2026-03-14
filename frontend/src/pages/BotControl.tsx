import { useCallback, useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getBotConfigAsync } from '../utils/botConfig'
import CapybaraLoader from '../components/common/CapybaraLoader'
import NeoToggle from '../components/common/NeoToggle'
import ConfirmModal from '../components/common/ConfirmModal'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import { useToastContext } from '../contexts/ToastContext'
import DarkSelect, { type DarkSelectGroup } from '../components/common/DarkSelect'
import {
  disableModule,
  enableModule,
  getJournalLogs,
  getModuleModules,
  getModuleStatus,
  getSystemdStatus,
  restartBotService,
  getMaintenanceStatus,
  toggleMaintenance,
  createBackup,
  restoreTrials,
  type BotApiConfig,
} from '../api/botApi'

type TabKey = 'overview' | 'logs'

interface ActionCardProps {
  icon: string
  title: string
  onClick: () => void
  loading?: boolean
  variant?: 'default' | 'warning' | 'danger' | 'success'
  badge?: string
  badgeVariant?: 'success' | 'warning' | 'danger'
  subtitle?: string
}

function ActionCard({ icon, title, onClick, loading, variant = 'default', badge, badgeVariant, subtitle }: ActionCardProps) {
  const variants = {
    default: 'border-default hover:border-strong hover:bg-overlay-xs',
    warning: 'border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/10',
    danger: 'border-red-500/30 hover:border-red-500/50 hover:bg-red-500/10',
    success: 'border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/10',
  }
  
  const badgeColors = {
    success: 'bg-accent-20 text-[var(--accent)] border-accent-30',
    warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    danger: 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`group relative flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl border bg-[var(--bg-surface-hover)]/80 backdrop-blur transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-wait min-h-[88px] ${variants[variant]}`}
    >
      {badge && (
        <span className={`absolute top-2 right-2 px-2 py-0.5 text-xs font-medium rounded-full border ${badgeColors[badgeVariant || 'success']}`}>
          {badge}
        </span>
      )}
      <span className="text-xl sm:text-2xl mb-1">{loading ? '⏳' : icon}</span>
      <span className="text-primary font-medium text-sm text-center">{title}</span>
      {subtitle && <span className="text-muted text-xs text-center mt-0.5">{subtitle}</span>}
    </button>
  )
}

interface ModuleCardProps {
  name: string
  enabled: boolean
  onToggle: () => void
  loading?: boolean
}

function ModuleCard({ name, enabled, onToggle, loading }: ModuleCardProps) {
  return (
    <div className={`rounded-xl border p-4 transition-all ${
      enabled
        ? 'bg-[var(--bg-surface-hover)]/80 border-emerald-500/40'
        : 'bg-[var(--bg-surface-hover)]/50 border-default opacity-80'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-red-500'}`} />
            <h3 className="text-primary font-medium text-sm truncate">{name}</h3>
          </div>
        </div>
        <div className="flex-shrink-0">
          <NeoToggle
            checked={enabled}
            disabled={loading}
            onChange={() => onToggle()}
            width={60}
            height={28}
            showStatus={false}
          />
        </div>
      </div>
    </div>
  )
}

export default function BotControl() {
  const toast = useToastContext()
  const [searchParams] = useSearchParams()
  const urlTab = searchParams.get('tab') as TabKey | null
  const [config, setConfig] = useState<BotApiConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // success notifications should be shown via standard toasts (right side)
  const [tab, setTab] = useState<TabKey>(() => urlTab === 'logs' ? 'logs' : 'overview')

  useEffect(() => {
    setTab(urlTab === 'logs' ? 'logs' : 'overview')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab])

  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [status, setStatus] = useState<any>(null)
  const [modules, setModules] = useState<any>(null)
  const [systemd, setSystemd] = useState<any>(null)
  const [maintenance, setMaintenance] = useState<boolean>(false)
  const [logs, setLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [lines, setLines] = useState(100)
  const [confirm, setConfirm] = useState<{
    title: string
    message: string
    confirmText?: string
    onConfirm: () => void
  } | null>(null)

  const linesGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: '50', label: '50' },
          { value: '100', label: '100' },
          { value: '200', label: '200' },
          { value: '500', label: '500' },
        ],
      },
    ],
    [],
  )

  const openConfirm = useCallback((payload: { title: string; message: string; confirmText?: string; onConfirm: () => void }) => {
    setConfirm(payload)
  }, [])

  const closeConfirm = useCallback(() => {
    setConfirm(null)
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await getBotConfigAsync()
      if (!cfg) {
        const msg = 'Нет активного профиля. Настройте профиль в разделе Настройки.'
        setError(msg)
        setLoading(false)
        return
      }
      setConfig(cfg)

      const [st, mods, sd, mt] = await Promise.all([
        getModuleStatus(cfg).catch(() => null),
        getModuleModules(cfg).catch(() => null),
        getSystemdStatus(cfg, 'bot.service').catch(() => null),
        getMaintenanceStatus(cfg).catch(() => ({ maintenance_enabled: false })),
      ])
      setStatus(st)
      setModules(mods)
      setSystemd(sd)
      setMaintenance(mt?.maintenance_enabled || false)
    } catch (err: any) {
      const msg = err.message || 'Ошибка загрузки'
      setError(msg)
      toast.showError('Ошибка', msg, 4500)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const loadLogs = useCallback(async () => {
    if (!config) return
    setLogsLoading(true)
    try {
      const data = await getJournalLogs(config, { unit: 'bot.service', lines })
      setLogs(data?.items || [])
    } catch {
      setLogs([])
    } finally {
      setLogsLoading(false)
    }
  }, [config, lines])

  const handleRestart = async () => {
    if (!config) return
    setActionLoading('restart')
    setError(null)
    try {
      await restartBotService(config)
      toast.showSuccess('Успешно', 'Бот перезапускается...', 2500)
      setTimeout(loadData, 3000)
    } catch (err: any) {
      toast.showError('Ошибка', err.message || 'Ошибка перезапуска', 4500)
    } finally {
      setActionLoading(null)
    }
  }

  const handleBackup = async () => {
    if (!config) return
    setActionLoading('backup')
    setError(null)
    try {
      const result = await createBackup(config)
      if (result.ok) {
        toast.showSuccess('Успешно', result.message || 'Бэкап создан', 3000)
      } else {
        setError(result.message)
        toast.showError('Ошибка', result.message || 'Ошибка создания бэкапа', 4500)
      }
    } catch (err: any) {
      toast.showError('Ошибка', err.message || 'Ошибка создания бэкапа', 4500)
    } finally {
      setActionLoading(null)
    }
  }

  const handleRestoreTrials = async () => {
    if (!config) return
    setActionLoading('trials')
    setError(null)
    try {
      const result = await restoreTrials(config)
      if (result.ok) {
        toast.showSuccess('Успешно', result.message || 'Пробники восстановлены', 3000)
      } else {
        const msg = result.message || 'Ошибка восстановления пробников'
        setError(msg)
        toast.showError('Ошибка', msg, 4500)
      }
    } catch (err: any) {
      toast.showError('Ошибка', err.message || 'Ошибка восстановления пробников', 4500)
    } finally {
      setActionLoading(null)
    }
  }

  const handleToggleMaintenance = async () => {
    if (!config) return
    setActionLoading('maintenance')
    setError(null)
    try {
      const result = await toggleMaintenance(config)
      if (result.ok) {
        setMaintenance(result.maintenance_enabled)
        toast.showSuccess(
          'Успешно',
          result.message || (result.maintenance_enabled ? 'Тех. работы включены' : 'Тех. работы выключены'),
          2500,
        )
      } else {
        const msg = result.message || 'Ошибка переключения тех. режима'
        setError(msg)
        toast.showError('Ошибка', msg, 4500)
      }
    } catch (err: any) {
      toast.showError('Ошибка', err.message || 'Ошибка переключения тех. режима', 4500)
    } finally {
      setActionLoading(null)
    }
  }

  const handleToggleModule = async (name: string, enabled: boolean) => {
    if (!config) return
    setActionLoading(`module-${name}`)
    setError(null)
    try {
      if (enabled) {
        await disableModule(config, name)
      } else {
        await enableModule(config, name)
      }
      toast.showSuccess('Сохранено', `Модуль ${name} ${enabled ? 'выключен' : 'включен'}`, 2500)
      await loadData()
    } catch (err: any) {
      toast.showError('Ошибка', err.message || 'Ошибка изменения модуля', 4500)
    } finally {
      setActionLoading(null)
    }
  }

  const modulesList = useMemo(() => {
    return modules?.modules || []
  }, [modules])

  const sd = (systemd && typeof systemd === 'object' && 'data' in systemd) ? (systemd as any).data : systemd
  const activeState = String(sd?.ActiveState ?? sd?.active_state ?? sd?.activeState ?? '').toLowerCase()
  const subState = String(sd?.SubState ?? sd?.sub_state ?? sd?.subState ?? '').toLowerCase()
  const unitFileState = String(sd?.UnitFileState ?? sd?.unit_file_state ?? sd?.unitFileState ?? '')
  const mainPid = sd?.MainPID ?? sd?.main_pid ?? sd?.MainPid ?? sd?.pid

  const version = status?.version || '—'
  const pid = status?.pid || mainPid || '—'
  const enabledModules = modulesList.filter((m: any) => m.enabled).length


  if (loading && !status) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <CapybaraLoader />
      </div>
    )
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-7 space-y-5">
      <ConfirmModal
        isOpen={Boolean(confirm)}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmText={confirm?.confirmText || 'Продолжить'}
        cancelText="Нет"
        onCancel={closeConfirm}
        onConfirm={() => {
          const fn = confirm?.onConfirm
          closeConfirm()
          if (fn) fn()
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-end">
        <button
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-overlay-xs border border-default text-primary hover:bg-overlay-sm transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          Обновить статус
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-default bg-[var(--bg-surface-hover)]/60 px-4 py-3 text-sm text-dim">
          {String(error || '').includes('Нет активного профиля') ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{error}</span>
              <OpenPanelSettingsButton className="sm:flex-shrink-0" />
            </div>
          ) : (
            error
          )}
        </div>
      )}

      {/* Overview Tab - Actions + Status combined */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {/* Quick Actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ActionCard
              icon="🔄"
              title="Перезапуск бота"
              onClick={() =>
                openConfirm({
                  title: 'Перезапуск бота',
                  message:
                    'Сервис бота будет перезапущен (systemd). На несколько секунд бот может быть недоступен.\n\nПродолжить?',
                  onConfirm: handleRestart,
                })
              }
              loading={actionLoading === 'restart'}
              variant="danger"
            />
            <ActionCard
              icon="💾"
              title="Бэкап БД"
              subtitle="Создать копию"
              onClick={() =>
                openConfirm({
                  title: 'Создать бэкап БД',
                  message:
                    'Будет создана резервная копия базы данных на сервере. Это может занять некоторое время.\n\nПродолжить?',
                  onConfirm: handleBackup,
                })
              }
              loading={actionLoading === 'backup'}
              variant="default"
            />
            <ActionCard
              icon="🔑"
              title="Пробники"
              subtitle="Сбросить триалы"
              onClick={() =>
                openConfirm({
                  title: 'Сбросить пробники (триалы)',
                  message:
                    'Будут восстановлены/сброшены пробные доступы (trials) согласно логике модуля. Используйте аккуратно.\n\nПродолжить?',
                  onConfirm: handleRestoreTrials,
                })
              }
              loading={actionLoading === 'trials'}
              variant="success"
            />
            <ActionCard
              icon="🛠️"
              title="Тех. режим"
              subtitle={maintenance ? 'Включены' : 'Выключены'}
              onClick={() =>
                openConfirm({
                  title: maintenance ? 'Выключить тех. режим' : 'Включить тех. режим',
                  message: maintenance
                    ? 'Тех. режим будет выключен — бот вернётся к обычной работе.\n\nПродолжить?'
                    : 'Тех. режим будет включен — бот будет работать в режиме тех. работ (ограничения/сообщение о тех. работах).\n\nПродолжить?',
                  onConfirm: handleToggleMaintenance,
                })
              }
              loading={actionLoading === 'maintenance'}
              variant={maintenance ? 'warning' : 'default'}
            />
          </div>

          {/* Status Info */}
          <div className="rounded-2xl border border-default bg-[var(--bg-surface-hover)]/80 p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-0">
              <div className="sm:pr-4">
                <div className="text-muted text-xs mb-1">Версия</div>
                <div className="text-primary font-mono text-lg">{version}</div>
              </div>

              <div className="sm:pl-4 sm:border-l sm:border-default">
                <div className="text-muted text-xs mb-1">PID</div>
                <div className="text-primary font-mono text-lg">{pid}</div>
              </div>

              <div className="sm:pl-4 sm:border-l sm:border-default">
                <div className="text-muted text-xs mb-1">Systemd</div>
                <div className="text-primary text-lg">{subState || activeState || '—'}</div>
              </div>

              <div className="sm:pl-4 sm:border-l sm:border-default">
                <div className="text-muted text-xs mb-1">Автозапуск</div>
                <div className={`text-lg ${unitFileState === 'enabled' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {unitFileState || '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Modules (integrated into Overview) */}
          <div className="rounded-2xl border border-default bg-overlay-xs p-4 sm:p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-primary font-semibold">Модули</div>
                <div className="text-muted text-xs mt-0.5">
                  {modulesList.length > 0 ? `${enabledModules}/${modulesList.length} активны` : 'Список модулей пуст'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {modulesList.map((mod: any) => (
                <ModuleCard
                  key={mod.name}
                  name={mod.name}
                  enabled={mod.enabled}
                  onToggle={() => handleToggleModule(mod.name, mod.enabled)}
                  loading={actionLoading === `module-${mod.name}`}
                />
              ))}
              {modulesList.length === 0 && (
                <div className="col-span-full text-center text-muted py-10">
                  Модули не найдены
                </div>
              )}
            </div>

            <div className="text-xs text-muted pt-1">
              После включения/отключения модуля нужно <span className="text-dim font-medium">перезагрузить бота</span>.
            </div>
          </div>
        </div>
      )}

      {/* Logs Tab */}
      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-sm text-muted mb-1">Строк</label>
              <div className="w-full sm:min-w-[120px] sm:w-auto">
                <DarkSelect
                  value={String(lines)}
                  onChange={(v) => setLines(Number(v))}
                  groups={linesGroups}
                  buttonClassName="filter-field"
                />
              </div>
            </div>
            <button
              onClick={loadLogs}
              disabled={logsLoading}
              className="px-4 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50 text-sm"
            >
              {logsLoading ? 'Загрузка...' : 'Загрузить'}
            </button>
          </div>

          <div
            className="rounded-xl overflow-y-auto"
            style={{ maxHeight: 700, background: "#0c0c0c", border: "1px solid #222", fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
          >
            <div style={{ padding: "10px 0" }}>
              {logs.length > 0 ? logs.map((line, i) => {
                // Parse journalctl format: "Mar 14 10:01:10 HOST python[PID]: LEVEL: message"
                const m = line.match(/^(\w{3}\s+\d+\s+[\d:]+)\s+(\S+)\s+(\S+):\s*(WARNING|ERROR|CRITICAL|INFO|DEBUG)?:?\s*(.*)$/)
                const isError = /error|critical|traceback/i.test(line)
                const isWarn = !isError && /warning|warn/i.test(line)
                const levelColor = isError ? "#f87171" : isWarn ? "#fbbf24" : "#4ade80"
                const bgColor = isError ? "rgba(239,68,68,0.07)" : isWarn ? "rgba(251,191,36,0.04)" : "transparent"

                if (!m) {
                  // Unparsed line (e.g. traceback continuation)
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "baseline", background: bgColor }}>
                      <span style={{ color: "#3a3a3a", fontSize: 11, padding: "0 10px 0 14px", flexShrink: 0, userSelect: "none", minWidth: 48, textAlign: "right" }}>
                        {String(i + 1).padStart(4, " ")}
                      </span>
                      <span style={{ color: isError ? "#f87171" : "#566577", fontSize: 12, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1, paddingRight: 14 }}>
                        {line}
                      </span>
                    </div>
                  )
                }

                const [, ts, host, proc, level, msg] = m
                return (
                  <div key={i} style={{ display: "flex", alignItems: "baseline", background: bgColor, gap: 0 }}>
                    {/* Line number */}
                    <span style={{ color: "#3a3a3a", fontSize: 11, padding: "0 10px 0 14px", flexShrink: 0, userSelect: "none", minWidth: 48, textAlign: "right" }}>
                      {String(i + 1).padStart(4, " ")}
                    </span>
                    {/* Timestamp */}
                    <span style={{ color: "#4a5568", fontSize: 11, flexShrink: 0, minWidth: 72, paddingRight: 8 }}>{ts}</span>
                    {/* Host */}
                    <span style={{ color: "#374151", fontSize: 11, flexShrink: 0, paddingRight: 8, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{host}</span>
                    {/* Process */}
                    <span style={{ color: "#4b5563", fontSize: 11, flexShrink: 0, paddingRight: 8, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proc}</span>
                    {/* Level badge */}
                    <span style={{ color: levelColor, fontSize: 11, flexShrink: 0, minWidth: 52, paddingRight: 8, fontWeight: 600 }}>
                      {level || "—"}
                    </span>
                    {/* Message */}
                    <span style={{ color: isError ? "#f87171" : isWarn ? "#fbbf24" : "#cbd5e1", fontSize: 12, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1, paddingRight: 14 }}>
                      {msg}
                    </span>
                  </div>
                )
              }) : (
                <div style={{ color: "#444", textAlign: "center", padding: "24px 0", fontSize: 13 }}>
                  Нажмите "Загрузить" для просмотра логов
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
