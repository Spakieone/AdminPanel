import { useEffect, useState } from 'react'
import ModalShell, { modalSecondaryButtonClass } from '../common/ModalShell'
import type { RemnawaveUser } from '../../api/types'
import { getRemnawaveNodes, getRemnawaveUser } from '../../api/client'
import * as Flags from 'country-flag-icons/react/3x2'

function formatBytes(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0)
  if (!Number.isFinite(b) || b <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(b) / Math.log(k)))
  const v = b / Math.pow(k, i)
  return `${v.toFixed(v >= 10 ? 1 : 2)} ${sizes[i]}`
}

type DateLike = string | number | Date | null | undefined

function fmtDate(s: DateLike): string {
  if (!s) return '—'
  const d = s instanceof Date ? s : new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = String(status ?? '').toUpperCase()
  const config: Record<string, { bg: string; text: string; label: string }> = {
    'ACTIVE': { bg: 'bg-accent-20', text: 'text-[var(--accent)]', label: 'Активен' },
    'DISABLED': { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Отключён' },
    'LIMITED': { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Лимит исчерпан' },
    'EXPIRED': { bg: 'bg-white/30/20', text: 'text-muted', label: 'Срок истёк' },
  }
  const c = config[s] || { bg: 'bg-white/30/20', text: 'text-muted', label: status || '—' }
  return <span className={`${c.bg} ${c.text} px-4 py-2 rounded-xl text-base font-semibold`}>{c.label}</span>
}

function InfoRow({ label, value, mono, accent }: { label: string; value: React.ReactNode; mono?: boolean; accent?: boolean }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-default last:border-0">
      <span className="text-muted text-sm sm:text-base">{label}</span>
      <span className={`text-sm sm:text-base text-right ${mono ? 'font-mono' : ''} ${accent ? 'text-[var(--accent)]' : 'text-primary'}`}>{value}</span>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }
  
  if (!text) return null
  
  return (
    <button
      onClick={copy}
      className="ml-2 px-2.5 py-1 text-sm bg-overlay-xs hover:bg-overlay-sm text-secondary border border-default rounded-lg transition-colors"
    >
      {copied ? '✓' : 'Копировать'}
    </button>
  )
}

export default function UserDetailsModal({
  isOpen,
  profileId,
  userUuid,
  onClose,
}: {
  isOpen: boolean
  profileId?: string
  userUuid: string
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [user, setUser] = useState<RemnawaveUser | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [lastNodeLabel, setLastNodeLabel] = useState<string>('—')
  const [lastNodeCountryCode, setLastNodeCountryCode] = useState<string | null>(null)

  const computeLastNodeLabel = (u: RemnawaveUser | null): string => {
    if (!u) return '—'
    const raw = (u as any).lastConnectedNode
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
    if (raw && typeof raw === 'object') {
      const name =
        String((raw as any).nodeName || (raw as any).node_name || (raw as any).name || (raw as any).node || '').trim()
      if (name) return name
    }
    const uuid = String((u as any).lastConnectedNodeUuid || (u as any).userTraffic?.lastConnectedNodeUuid || '').trim()
    if (uuid) return uuid.length > 16 ? `${uuid.slice(0, 8)}…` : uuid
    return '—'
  }

  const normalizeCountryCode = (raw: unknown): string | null => {
    const s = String(raw || '').trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(s)) return s
    return null
  }

  const inferCountryCodeFromText = (raw: unknown): string | null => {
    const s0 = String(raw || '').trim()
    if (!s0) return null
    const s = s0.toUpperCase()

    // Direct match: "PL Poland", "DE-01", etc.
    const m = s.match(/\b([A-Z]{2})\b/)
    if (m?.[1] && /^[A-Z]{2}$/.test(m[1])) return m[1]

    // Heuristic map for common node names/locations
    const map: Record<string, string> = {
      POLAND: 'PL',
      GERMANY: 'DE',
      LATVIA: 'LV',
      NETHERLANDS: 'NL',
      HOLLAND: 'NL',
      ALBANIA: 'AL',
      USA: 'US',
      'UNITED STATES': 'US',
      RUSSIA: 'RU',
      MOSCOW: 'RU',
      MSK: 'RU',
      SPB: 'RU',
      'SAINT PETERSBURG': 'RU',
      PETERSBURG: 'RU',
      YANDEX: 'RU',
    }
    for (const key of Object.keys(map)) {
      if (s.includes(key)) return map[key]
    }
    return null
  }

  const getFlagComponent = (countryCode: string | null) => {
    if (!countryCode) return null
    const flagName = countryCode.toUpperCase() as keyof typeof Flags
    return (Flags as any)[flagName] as (React.ComponentType<{ className?: string; style?: React.CSSProperties }> | undefined)
  }

  useEffect(() => {
    if (!isOpen) return
    // eslint-plugin-react-hooks set-state-in-effect: schedule state updates outside the effect body
    queueMicrotask(() => {
    setShowKeys(false)
    setLoading(true)
    setError('')
    setUser(null)
      setLastNodeLabel('—')
      setLastNodeCountryCode(null)
    })
    
    getRemnawaveUser(profileId, userUuid)
      .then(setUser)
      .catch(e => setError(e?.message || 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [isOpen, profileId, userUuid])

  useEffect(() => {
    if (!isOpen) return
    if (!user) return

    const initial = computeLastNodeLabel(user)
    queueMicrotask(() => {
      setLastNodeLabel(initial)
      // Try to extract country code from payload if present
      const rawNodeObj = (user as any).lastConnectedNode
      const cc =
        normalizeCountryCode((rawNodeObj as any)?.country_code) ??
        normalizeCountryCode((rawNodeObj as any)?.countryCode) ??
        normalizeCountryCode((rawNodeObj as any)?.country) ??
        inferCountryCodeFromText((rawNodeObj as any)?.country) ??
        inferCountryCodeFromText((rawNodeObj as any)?.location) ??
        inferCountryCodeFromText((rawNodeObj as any)?.name) ??
        inferCountryCodeFromText(rawNodeObj)
      setLastNodeCountryCode(cc)
    })

    // Resolve via nodes list (to get stable name + country_code).
    const rawNodeObj = (user as any).lastConnectedNode
    const hasNameFromPayload =
      (typeof rawNodeObj === 'string' && rawNodeObj.trim()) ||
      (rawNodeObj && typeof rawNodeObj === 'object' && String((rawNodeObj as any).nodeName || (rawNodeObj as any).node_name || (rawNodeObj as any).name || '').trim())

    const uuid = String((user as any).lastConnectedNodeUuid || '').trim()
    if (!uuid) return

    let cancelled = false
    ;(async () => {
      try {
        const raw = await getRemnawaveNodes(profileId)
        const arr: any[] =
          Array.isArray(raw) ? raw
            : Array.isArray((raw as any)?.response) ? (raw as any).response
            : Array.isArray((raw as any)?.nodes) ? (raw as any).nodes
            : Array.isArray((raw as any)?.data) ? (raw as any).data
            : []
        const found = arr.find((n) => String(n?.uuid || n?.id || '').trim() === uuid)
        const name = String(found?.name || found?.nodeName || found?.node_name || '').trim()
        const cc =
          normalizeCountryCode(found?.country_code) ??
          normalizeCountryCode(found?.countryCode) ??
          normalizeCountryCode(found?.country) ??
          inferCountryCodeFromText(found?.country) ??
          inferCountryCodeFromText(found?.location) ??
          inferCountryCodeFromText(found?.name)
        if (cancelled) return
        queueMicrotask(() => {
          if (name && !hasNameFromPayload) setLastNodeLabel(name)
          if (cc) setLastNodeCountryCode(cc)
        })
      } catch {
        // ignore (leave uuid)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, user, profileId])

  if (!isOpen) return null

  return (
    <ModalShell
      isOpen={isOpen}
      title={user?.username || 'Пользователь'}
      subtitle={user?.shortUuid || userUuid}
      onClose={onClose}
      closeButtonTone="danger"
      shellTone="neutral"
      size="full"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onClose} className={modalSecondaryButtonClass}>
            Закрыть
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="py-12 text-center text-dim text-base">Загрузка...</div>
      ) : error ? (
        <div className="py-12 text-center text-red-300 text-base">{error}</div>
      ) : !user ? (
        <div className="py-12 text-center text-dim text-base">Нет данных</div>
      ) : (
        <div className="space-y-6">
          {/* Статус и основное */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5 bg-overlay-xs border border-default rounded-2xl">
            <StatusBadge status={user.status} />
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl sm:text-3xl font-bold text-[var(--accent)]">{formatBytes(user.usedTrafficBytes)}</div>
                <div className="text-sm text-muted">Использовано</div>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-bold text-primary">{user.trafficLimitBytes ? formatBytes(user.trafficLimitBytes) : '∞'}</div>
                <div className="text-sm text-muted">Лимит</div>
              </div>
              <div>
                <div className="text-base sm:text-lg font-semibold text-primary">{fmtDate(user.expireAt)}</div>
                <div className="text-sm text-muted">Истекает</div>
              </div>
              <div>
                <div className="text-base sm:text-lg font-semibold text-primary">{fmtDate(user.onlineAt)}</div>
                <div className="text-sm text-muted">Последний онлайн</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Идентификаторы */}
            <div className="bg-overlay-xs border border-default rounded-2xl p-4 sm:p-5">
              <h3 className="text-primary font-semibold mb-3 flex items-center gap-2 text-base sm:text-lg">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                Идентификаторы
              </h3>
              <InfoRow label="Username" value={user.username || '—'} />
              <InfoRow label="Short UUID" value={<>{user.shortUuid || '—'}<CopyButton text={user.shortUuid || ''} /></>} mono />
              <InfoRow label="UUID" value={<>{user.uuid.slice(0, 16)}...<CopyButton text={user.uuid} /></>} mono />
              <InfoRow label="Telegram ID" value={<>{user.telegramId || '—'}<CopyButton text={user.telegramId ? String(user.telegramId) : ''} /></>} mono />
              {user.email && <InfoRow label="Email" value={user.email} />}
              {user.tag && <InfoRow label="Тег" value={user.tag} />}
            </div>

            {/* Подписка */}
            <div className="bg-overlay-xs border border-default rounded-2xl p-4 sm:p-5">
              <h3 className="text-primary font-semibold mb-3 flex items-center gap-2 text-base sm:text-lg">
                <span className="w-2 h-2 bg-[var(--accent)] rounded-full"></span>
                Подписка
              </h3>
              <InfoRow label="Ссылка на подписку" value={
                user.subscriptionUrl ? (
                  <span className="flex items-start gap-1">
                    <span className="break-all text-primary">{user.subscriptionUrl}</span>
                    <CopyButton text={user.subscriptionUrl} />
                  </span>
                ) : '—'
              } />
              <InfoRow label="Стратегия лимита" value={user.trafficLimitStrategy || 'NO_RESET'} />
              <InfoRow label="Создан" value={fmtDate(user.createdAt)} />
              <InfoRow label="Первое подключение" value={fmtDate((user as any).firstConnectedAt)} />
              <InfoRow label="Последнее обновление" value={fmtDate(user.updatedAt)} />
            </div>
          </div>

          {/* Клиент */}
          <div className="bg-overlay-xs border border-default rounded-2xl p-4 sm:p-5">
            <h3 className="text-primary font-semibold mb-3 flex items-center gap-2 text-base sm:text-lg">
              <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
              Информация о клиенте
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              <InfoRow label="Последнее открытие подписки" value={fmtDate(user.subLastOpenedAt)} />
              <InfoRow label="User-Agent" value={
                <span className="text-sm sm:text-base break-all text-secondary" title={user.subLastUserAgent || ''}>
                  {user.subLastUserAgent || '—'}
                </span>
              } />
              <InfoRow
                label="Последняя нода"
                value={
                  <span className="inline-flex items-center justify-end gap-2">
                    {(() => {
                      const FlagComponent = getFlagComponent(lastNodeCountryCode)
                      if (!FlagComponent) return null
                      return (
                        <span title={lastNodeCountryCode || undefined} className="inline-flex">
                          <FlagComponent className="w-4 h-3 rounded-sm border border-default flex-shrink-0" />
                        </span>
                      )
                    })()}
                    <span className="truncate max-w-[240px]" title={lastNodeLabel}>
                      {lastNodeLabel}
                    </span>
                  </span>
                }
              />
              <InfoRow label="Лимит устройств" value={(user as any).hwidDeviceLimit ?? 'Не ограничен'} />
            </div>
          </div>

          {/* Ключи доступа */}
          <div className="bg-overlay-xs border border-default rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-primary font-semibold flex items-center gap-2 text-base sm:text-lg">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                Ключи доступа
              </h3>
              <button
                onClick={() => setShowKeys(!showKeys)}
                className="px-3 py-1.5 text-sm bg-overlay-xs hover:bg-overlay-sm text-secondary border border-default rounded-xl transition-colors"
              >
                {showKeys ? 'Скрыть' : 'Показать'}
              </button>
            </div>
            {showKeys ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-4 bg-overlay-sm border border-default rounded-xl">
                  <span className="text-muted text-sm sm:text-base">VLESS UUID</span>
                  <span className="font-mono text-sm sm:text-base text-primary flex items-center">
                    {(user as any).vlessUuid || '—'}
                    <CopyButton text={(user as any).vlessUuid || ''} />
                  </span>
                </div>
                <div className="flex items-center justify-between p-4 bg-overlay-sm border border-default rounded-xl">
                  <span className="text-muted text-sm sm:text-base">Trojan пароль</span>
                  <span className="font-mono text-sm sm:text-base text-primary flex items-center">
                    {(user as any).trojanPassword || '—'}
                    <CopyButton text={(user as any).trojanPassword || ''} />
                  </span>
                </div>
                <div className="flex items-center justify-between p-4 bg-overlay-sm border border-default rounded-xl">
                  <span className="text-muted text-sm sm:text-base">Shadowsocks пароль</span>
                  <span className="font-mono text-sm sm:text-base text-primary flex items-center">
                    {(user as any).ssPassword || '—'}
                    <CopyButton text={(user as any).ssPassword || ''} />
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-muted text-sm sm:text-base">Нажмите "Показать" для просмотра ключей</div>
            )}
          </div>

        </div>
      )}
    </ModalShell>
  )
}
