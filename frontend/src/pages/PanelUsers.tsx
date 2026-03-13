import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createPanelUser,
  deletePanelUser,
  disablePanelUser2FA,
  getAuthSessionInfo,
  getPanelAuditLog,
  getPanelRoles,
  getPanelUsers,
  getTelegramMeta,
  trackPanelAuditEvent,
  updatePanelRole,
  updatePanelUser,
} from '../api/client'
import TwoFactorSetup from '../components/settings/TwoFactorSetup'
import type { PanelAuditLogItem, PanelRbacResource, PanelRole, PanelUser, PanelUserRole } from '../api/types'
import { useToastContext } from '../contexts/ToastContext'
import ConfirmModal from '../components/common/ConfirmModal'
import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../components/common/ModalShell'
import DarkSelect, { type DarkSelectGroup } from '../components/common/DarkSelect'
import GlassTabs from '../components/common/GlassTabs'

const RBAC_ACTIONS_4 = ['view', 'create', 'edit', 'delete'] as const
const RBAC_ACTION_LABEL: Record<(typeof RBAC_ACTIONS_4)[number], string> = {
  view: 'Просмотр',
  create: 'Создание',
  edit: 'Редакт.',
  delete: 'Удаление',
}

function setEquals(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

export default function PanelUsers({ embedded = false }: { embedded?: boolean } = {}) {
  const toast = useToastContext()

  const [authInfo, setAuthInfo] = useState<{ username?: string; role?: string } | null>(null)
  const [tab, setTab] = useState<'users' | 'roles' | 'logs'>('users')

  const [panelUsers, setPanelUsers] = useState<PanelUser[]>([])
  const [roles, setRoles] = useState<PanelRole[]>([])
  const [panelUserRoles, setPanelUserRoles] = useState<PanelUserRole[]>(['manager', 'operator', 'viewer'])
  const [rbacResources, setRbacResources] = useState<PanelRbacResource[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createData, setCreateData] = useState<{ username: string; password: string; role: PanelUserRole; tg_id: string }>({
    username: '',
    password: '',
    role: 'operator',
    tg_id: '',
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'disabled'>('all')
  const [sortBy, setSortBy] = useState<'username' | 'role' | 'last_login'>('username')

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; username: string } | null>(null)
  const [selectedUser, setSelectedUser] = useState<PanelUser | null>(null)
  const [tgBotId, setTgBotId] = useState<number | null>(null)
  const tgPopupRef = useRef<Window | null>(null)
  const tgLinkingUserRef = useRef<PanelUser | null>(null)
  const [tgManualInputUserId, setTgManualInputUserId] = useState<string | null>(null)
  const [tgManualInputValue, setTgManualInputValue] = useState('')

  const [selectedRoleName, setSelectedRoleName] = useState<string>('manager')
  const [roleDraftTitle, setRoleDraftTitle] = useState('')
  const [roleDraftDescription, setRoleDraftDescription] = useState('')
  const [roleDraftPerms, setRoleDraftPerms] = useState<Set<string>>(new Set())
  const [savingRole, setSavingRole] = useState(false)

  const notify = (type: 'success' | 'error' | 'info', message: string) => {
    if (type === 'success') toast.showSuccess('Готово', message, 3000)
    else if (type === 'error') toast.showError('Ошибка', message, 4500)
    else toast.showInfo('Информация', message, 3500)
  }

  const isSuperAdmin = useMemo(() => {
    const role = String(authInfo?.role || 'super_admin').toLowerCase()
    return role === 'super_admin' || role === 'owner'
  }, [authInfo?.role])

  const roleTitleByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of roles || []) {
      if (r?.name) m.set(String(r.name), String(r.title || r.name))
    }
    return m
  }, [roles])

  const roleGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: (panelUserRoles || ['manager', 'operator', 'viewer']).map((r) => ({
          value: String(r),
          label: roleTitleByName.get(String(r)) || String(r),
        })),
      },
    ],
    [panelUserRoles, roleTitleByName],
  )
  const userRoleFilterGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: [
          { value: 'all', label: 'Все роли' },
          ...(panelUserRoles || []).map((r) => ({
            value: String(r),
            label: roleTitleByName.get(String(r)) || String(r),
          })),
          { value: 'super_admin', label: roleTitleByName.get('super_admin') || 'super_admin' },
        ],
      },
    ],
    [panelUserRoles, roleTitleByName],
  )

  const roleBadgeClass = (roleName: string) => {
    const key = String(roleName || '').toLowerCase()
    if (key === 'super_admin' || key === 'owner') return 'border-red-500/25 bg-red-500/10 text-red-100'
    if (key === 'manager') return 'border-sky-500/25 bg-sky-500/10 text-sky-100'
    if (key === 'operator') return 'border-amber-500/25 bg-amber-500/10 text-amber-100'
    if (key === 'viewer') return 'border-default bg-overlay-sm text-dim'
    return 'border-violet-500/25 bg-violet-500/10 text-violet-100'
  }

  // --- Audit log (admins only) ---
  const [auditItems, setAuditItems] = useState<PanelAuditLogItem[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditLimit, setAuditLimit] = useState(50)
  const [auditOffset, setAuditOffset] = useState(0)
  const [auditActorInput, setAuditActorInput] = useState('')
  const [auditActionInput, setAuditActionInput] = useState('')
  const [auditActor, setAuditActor] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const auditViewTrackedRef = useRef(false)

  const tabs = useMemo(
    () => [
      { id: 'users', label: 'Пользователи', count: panelUsers.length },
      { id: 'roles', label: 'Роли', count: roles.length },
      { id: 'logs', label: 'Логи', count: auditTotal },
    ],
    [auditTotal, panelUsers.length, roles.length],
  )

  const auditActionBadgeClass = (actionName: string) => {
    const a = String(actionName || '').toLowerCase()
    if (a === 'panel_user.create') return 'border-accent-25 bg-accent-10 text-[var(--accent)]'
    if (a === 'panel_user.update') return 'border-amber-500/25 bg-amber-500/10 text-amber-100'
    if (a === 'panel_user.delete') return 'border-red-500/25 bg-red-500/10 text-red-100'
    if (a === 'panel_role.update') return 'border-sky-500/25 bg-sky-500/10 text-sky-100'
    if (a === 'key.create') return 'border-accent-25 bg-accent-10 text-[var(--accent)]'
    if (a === 'key.update') return 'border-amber-500/25 bg-amber-500/10 text-amber-100'
    if (a === 'key.reissue_full') return 'border-sky-500/25 bg-sky-500/10 text-sky-100'
    if (a === 'key.reissue_link') return 'border-violet-500/25 bg-violet-500/10 text-violet-100'
    if (a === 'key.reset_traffic') return 'border-amber-500/25 bg-amber-500/10 text-amber-100'
    if (a === 'key.view_traffic') return 'border-default bg-overlay-sm text-secondary'
    if (a === 'key.freeze') return 'border-red-500/25 bg-red-500/10 text-red-100'
    if (a === 'key.delete') return 'border-red-500/25 bg-red-500/10 text-red-100'
    if (a === 'github_update.run') return 'border-accent-25 bg-accent-10 text-[var(--accent)]'
    if (a === 'github_update.check') return 'border-sky-500/25 bg-sky-500/10 text-sky-100'
    if (a === 'panel_audit.view') return 'border-default bg-overlay-sm text-secondary'
    if (a === 'ui.page_view') return 'border-default bg-overlay-sm text-secondary'
    return 'border-violet-500/25 bg-violet-500/10 text-violet-100'
  }

  const auditActionLabel = (actionName: string) => {
    const a = String(actionName || '').toLowerCase()
    if (a === 'panel_user.create') return 'Создание пользователя'
    if (a === 'panel_user.update') return 'Изменение пользователя'
    if (a === 'panel_user.delete') return 'Удаление пользователя'
    if (a === 'panel_role.update') return 'Изменение роли'
    if (a === 'key.create') return 'Создание подписки'
    if (a === 'key.update') return 'Изменение подписки'
    if (a === 'key.reissue_full') return 'Перевыпуск подписки'
    if (a === 'key.reissue_link') return 'Смена ссылки'
    if (a === 'key.reset_traffic') return 'Сброс трафика'
    if (a === 'key.view_traffic') return 'Просмотр трафика'
    if (a === 'key.freeze') return 'Заморозка/разморозка'
    if (a === 'key.delete') return 'Удаление подписки'
    if (a === 'github_update.run') return 'Запуск обновления панели'
    if (a === 'github_update.check') return 'Проверка GitHub'
    if (a === 'panel_audit.view') return 'Просмотр логов'
    if (a === 'ui.page_view') return 'Переход по страницам'
    return String(actionName || '—')
  }

  const applyAuditFilters = (next?: { actor?: string; action?: string }) => {
    const actor = String(next?.actor ?? '').trim()
    const action = String(next?.action ?? '').trim()
    setAuditOffset(0)
    setAuditActorInput(actor)
    setAuditActionInput(action)
    setAuditActor(actor)
    setAuditAction(action)
  }

  const renderAuditMeta = (it: PanelAuditLogItem) => {
    const m: any = (it as any)?.meta
    if (!m) return <span className="text-muted">—</span>

    // Common: UI page views
    if (m && typeof m === 'object' && m.path) {
      const s = String(m.path || '')
      return (
        <span className="text-dim">
          <span className="text-muted">path:</span> <span className="font-mono">{s}</span>
        </span>
      )
    }

    // Common: key actions
    if (m && typeof m === 'object' && (m.key_id || m.client_id)) {
      const keyId = String(m.key_id || m.client_id || '')
      const tg = m.tg_id != null ? String(m.tg_id) : ''
      const parts: string[] = []
      if (tg) parts.push(`tg:${tg}`)
      if (keyId) parts.push(`key:${keyId}`)
      if (m.tariff) parts.push(`tariff:${String(m.tariff)}`)
      if (m.frozen != null) parts.push(`frozen:${String(Boolean(m.frozen))}`)
      return <span className="text-dim font-mono text-[12px]">{parts.join(' ') || '—'}</span>
    }

    // Common: user updates
    if (m && typeof m === 'object' && m.changes && typeof m.changes === 'object') {
      const entries = Object.entries(m.changes as Record<string, any>)
      const parts = entries.slice(0, 4).map(([k, v]) => {
        if (k === 'password') return 'password: changed'
        if (v && typeof v === 'object' && ('from' in v || 'to' in v)) {
          const from = (v as any).from
          const to = (v as any).to
          return `${k}: ${String(from)}→${String(to)}`
        }
        return `${k}: ${String(v)}`
      })
      const more = Math.max(0, entries.length - parts.length)
      const s = parts.join(', ') + (more ? ` +${more}` : '')
      return <span className="text-dim font-mono text-[12px]">{s}</span>
    }

    // Common: role updates
    if (m && typeof m === 'object' && (Array.isArray(m.permissions_added) || Array.isArray(m.permissions_removed))) {
      const added = Array.isArray(m.permissions_added) ? m.permissions_added.length : 0
      const removed = Array.isArray(m.permissions_removed) ? m.permissions_removed.length : 0
      const total = Number(m.permissions_total || 0)
      return (
        <span className="text-dim font-mono text-[12px]">
          perms: +{added} / -{removed} (total {total})
        </span>
      )
    }

    // Fallback: json
    let meta = ''
    try {
      meta = typeof m === 'string' ? m : JSON.stringify(m)
    } catch {
      meta = ''
    }
    if (meta.length > 220) meta = `${meta.slice(0, 220)}…`
    return <span className="text-dim font-mono text-[12px]">{meta || '—'}</span>
  }

  function togglePerm(resourceKey: string, action: string) {
    const key = `${resourceKey}:${action}`
    setRoleDraftPerms((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function load() {
    try {
      setError(null)
      setLoading(true)
      const info = await getAuthSessionInfo()
      setAuthInfo({ username: info.username, role: info.role })

      const role = String(info.role || 'super_admin').toLowerCase()
      const ok = role === 'super_admin' || role === 'owner'
      if (!ok) {
        setPanelUsers([])
        setRoles([])
        return
      }

      const res = await getPanelUsers()
      setPanelUsers(Array.isArray(res.items) ? res.items : [])

      const rolesRes = await getPanelRoles()
      const roleItems = Array.isArray(rolesRes.roles) ? rolesRes.roles : []
      setRoles(roleItems)
      setRbacResources(Array.isArray(rolesRes.resources) ? rolesRes.resources : [])

      // Fill role list for create-user select from roles API.
      const roleNames = roleItems.map((r) => String(r.name)).filter(Boolean)
      const allowedForCreate = roleNames.filter((n) => n.toLowerCase() !== 'super_admin')
      if (allowedForCreate.length > 0) {
        setPanelUserRoles(allowedForCreate)
        if (!allowedForCreate.map((x) => x.toLowerCase()).includes(String(createData.role).toLowerCase())) {
          setCreateData((prev) => ({ ...prev, role: allowedForCreate[0] }))
        }
      } else if (res.roles && Array.isArray(res.roles) && res.roles.length > 0) {
        setPanelUserRoles(res.roles.filter((r) => String(r).toLowerCase() !== 'super_admin'))
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  const usersCountByRole = useMemo(() => {
    const m = new Map<string, { total: number; active: number }>()
    for (const u of panelUsers || []) {
      const r = String(u.role || 'viewer').toLowerCase()
      const prev = m.get(r) || { total: 0, active: 0 }
      prev.total += 1
      if (u.is_active) prev.active += 1
      m.set(r, prev)
    }
    return m
  }, [panelUsers])
  const filteredUsers = useMemo(() => {
    const q = String(searchQuery || '').trim().toLowerCase()
    const items = (panelUsers || []).filter((u) => {
      const role = String(u.role || '').toLowerCase()
      const username = String(u.username || '').toLowerCase()
      const tg = String(u.tg_id || '')
      const byRole = filterRole === 'all' ? true : role === String(filterRole).toLowerCase()
      const byActive =
        filterActive === 'all' ? true : filterActive === 'active' ? Boolean(u.is_active) : !Boolean(u.is_active)
      const bySearch = !q || username.includes(q) || tg.includes(q)
      return byRole && byActive && bySearch
    })
    items.sort((a, b) => {
      if (sortBy === 'role') return String(a.role || '').localeCompare(String(b.role || ''))
      if (sortBy === 'last_login') return Number(b.last_login_at || 0) - Number(a.last_login_at || 0)
      return String(a.username || '').localeCompare(String(b.username || ''))
    })
    return items
  }, [panelUsers, searchQuery, filterRole, filterActive, sortBy])

  const selectedRole = useMemo(() => {
    const want = String(selectedRoleName || '').toLowerCase()
    const found = (roles || []).find((r) => String(r.name || '').toLowerCase() === want)
    return found || (roles && roles.length > 0 ? roles[0] : null)
  }, [roles, selectedRoleName])

  const selectedRoleIsSuperAdmin = useMemo(() => {
    return String(selectedRole?.name || '').toLowerCase() === 'super_admin'
  }, [selectedRole?.name])

  const selectedRolePerms = useMemo(() => new Set((selectedRole?.permissions || []).map(String)), [selectedRole?.permissions])
  const roleDirty = useMemo(() => {
    if (!selectedRole) return false
    const t = String(selectedRole.title || '')
    const d = String(selectedRole.description || '')
    return t !== String(roleDraftTitle) || d !== String(roleDraftDescription) || !setEquals(selectedRolePerms, roleDraftPerms)
  }, [selectedRole, roleDraftTitle, roleDraftDescription, roleDraftPerms, selectedRolePerms])

  useEffect(() => {
    if (!roles || roles.length === 0) return
    const want = String(selectedRoleName || '').toLowerCase()
    const exists = roles.some((r) => String(r.name || '').toLowerCase() === want)
    if (exists) return
    const manager = roles.find((r) => String(r.name || '').toLowerCase() === 'manager')
    setSelectedRoleName(String(manager?.name || roles[0].name || 'manager'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles])

  useEffect(() => {
    if (!selectedRole) return
    setRoleDraftTitle(String(selectedRole.title || selectedRole.name || ''))
    setRoleDraftDescription(String(selectedRole.description || ''))
    setRoleDraftPerms(new Set((selectedRole.permissions || []).map(String)))
  }, [selectedRole?.name])

  useEffect(() => {
    void load()
    getTelegramMeta().then((d) => {
      if (d?.ok && d.bot_id) setTgBotId(d.bot_id)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle Telegram Login Widget postMessage
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== 'https://oauth.telegram.org') return
      const data = e.data
      if (!data || typeof data !== 'object') return
      const tgId = data.id ? Number(data.id) : null
      if (!tgId) return
      const user = tgLinkingUserRef.current
      if (!user) return
      tgLinkingUserRef.current = null
      tgPopupRef.current?.close()
      void (async () => {
        try {
          await updatePanelUser(user.id, { tg_id: tgId })
          notify('success', `Telegram привязан: ${data.username || tgId}`)
          await load()
        } catch (err: unknown) {
          notify('error', err instanceof Error ? err.message : 'Ошибка привязки Telegram')
        }
      })()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(): Promise<boolean> {
    try {
      setError(null)
      const username = String(createData.username || '').trim()
      const password = String(createData.password || '')
      const role = String(createData.role || 'operator') as PanelUserRole
      const tgIdStr = String(createData.tg_id || '').trim()
      const tg_id = tgIdStr ? Number(tgIdStr) : null

      if (!username) {
        notify('error', 'Введите username')
        return false
      }
      if (!password || password.length < 8) {
        notify('error', 'Пароль минимум 8 символов')
        return false
      }
      if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        notify('error', 'Пароль должен содержать буквы и цифры')
        return false
      }
      if (tgIdStr && !Number.isFinite(tg_id)) {
        notify('error', 'tg_id должен быть числом')
        return false
      }

      await createPanelUser({ username, password, role, tg_id: tg_id ?? undefined, is_active: true })
      setCreateData({ username: '', password: '', role: 'operator', tg_id: '' })
      notify('success', 'Пользователь создан')
      await load()
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ошибка создания пользователя'
      setError(msg)
      notify('error', msg)
      return false
    }
  }

  async function loadAudit() {
    try {
      setAuditLoading(true)
      const res = await getPanelAuditLog({
        limit: auditLimit,
        offset: auditOffset,
        actor: auditActor ? auditActor : undefined,
        action: auditAction ? auditAction : undefined,
      })
      setAuditItems(Array.isArray(res?.items) ? res.items : [])
      setAuditTotal(Number(res?.total || 0))
    } catch (_e) {
      setAuditItems([])
      setAuditTotal(0)
    } finally {
      setAuditLoading(false)
    }
  }

  useEffect(() => {
    if (!isSuperAdmin) return
    if (tab !== 'logs') return
    void loadAudit()
    if (!auditViewTrackedRef.current) {
      auditViewTrackedRef.current = true
      void trackPanelAuditEvent({ action: 'panel_audit.view', meta: { page: 'admin' } }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isSuperAdmin, auditLimit, auditOffset, auditActor, auditAction])

  async function handleToggleActive(u: PanelUser) {
    try {
      setError(null)
      await updatePanelUser(u.id, { is_active: !u.is_active })
      await load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ошибка обновления пользователя'
      setError(msg)
      notify('error', msg)
    }
  }

  async function handleResetPassword(u: PanelUser) {
    const pwd = window.prompt(`Новый пароль для "${u.username}" (минимум 8 символов, буквы и цифры):`)
    if (!pwd) return
    try {
      setError(null)
      await updatePanelUser(u.id, { password: pwd })
      notify('success', 'Пароль обновлён')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ошибка смены пароля'
      setError(msg)
      notify('error', msg)
    }
  }

  async function saveRole() {
    if (!selectedRole) return
    try {
      setSavingRole(true)
      setError(null)
      const res = await updatePanelRole(selectedRole.name, {
        title: roleDraftTitle || undefined,
        description: roleDraftDescription || undefined,
        permissions: Array.from(roleDraftPerms),
      })
      notify('success', 'Права роли сохранены')
      setRoles((prev) => prev.map((r) => (r.name === res.role.name ? res.role : r)))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ошибка сохранения роли'
      setError(msg)
      notify('error', msg)
    } finally {
      setSavingRole(false)
    }
  }

  async function handleChangeUserRole(u: PanelUser, newRole: string) {
    try {
      setError(null)
      await updatePanelUser(u.id, { role: newRole })
      notify('success', `Роль обновлена: ${u.username}`)
      await load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ошибка обновления роли'
      setError(msg)
      notify('error', msg)
    }
  }

  async function handleSaveManualTgId(u: PanelUser) {
    const val = tgManualInputValue.trim()
    const id = Number(val)
    if (!val || !Number.isFinite(id) || id <= 0) { notify('error', 'Введите корректный Telegram ID (число)'); return }
    try {
      await updatePanelUser(u.id, { tg_id: id })
      notify('success', `Telegram привязан: ${id}`)
      setTgManualInputUserId(null)
      setTgManualInputValue('')
      await load()
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'Ошибка привязки')
    }
  }

  function handleLinkTelegram(u: PanelUser) {
    if (!tgBotId) {
      setTgManualInputUserId(u.id)
      setTgManualInputValue('')
      return
    }
    tgLinkingUserRef.current = u
    const url = new URL('https://oauth.telegram.org/auth')
    url.searchParams.set('bot_id', String(tgBotId))
    url.searchParams.set('origin', window.location.origin)
    url.searchParams.set('return_to', window.location.origin + '/webpanel/')
    url.searchParams.set('request_access', 'write')
    const w = 550, h = 470
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2)
    const top = Math.round(window.screenY + (window.outerHeight - h) / 2)
    const popup = window.open(url.toString(), 'tg_auth', `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,scrollbars=0`)
    tgPopupRef.current = popup
  }

  async function handleUnlinkTelegram(u: PanelUser) {
    try {
      await updatePanelUser(u.id, { tg_id: null })
      notify('success', 'Telegram отвязан')
      await load()
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function handleDisable2FA(u: PanelUser) {
    try {
      await disablePanelUser2FA(u.id)
      notify('success', `2FA отключена для ${u.username}`)
      await load()
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'Ошибка отключения 2FA')
    }
  }

  const assignableRoleGroups = useMemo<DarkSelectGroup[]>(
    () => [
      {
        options: (panelUserRoles || []).map((r) => ({
          value: String(r),
          label: roleTitleByName.get(String(r)) || String(r),
        })),
      },
    ],
    [panelUserRoles, roleTitleByName],
  )

  return (
    <div className={embedded ? 'space-y-4' : 'w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7 space-y-4'}>
      {authInfo?.username ? (
        <div className="mb-4 text-xs text-muted">
          Вы: <span className="text-secondary font-semibold">{authInfo.username}</span>{' '}
          {authInfo.role ? <span className="text-dim">({authInfo.role})</span> : null}
        </div>
      ) : null}

      {error && (
        <div className="mb-4 bg-red-500/15 border border-red-500/30 rounded-lg p-2.5 text-red-200 text-xs">
          {error}
        </div>
      )}

      {!isSuperAdmin ? (
        <div className="glass-panel p-4 sm:p-6">
          <div className="text-sm text-dim">
            Для управления войдите под аккаунтом с ролью <span className="font-semibold">super_admin</span>.
          </div>
        </div>
      ) : (
        <>
          {/* Tabs + actions row (NOT inside the card) */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <GlassTabs tabs={tabs} activeTab={tab} onTabChange={(key) => setTab(key as any)} className="flex-1" />
            <div className="flex items-center gap-2 justify-end">
              {tab === 'users' ? (
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="h-11 px-4 rounded-lg text-[15px] font-semibold border border-[rgb(var(--accent-rgb)/0.30)] bg-[rgb(var(--accent-rgb)/0.10)] hover:bg-[rgb(var(--accent-rgb)/0.18)] text-[var(--accent)]"
                >
                  Создать пользователя
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (tab === 'logs') void loadAudit()
                  else void load()
                }}
                className="h-11 px-4 rounded-lg text-[15px] font-semibold border border-default bg-[var(--bg-surface-hover)] hover:bg-overlay-md text-primary shadow-sm"
              >
                {loading || auditLoading ? 'Загрузка...' : 'Обновить'}
              </button>
            </div>
          </div>

          {/* Content card */}
          <div className="glass-panel p-4 sm:p-6">
            {tab === 'users' ? (
            <>
              {/* Search + filters */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-3">
                <div className="md:col-span-5">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-2.5 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary text-sm"
                    placeholder="Поиск по username или tg_id..."
                  />
                </div>
                <div className="md:col-span-3">
                  <DarkSelect
                    value={filterRole}
                    onChange={(v) => setFilterRole(String(v))}
                    groups={userRoleFilterGroups}
                    buttonClassName="filter-field"
                  />
                </div>
                <div className="md:col-span-2">
                  <DarkSelect
                    value={filterActive}
                    onChange={(v) => setFilterActive(String(v) as 'all' | 'active' | 'disabled')}
                    groups={[{ options: [{ value: 'all', label: 'Все статусы' }, { value: 'active', label: 'Активные' }, { value: 'disabled', label: 'Отключённые' }] }]}
                    buttonClassName="filter-field"
                  />
                </div>
                <div className="md:col-span-2">
                  <DarkSelect
                    value={sortBy}
                    onChange={(v) => setSortBy(String(v) as 'username' | 'role' | 'last_login')}
                    groups={[{ options: [{ value: 'username', label: 'По имени' }, { value: 'role', label: 'По роли' }, { value: 'last_login', label: 'По входу' }] }]}
                    buttonClassName="filter-field"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="rounded-xl border border-default overflow-hidden">
                <table className="w-full">
                  <thead className="bg-overlay-xs border-b border-default">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Пользователь</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider hidden sm:table-cell">Роль</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider hidden md:table-cell">Telegram</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider hidden lg:table-cell">Последний вход</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider hidden sm:table-cell">Статус</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {loading ? (
                      <tr><td colSpan={6} className="px-4 py-6 text-sm text-dim text-center">Загрузка...</td></tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-6 text-sm text-muted text-center">Нет пользователей</td></tr>
                    ) : filteredUsers.map((u) => {
                      const isSelf = authInfo?.username &&
                        String(authInfo.username).toLowerCase() === String(u.username).toLowerCase()
                      const roleLabel = roleTitleByName.get(String(u.role || '')) || String(u.role || 'operator')
                      const roleKey = String(u.role || 'viewer').toLowerCase()
                      return (
                        <tr
                          key={u.id}
                          className="hover:bg-overlay-xs transition-colors cursor-pointer group"
                          onClick={() => setSelectedUser(u)}
                        >
                          {/* User */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-accent-10 flex items-center justify-center shrink-0">
                                <span className="text-[var(--accent)] font-bold text-sm">{(u.username || 'U').slice(0, 1).toUpperCase()}</span>
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-primary flex items-center gap-1.5">
                                  {u.username}
                                  {isSelf && <span className="px-1.5 py-0.5 rounded text-[10px] border border-accent-25 bg-accent-10 text-[var(--accent)]">Вы</span>}
                                </div>
                                {u.totp_enabled && <span className="text-[11px] text-emerald-400">2FA вкл</span>}
                              </div>
                            </div>
                          </td>
                          {/* Role */}
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className={`px-2 py-0.5 rounded-md text-xs border ${roleBadgeClass(roleKey)}`}>{roleLabel}</span>
                          </td>
                          {/* Telegram */}
                          <td className="px-4 py-3 hidden md:table-cell">
                            {u.tg_id ? (
                              <span className="inline-flex items-center gap-1.5 text-[13px] text-[#2AABEE]">
                                <svg style={{width:12,height:12,flexShrink:0}} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.32 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.828.942z"/></svg>
                                <span className="font-mono">{String(u.tg_id)}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </td>
                          {/* Last login */}
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <span className="text-[13px] text-dim">
                              {u.last_login_at ? new Date(u.last_login_at * 1000).toLocaleString() : '—'}
                            </span>
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3 hidden sm:table-cell">
                            {u.is_active ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                Активен
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-red-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                                Отключён
                              </span>
                            )}
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setSelectedUser(u); }}
                                className="h-8 px-3 rounded-lg text-xs border border-default bg-overlay-sm hover:bg-overlay-md text-secondary transition-colors"
                              >
                                Изменить
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(isSelf)}
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: u.id, username: u.username }); }}
                                className={`h-8 px-3 rounded-lg text-xs border transition-colors ${
                                  isSelf
                                    ? 'border-red-500/10 bg-red-500/5 text-red-200/30 cursor-not-allowed'
                                    : 'border-red-500/25 bg-red-500/10 hover:bg-red-500/20 text-red-400'
                                }`}
                                title={isSelf ? 'Нельзя удалить себя' : 'Удалить'}
                              >
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!loading && (
                  <div className="px-4 py-2.5 border-t border-default bg-overlay-xs">
                    <span className="text-xs text-muted">
                      Показано: <span className="text-secondary font-semibold">{filteredUsers.length}</span> из <span className="text-secondary font-semibold">{panelUsers.length}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* User edit modal */}
              {selectedUser && (() => {
                const u = selectedUser
                const isSelf = authInfo?.username &&
                  String(authInfo.username).toLowerCase() === String(u.username).toLowerCase()
                const isSuper = String(u.role || '').toLowerCase() === 'super_admin'
                const roleKey = String(u.role || 'viewer').toLowerCase()
                return (
                  <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4" onClick={() => setSelectedUser(null)}>
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
                    <div
                      className="relative w-full max-w-[480px] max-h-[85vh] overflow-y-auto rounded-2xl border border-default bg-[var(--bg-sidebar)] shadow-2xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Modal header */}
                      <div className="flex items-center justify-between px-5 py-4 border-b border-default">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-accent-10 flex items-center justify-center shrink-0">
                            <span className="text-[var(--accent)] font-bold">{(u.username || 'U').slice(0, 1).toUpperCase()}</span>
                          </div>
                          <div>
                            <p className="text-base font-semibold text-primary">{u.username}</p>
                            <p className="text-xs text-faint mt-0.5">{roleTitleByName.get(String(u.role || '')) || String(u.role || '')}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => setSelectedUser(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-faint hover:text-secondary hover:bg-overlay-sm transition-colors">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>

                      <div className="px-5 py-4 space-y-4">
                        {/* Status */}
                        <div className="flex items-center justify-between py-2 border-b border-default">
                          <span className="text-sm text-secondary">Статус</span>
                          <button
                            type="button"
                            onClick={() => { void handleToggleActive(u); setSelectedUser({ ...u, is_active: !u.is_active }); }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                              u.is_active
                                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-red-500/10 hover:border-red-500/25 hover:text-red-400'
                                : 'border-red-500/25 bg-red-500/10 text-red-400 hover:bg-emerald-500/10 hover:border-emerald-500/25 hover:text-emerald-400'
                            }`}
                          >
                            {u.is_active ? 'Активен → Отключить' : 'Отключён → Включить'}
                          </button>
                        </div>

                        {/* Role */}
                        {!isSuper && (
                          <div className="flex items-center justify-between py-2 border-b border-default">
                            <span className="text-sm text-secondary">Роль</span>
                            <div className="w-[180px]">
                              <DarkSelect
                                value={String(u.role || 'operator')}
                                onChange={(v) => { void handleChangeUserRole(u, String(v)); setSelectedUser({ ...u, role: String(v) as any }); }}
                                groups={assignableRoleGroups}
                                buttonClassName={`w-full h-9 px-3 border rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/40 text-sm ${roleBadgeClass(roleKey)}`}
                              />
                            </div>
                          </div>
                        )}

                        {/* Telegram */}
                        <div className="flex items-start justify-between py-2 border-b border-default gap-3">
                          <span className="text-sm text-secondary shrink-0 pt-1">Telegram</span>
                          <div className="flex flex-col items-end gap-2">
                            {tgManualInputUserId === u.id ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  autoFocus
                                  value={tgManualInputValue}
                                  onChange={(e) => setTgManualInputValue(e.target.value.replace(/\D/g, ''))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void handleSaveManualTgId(u)
                                    if (e.key === 'Escape') { setTgManualInputUserId(null); setTgManualInputValue('') }
                                  }}
                                  className="w-36 h-9 px-2 text-sm font-mono bg-overlay-md border border-default rounded-lg focus:outline-none focus:border-[#2AABEE] text-primary"
                                  placeholder="Telegram ID"
                                />
                                <button type="button" onClick={() => void handleSaveManualTgId(u)} className="h-9 px-3 rounded-lg text-sm border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300">ок</button>
                                <button type="button" onClick={() => { setTgManualInputUserId(null); setTgManualInputValue('') }} className="h-9 px-3 rounded-lg text-sm border border-default bg-overlay-sm hover:bg-overlay-md text-secondary">✕</button>
                              </div>
                            ) : u.tg_id ? (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 text-sm text-[#2AABEE] font-mono">
                                  <svg style={{width:13,height:13,flexShrink:0}} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.32 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.828.942z"/></svg>
                                  {String(u.tg_id)}
                                </span>
                                <button type="button" onClick={() => { void handleUnlinkTelegram(u); setSelectedUser({ ...u, tg_id: null }); }} className="h-8 px-2.5 rounded-lg text-xs border border-red-500/25 bg-red-500/10 hover:bg-red-500/20 text-red-400">Отвязать</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => handleLinkTelegram(u)} className="h-8 px-3 rounded-lg text-xs border border-default bg-overlay-sm hover:bg-[#2AABEE]/10 hover:border-[#2AABEE]/25 hover:text-[#2AABEE] text-secondary transition-colors">
                                Привязать Telegram
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 2FA */}
                        <div className="flex items-center justify-between py-2 border-b border-default">
                          <span className="text-sm text-secondary">2FA</span>
                          {u.totp_enabled ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-emerald-400">Включена</span>
                              <button type="button" onClick={() => { void handleDisable2FA(u); setSelectedUser({ ...u, totp_enabled: false }); }} className="h-8 px-2.5 rounded-lg text-xs border border-red-500/25 bg-red-500/10 hover:bg-red-500/20 text-red-400">Отключить</button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">Не настроена</span>
                          )}
                        </div>

                        {/* Own 2FA setup */}
                        {isSelf && (
                          <div className="pt-1">
                            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Настройка 2FA</p>
                            <TwoFactorSetup />
                          </div>
                        )}

                        {/* Password reset */}
                        <div className="flex items-center justify-between py-2 border-b border-default">
                          <span className="text-sm text-secondary">Пароль</span>
                          <button type="button" onClick={() => void handleResetPassword(u)} className="h-8 px-3 rounded-lg text-xs border border-default bg-overlay-sm hover:bg-overlay-md text-secondary transition-colors">
                            Сменить пароль
                          </button>
                        </div>

                        {/* Logs */}
                        <div className="flex items-center justify-between py-2 border-b border-default">
                          <span className="text-sm text-secondary">Логи</span>
                          <button type="button" onClick={() => { setSelectedUser(null); setTab('logs'); applyAuditFilters({ actor: String(u.username || '') }); }} className="h-8 px-3 rounded-lg text-xs border border-default bg-overlay-sm hover:bg-overlay-md text-secondary transition-colors">
                            Посмотреть логи
                          </button>
                        </div>

                        {/* Delete */}
                        {!isSelf && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => { setSelectedUser(null); setDeleteConfirm({ id: u.id, username: u.username }); }}
                              className="w-full h-10 rounded-xl text-sm border border-red-500/25 bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors font-semibold"
                            >
                              Удалить пользователя
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </>
          ) : tab === 'roles' ? (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-4">
                <div className="space-y-3">
                  {(roles || [])
                    .slice()
                    .sort((a, b) => {
                      const aa = String(a.name || '')
                      const bb = String(b.name || '')
                      if (aa === 'super_admin') return -1
                      if (bb === 'super_admin') return 1
                      return aa.localeCompare(bb)
                    })
                    .map((r) => {
                      const name = String(r.name || '')
                      const key = name.toLowerCase()
                      const selected = String(selectedRole?.name || '').toLowerCase() === key
                      const count = usersCountByRole.get(key) || { total: 0, active: 0 }
                      const accent =
                        key === 'super_admin'
                          ? 'border-red-500/30'
                          : key === 'manager'
                            ? 'border-sky-500/30'
                            : key === 'operator'
                              ? 'border-yellow-500/30'
                              : 'border-default'
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setSelectedRoleName(name)}
                          className={`w-full text-left rounded-xl border bg-overlay-xs p-4 transition-colors ${
                            selected ? `${accent} bg-overlay-sm` : `border-default hover:bg-overlay-sm`
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`px-2 py-0.5 rounded-md text-[11px] border ${roleBadgeClass(key)}`}>
                                  {String(r.name || '').toUpperCase()}
                                </span>
                                <div className="text-primary font-bold text-xl truncate">{String(r.title || r.name)}</div>
                              </div>
                              <div className="text-sm text-muted mt-1 line-clamp-2">{String(r.description || '')}</div>
                            </div>
                            {r.is_system ? (
                              <span className="px-2 py-0.5 rounded-md text-[11px] border border-default bg-overlay-sm text-secondary">
                                Системная
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 flex items-center gap-2 text-sm">
                            <span className="px-2 py-0.5 rounded-md border border-default bg-overlay-sm text-secondary">
                              админов: <span className="font-semibold">{count.total}</span>
                            </span>
                            <span className="px-2 py-0.5 rounded-md border border-default bg-overlay-sm text-secondary">
                              active: <span className="font-semibold">{count.active}</span>
                            </span>
                          </div>
                        </button>
                      )
                    })}
                </div>
              </div>

              <div className="xl:col-span-8">
                <div className="rounded-xl border border-default bg-overlay-xs p-4">
                  {!selectedRole ? (
                    <div className="text-sm text-dim">Выберите роль слева.</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-primary font-bold text-2xl truncate">{String(selectedRole.title || selectedRole.name)}</div>
                          <div className="text-sm text-muted mt-1">
                            {selectedRoleIsSuperAdmin
                              ? 'Super Admin: полный доступ (права фиксированы)'
                              : 'Настрой права для этой роли (ресурс × действие)'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setRoleDraftTitle(String(selectedRole.title || selectedRole.name || ''))
                              setRoleDraftDescription(String(selectedRole.description || ''))
                              setRoleDraftPerms(new Set((selectedRole.permissions || []).map(String)))
                            }}
                            disabled={!roleDirty || savingRole}
                            className="h-11 px-4 rounded-lg text-[15px] font-semibold border border-default bg-[var(--bg-surface-hover)] hover:bg-overlay-md text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Сбросить
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveRole()}
                            disabled={selectedRoleIsSuperAdmin || !roleDirty || savingRole}
                            className={`h-11 px-5 rounded-lg text-[15px] font-semibold border ${
                              selectedRoleIsSuperAdmin
                                ? 'border-default bg-[var(--bg-surface-hover)] text-muted cursor-not-allowed'
                                : 'border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            {savingRole ? 'Сохранение...' : 'Сохранить'}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-muted mb-2">Название</label>
                          <input
                            value={roleDraftTitle}
                            onChange={(e) => setRoleDraftTitle(e.target.value)}
                            disabled={selectedRoleIsSuperAdmin}
                            className="w-full px-3 py-2.5 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary text-[15px] disabled:opacity-70 disabled:cursor-not-allowed"
                            placeholder="Manager"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-muted mb-2">Описание</label>
                          <input
                            value={roleDraftDescription}
                            onChange={(e) => setRoleDraftDescription(e.target.value)}
                            disabled={selectedRoleIsSuperAdmin}
                            className="w-full px-3 py-2.5 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary text-[15px] disabled:opacity-70 disabled:cursor-not-allowed"
                            placeholder="Что умеет эта роль"
                          />
                        </div>
                      </div>

                      {!selectedRoleIsSuperAdmin ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="h-10 px-4 rounded-lg text-[14px] font-semibold border border-default bg-[var(--bg-surface-hover)] hover:bg-overlay-md text-primary"
                            onClick={() => {
                              const next = new Set<string>()
                              for (const r of rbacResources) next.add(`${String(r.key)}:view`)
                              setRoleDraftPerms(next)
                            }}
                          >
                            Пресет: View only
                          </button>
                          <button
                            type="button"
                            className="h-10 px-4 rounded-lg text-[14px] font-semibold border border-default bg-[var(--bg-surface-hover)] hover:bg-overlay-md text-primary"
                            onClick={() => {
                              const next = new Set<string>()
                              for (const r of rbacResources) {
                                next.add(`${String(r.key)}:view`)
                                next.add(`${String(r.key)}:create`)
                                next.add(`${String(r.key)}:edit`)
                              }
                              setRoleDraftPerms(next)
                            }}
                          >
                            Пресет: Editor
                          </button>
                          <button
                            type="button"
                            className="h-10 px-4 rounded-lg text-[14px] font-semibold border border-default bg-[var(--bg-surface-hover)] hover:bg-overlay-md text-primary"
                            onClick={() => {
                              const next = new Set<string>()
                              for (const r of rbacResources) {
                                for (const a of RBAC_ACTIONS_4) next.add(`${String(r.key)}:${a}`)
                              }
                              setRoleDraftPerms(next)
                            }}
                          >
                            Пресет: Full access
                          </button>
                        </div>
                      ) : null}

                      <div className="rounded-xl border border-default overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="min-w-[920px] w-full text-[15px]">
                            <thead className="bg-overlay-xs border-b border-default">
                              <tr>
                                <th className="text-left px-3 py-3 text-primary font-bold">Ресурс</th>
                                {RBAC_ACTIONS_4.map((a) => (
                                  <th key={a} className="text-center px-3 py-3 text-primary font-bold">
                                    {RBAC_ACTION_LABEL[a]}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                              {rbacResources.map((res) => {
                                const rk = String(res.key)
                                return (
                                  <tr key={rk} className="hover:bg-overlay-xs">
                                    <td className="px-3 py-2.5 text-secondary font-semibold">{String(res.title || rk)}</td>
                                    {RBAC_ACTIONS_4.map((a) => {
                                      const key = `${rk}:${a}`
                                      const checked = roleDraftPerms.has(key)
                                      const disabled = selectedRoleIsSuperAdmin || savingRole
                                      return (
                                        <td key={key} className="px-3 py-2.5 text-center">
                                          <button
                                            type="button"
                                            onClick={() => togglePerm(rk, a)}
                                            disabled={disabled}
                                            className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border disabled:opacity-60 disabled:cursor-not-allowed ${
                                              checked
                                                ? 'bg-accent-15 border-accent-25'
                                                : 'bg-overlay-xs border-default hover:bg-overlay-md'
                                            }`}
                                            aria-label={key}
                                          >
                                            <div
                                              className={`w-5 h-5 rounded border ${
                                                checked ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-transparent border-default'
                                              }`}
                                            />
                                          </button>
                                        </td>
                                      )
                                    })}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 justify-end">
                        <button
                          type="button"
                          className="h-10 px-4 rounded-lg text-[14px] font-semibold border border-default bg-[var(--bg-surface-hover)] hover:bg-overlay-md text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => setRoleDraftPerms(new Set())}
                          disabled={selectedRoleIsSuperAdmin || savingRole}
                        >
                          Снять всё
                        </button>
                        <button
                          type="button"
                          className="h-10 px-4 rounded-lg text-[14px] font-semibold border border-default bg-[var(--bg-surface-hover)] hover:bg-overlay-md text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => {
                            const all = new Set<string>()
                            for (const r of rbacResources) for (const a of RBAC_ACTIONS_4) all.add(`${String(r.key)}:${a}`)
                            setRoleDraftPerms(all)
                          }}
                          disabled={selectedRoleIsSuperAdmin || savingRole}
                        >
                          Выдать всё
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-default bg-overlay-xs p-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <div className="md:col-span-4">
                    <label className="block text-xs font-semibold text-muted mb-1.5">Actor</label>
                    <input
                      value={auditActorInput}
                      onChange={(e) => setAuditActorInput(e.target.value)}
                      className="w-full px-3 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary text-sm"
                      placeholder="username"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-semibold text-muted mb-1.5">Action</label>
                    <input
                      value={auditActionInput}
                      onChange={(e) => setAuditActionInput(e.target.value)}
                      className="w-full px-3 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-primary text-sm"
                      placeholder="panel_user.update"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-muted mb-1.5">Limit</label>
                    <DarkSelect
                      value={String(auditLimit)}
                      onChange={(v) => {
                        setAuditOffset(0)
                        setAuditLimit(Number(v) || 50)
                      }}
                      groups={[
                        { options: [{ value: '25', label: '25' }, { value: '50', label: '50' }, { value: '100', label: '100' }] },
                      ]}
                      buttonClassName="filter-field"
                    />
                  </div>
                  <div className="md:col-span-2 flex items-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        applyAuditFilters({ actor: auditActorInput, action: auditActionInput })
                      }}
                      className="h-10 w-full rounded-lg text-sm font-semibold border border-default bg-overlay-sm hover:bg-overlay-md text-secondary"
                    >
                      Применить
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted">
                  Показано: <span className="text-secondary font-semibold">{auditItems.length}</span> из{' '}
                  <span className="text-secondary font-semibold">{auditTotal}</span>
                </div>
              </div>

              <div className="rounded-xl border border-default bg-overlay-xs overflow-hidden">
                <div className="px-3 py-2 border-b border-default text-xs text-muted flex items-center justify-between gap-2">
                  <div>Логи действий</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadAudit()}
                      className="h-9 px-3 rounded-lg text-xs font-semibold border border-default bg-overlay-sm hover:bg-overlay-md text-secondary"
                    >
                      Обновить
                    </button>
                  </div>
                </div>
                {auditLoading ? (
                  <div className="p-4 text-sm text-dim">Загрузка...</div>
                ) : auditItems.length === 0 ? (
                  <div className="p-4 text-sm text-muted">Лог пуст</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[980px] w-full text-sm">
                      <thead className="bg-overlay-xs border-b border-default">
                        <tr>
                          <th className="text-left px-3 py-2 text-secondary font-semibold">Время</th>
                          <th className="text-left px-3 py-2 text-secondary font-semibold">Actor</th>
                          <th className="text-left px-3 py-2 text-secondary font-semibold">Action</th>
                          <th className="text-left px-3 py-2 text-secondary font-semibold">Target</th>
                          <th className="text-left px-3 py-2 text-secondary font-semibold">Meta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {auditItems.map((it) => {
                          const tsMs = Number(it.ts || 0) * 1000
                          const dt = tsMs ? new Date(tsMs).toLocaleString() : '—'
                          const target = it.target_type ? `${it.target_type}${it.target_id ? `:${it.target_id}` : ''}` : '—'
                          const actionName = String(it.action || '—')
                          const actionLabel = auditActionLabel(actionName)
                          return (
                            <tr key={it.id} className="hover:bg-overlay-xs">
                              <td className="px-3 py-2 text-dim whitespace-nowrap">{dt}</td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <button
                                  type="button"
                                  className="text-secondary font-semibold hover:underline underline-offset-2"
                                  onClick={() => applyAuditFilters({ actor: String(it.actor || ''), action: auditAction })}
                                  title="Фильтр по actor"
                                >
                                  {String(it.actor || '—')}
                                </button>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => applyAuditFilters({ actor: auditActor, action: actionName })}
                                  className={`inline-flex items-center gap-2 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${auditActionBadgeClass(
                                    actionName,
                                  )} hover:bg-overlay-md transition-colors`}
                                  title="Фильтр по action"
                                >
                                  <span>{actionLabel}</span>
                                  <span className="font-mono opacity-70">{actionName}</span>
                                </button>
                              </td>
                              <td className="px-3 py-2 text-dim font-mono">{target}</td>
                              <td className="px-3 py-2">{renderAuditMeta(it)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="px-3 py-3 border-t border-default flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={auditOffset <= 0}
                    onClick={() => setAuditOffset((v) => Math.max(0, v - auditLimit))}
                    className="h-9 px-3 rounded-lg text-sm border border-default bg-overlay-sm hover:bg-overlay-md text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Назад
                  </button>
                  <div className="text-xs text-muted">
                    offset: <span className="text-secondary font-mono">{auditOffset}</span>
                  </div>
                  <button
                    type="button"
                    disabled={auditOffset + auditLimit >= auditTotal}
                    onClick={() => setAuditOffset((v) => v + auditLimit)}
                    className="h-9 px-3 rounded-lg text-sm border border-default bg-overlay-sm hover:bg-overlay-md text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Вперёд
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
        </>
      )}

      <ModalShell
        isOpen={showCreateModal}
        title="Создать пользователя"
        subtitle="Пользователь панели с ролью и tg_id (опционально)."
        onClose={() => setShowCreateModal(false)}
        closeOnBackdropClick={false}
        closeOnEsc={false}
        closeButtonTone="danger"
        shellTone="neutral"
        size="md"
        footer={
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button type="button" onClick={() => setShowCreateModal(false)} className={modalSecondaryButtonClass}>
              Отмена
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await handleCreate()
                if (ok) setShowCreateModal(false)
              }}
              className={modalPrimaryButtonClass}
            >
              Создать
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Username</label>
            <input
              value={createData.username}
              onChange={(e) => setCreateData({ ...createData, username: e.target.value })}
              className="filter-field"
              placeholder="admin"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Пароль</label>
            <input
              type="password"
              value={createData.password}
              onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
              className="filter-field"
              placeholder="******"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Роль</label>
            <DarkSelect
              value={String(createData.role || 'operator')}
              onChange={(v) => setCreateData({ ...createData, role: v as PanelUserRole })}
              groups={roleGroups}
              buttonClassName="filter-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-2">tg_id (опц.)</label>
            <input
              value={createData.tg_id}
              onChange={(e) => setCreateData({ ...createData, tg_id: e.target.value })}
              className="filter-field font-mono text-sm"
              placeholder="7349151942"
              autoComplete="off"
            />
          </div>
        </div>
      </ModalShell>

      {deleteConfirm && (
        <ConfirmModal
          isOpen={!!deleteConfirm}
          title="Удалить пользователя?"
          message={`Вы уверены, что хотите удалить пользователя "${deleteConfirm.username}"?`}
          onConfirm={async () => {
            try {
              await deletePanelUser(deleteConfirm.id)
              notify('success', 'Пользователь удален')
              setDeleteConfirm(null)
              await load()
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Ошибка удаления пользователя'
              notify('error', msg)
            }
          }}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Удалить"
          cancelText="Отмена"
        />
      )}
    </div>
  )
}
