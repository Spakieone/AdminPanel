import { useCallback, useEffect, useState } from 'react'
import type { RemnawaveUser, RemnawaveUsersResponse, RemnawaveUserStatus } from '../../api/types'
import { getRemnawaveUsers, remnawaveUserResetTraffic } from '../../api/client'
import ConfirmModal from '../common/ConfirmModal'
import UserDetailsModal from './UserDetailsModal'
import DarkSelect, { type DarkSelectGroup } from '../common/DarkSelect'

function formatBytes(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0)
  if (!Number.isFinite(b) || b <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(b) / Math.log(k)))
  const v = b / Math.pow(k, i)
  return `${v.toFixed(v >= 10 ? 1 : 2)} ${sizes[i]}`
}

function fmtDate(s: any): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function parseMs(s: unknown): number | null {
  if (!s) return null
  const d = new Date(String(s))
  const ms = d.getTime()
  return Number.isFinite(ms) ? ms : null
}

function StatusBadge({ status }: { status: RemnawaveUserStatus | null | undefined }) {
  const s = String(status ?? '').toUpperCase()
  const config: Record<string, { bg: string; text: string; label: string }> = {
    'ACTIVE': { bg: 'bg-accent-20', text: 'text-[var(--accent)]', label: 'Активен' },
    'DISABLED': { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Отключён' },
    'LIMITED': { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Лимит' },
    'EXPIRED': { bg: 'bg-overlay-sm', text: 'text-muted', label: 'Истёк' },
  }
  const c = config[s] || { bg: 'bg-overlay-sm', text: 'text-muted', label: status || '—' }
  return <span className={`${c.bg} ${c.text} px-2 py-0.5 rounded text-xs font-medium`}>{c.label}</span>
}

// Умное определение типа поиска
function detectSearchType(query: string): 'telegram' | 'shortUuid' | 'username' {
  const q = query.trim()
  // Только цифры — это Telegram ID
  if (/^\d+$/.test(q)) return 'telegram'
  // Короткий код (6-20 символов, буквы/цифры/дефис/подчеркивание) — Short UUID
  if (/^[a-zA-Z0-9_-]{6,20}$/.test(q) && /[_-]/.test(q)) return 'shortUuid'
  // Иначе — username
  return 'username'
}

type Action = { kind: 'reset'; user: RemnawaveUser } | null

export default function UsersTable({ profileId }: { profileId?: string }) {
  const ONLINE_WINDOW_MS = 35_000
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [searchResults, setSearchResults] = useState<RemnawaveUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<RemnawaveUsersResponse | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [lastListRefreshAt, setLastListRefreshAt] = useState<number>(Date.now())

  const pageSizeGroups = [
    {
      options: [
        { value: '25', label: '25' },
        { value: '50', label: '50' },
        { value: '100', label: '100' },
      ],
    },
  ] satisfies DarkSelectGroup[]

  // Загрузка списка
  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await getRemnawaveUsers(profileId, page * pageSize, pageSize)
      setData(res)
      setLastListRefreshAt(Date.now())
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [profileId, page, pageSize])

  useEffect(() => {
    if (!isSearchMode) loadUsers()
  }, [loadUsers, isSearchMode])

  // Умный поиск
  const doSearch = async () => {
    const q = searchQuery.trim()
    if (!q) { clearSearch(); return }

    setLoading(true)
    setError('')
    setIsSearchMode(true)

    const searchType = detectSearchType(q)
    const endpoints: Record<string, string> = {
      username: `by-username/${encodeURIComponent(q)}`,
      telegram: `by-telegram-id/${encodeURIComponent(q)}`,
      shortUuid: `by-short-uuid/${encodeURIComponent(q)}`,
    }

    try {
      const url = `/webpanel/api/remnawave/users/${endpoints[searchType]}${profileId ? `?profile_id=${profileId}` : ''}`
      const res = await fetch(url, { credentials: 'include' })
      
      if (res.status === 404) {
        setSearchResults([])
      } else if (!res.ok) {
        throw new Error(`Ошибка ${res.status}`)
      } else {
        const raw = await res.json()
        const d = raw?.response ?? raw
        const arr = Array.isArray(d) ? d : d ? [d] : []
        setSearchResults(arr.map((u: any) => ({
          ...u,
          usedTrafficBytes: u.usedTrafficBytes ?? u.userTraffic?.usedTrafficBytes ?? 0,
          onlineAt: u.onlineAt ?? u.userTraffic?.onlineAt,
        })))
        setLastListRefreshAt(Date.now())
      }
    } catch (e: any) {
      setError(e?.message || 'Ошибка поиска')
      setSearchResults([])
    } finally {
      setLoading(false)
    }
  }

  const clearSearch = () => {
    setSearchQuery('')
    setIsSearchMode(false)
    setSearchResults([])
  }

  // Действия
  const executeAction = async () => {
    if (!action) return
    const { kind, user } = action
    setLoading(true)
    try {
      if (kind === 'reset') await remnawaveUserResetTraffic(profileId, user.uuid)
      setAction(null)
      if (isSearchMode) {
        await doSearch()
      } else {
        await loadUsers()
      }
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  const users = isSearchMode ? searchResults : (data?.users || [])
  const total = isSearchMode ? searchResults.length : (data?.total || 0)
  const totalPages = Math.ceil(total / pageSize) || 1

  const actionLabels: Record<string, { title: string; msg: (n: string) => string; btn: string }> = {
    reset: { title: 'Сбросить трафик', msg: n => `Обнулить счётчик трафика для "${n}"?`, btn: 'Сбросить' },
  }

  return (
    <div className="space-y-4">
      {/* Панель управления */}
      <div className="glass-panel p-4 sm:p-5 md:p-6 transition-smooth rounded-xl">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          {/* Заголовок */}
          <div className="flex-shrink-0">
            <h2 className="text-xl sm:text-2xl font-semibold text-primary">Пользователи</h2>
            <p className="text-sm sm:text-base text-dim">
              {isSearchMode ? `Найдено: ${total}` : `Всего: ${total} • Стр. ${page + 1}/${totalPages}`}
            </p>
          </div>

          {/* Поиск */}
          <div className="flex-1 flex gap-2">
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              placeholder="Поиск по username, Telegram ID или Short UUID..."
              className="flex-1 px-4 py-2.5 bg-overlay-xs border border-default rounded-xl text-primary text-base placeholder:text-faint focus:border-[var(--accent)]/70 focus:ring-2 focus:ring-accent-20 focus:outline-none"
            />
            <button
              onClick={doSearch}
              disabled={!searchQuery.trim()}
              className="px-4 py-2.5 bg-[rgb(var(--accent-rgb)/0.10)] hover:bg-[rgb(var(--accent-rgb)/0.18)] disabled:bg-overlay-md disabled:text-muted text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)] text-sm sm:text-base font-semibold rounded-xl transition-colors"
            >
              Найти
            </button>
            {isSearchMode && (
              <button
                onClick={clearSearch}
                className="px-4 py-2.5 bg-overlay-xs hover:bg-overlay-sm text-primary text-sm sm:text-base rounded-xl transition-colors border border-default"
                title="Сбросить поиск"
              >
                ✕
              </button>
            )}
          </div>

          {/* Пагинация */}
          {!isSearchMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-2.5 bg-overlay-xs hover:bg-overlay-sm disabled:opacity-40 text-primary text-sm sm:text-base rounded-xl transition-colors border border-default"
                title="Предыдущая страница"
              >
                ←
              </button>
              <span className="text-sm sm:text-base text-dim min-w-[72px] text-center">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= totalPages - 1}
                className="px-3 py-2.5 bg-overlay-xs hover:bg-overlay-sm disabled:opacity-40 text-primary text-sm sm:text-base rounded-xl transition-colors border border-default"
                title="Следующая страница"
              >
                →
              </button>
              <div className="min-w-[110px]" title="Размер страницы">
                <DarkSelect
                  value={String(pageSize)}
                  onChange={(v) => {
                    setPageSize(Number(v))
                    setPage(0)
                  }}
                  groups={pageSizeGroups}
                  buttonClassName="w-full px-3 py-2.5 bg-overlay-xs border border-default rounded-xl text-primary text-sm sm:text-base"
                />
              </div>
            </div>
          )}
        </div>

        {error && <div className="mt-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm sm:text-base">{error}</div>}
      </div>

      {/* Таблица */}
      <div className="glass-table overflow-hidden table-container rounded-xl">
        {loading && users.length === 0 ? (
          <div className="p-10 text-center text-dim text-base">Загрузка...</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-dim text-base">{isSearchMode ? 'Ничего не найдено' : 'Нет пользователей'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-default text-left text-sm text-dim tracking-wide">
                  <th className="px-5 py-4 font-semibold">Пользователь</th>
                  <th className="px-5 py-4 font-semibold">Telegram</th>
                  <th className="px-5 py-4 font-semibold">Статус</th>
                  <th className="px-5 py-4 font-semibold">Трафик</th>
                  <th className="px-5 py-4 font-semibold">Истекает</th>
                  <th className="px-5 py-4 font-semibold text-right">Онлайн</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {users.map(user => {
                  const used = Number(user.usedTrafficBytes ?? 0)
                  const limit = user.trafficLimitBytes ? Number(user.trafficLimitBytes) : null
                  const onlineAtMs = parseMs((user as any).onlineAt ?? (user as any).userTraffic?.onlineAt)
                  const isOnline = typeof onlineAtMs === 'number' && (lastListRefreshAt - onlineAtMs) <= ONLINE_WINDOW_MS
                  
                  return (
                    <tr 
                      key={user.uuid} 
                      className="hover:bg-overlay-xs cursor-pointer transition-colors"
                      onClick={() => setSelectedUser(user.uuid)}
                    >
                      <td className="px-5 py-4">
                        <div className="font-semibold text-primary text-base">{user.username || '—'}</div>
                        <div className="text-sm text-muted font-mono">{user.shortUuid || user.uuid.slice(0, 8)}</div>
                      </td>
                      <td className="px-5 py-4 text-secondary font-mono text-base">{user.telegramId || '—'}</td>
                      <td className="px-5 py-4"><StatusBadge status={user.status} /></td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-between gap-3" onClick={e => e.stopPropagation()}>
                          <div className="min-w-0">
                            <span className={`font-mono text-base ${used > 0 ? 'text-[var(--accent)]' : 'text-muted'}`}>
                          {formatBytes(used)}
                        </span>
                            {limit && <span className="text-muted text-base"> / {formatBytes(limit)}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => setAction({ kind: 'reset', user })}
                            className="shrink-0 px-3 py-1.5 text-sm bg-accent-10 hover:bg-accent-20 text-[var(--accent)] rounded-lg border border-accent-20 transition-colors"
                            title="Сбросить трафик"
                          >
                            Сброс
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-secondary text-base">{fmtDate(user.expireAt)}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-3">
                          <span
                            className={`inline-flex h-2.5 w-2.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-[var(--border-strong)]'}`}
                            title={isOnline ? 'Онлайн' : 'Оффлайн'}
                          />
                          <div className="text-right min-w-[150px]">
                            <div className={`text-base font-medium ${isOnline ? 'text-green-500' : 'text-dim'}`}>
                              {isOnline ? 'Онлайн' : 'Оффлайн'}
                            </div>
                            <div className="text-sm text-muted">
                              {onlineAtMs ? fmtDate(new Date(onlineAtMs)) : '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Модалка деталей */}
      {selectedUser && (
        <UserDetailsModal
          isOpen
          profileId={profileId}
          userUuid={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}

      {/* Модалка подтверждения */}
      {action && (
        <ConfirmModal
          isOpen
          title={actionLabels[action.kind].title}
          message={actionLabels[action.kind].msg(action.user.username || action.user.shortUuid || action.user.uuid)}
          confirmText={actionLabels[action.kind].btn}
          onConfirm={executeAction}
          onCancel={() => setAction(null)}
        />
      )}
    </div>
  )
}
