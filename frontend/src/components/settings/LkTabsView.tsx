import { useEffect, useMemo, useRef, useState } from 'react'
import { useToastContext } from '../../contexts/ToastContext'
import ConfirmModal from '../common/ConfirmModal'
import DarkSelect, { type DarkSelectGroup } from '../common/DarkSelect'
import { createLkProfile, deleteLkProfile, getAuthHeaders, getLkProfiles, updateLkProfile, type LkProfile } from '../../api/client'

type BotProfile = { id: string; name: string; adminId?: string }

const EMPTY_FORM = { name: '', brandTitle: 'No-touch', domain: '', botProfileId: '' }
const EMPTY_SMTP = { host: '', port: '587', user: '', pass: '', from: '' }

type LkSettings = { brand_title?: string; support_url?: string; enabled_tariff_group_codes?: string[]; enabled_payment_providers?: string[]; invite_tab_mode?: string }
type Provider = { key: string; title: string }
type TariffItem = { group_code: string; name: string }

function ProfileForm({ profile, botProfiles, allProfiles, onSaved, onDeleted }: {
  profile: LkProfile | null
  botProfiles: BotProfile[]
  allProfiles: LkProfile[]
  onSaved: () => void
  onDeleted?: () => void
}) {
  const { showSuccess, showError, showWarning } = useToastContext()
  const notify = (type: 'success' | 'error' | 'warning', msg: string) => {
    if (type === 'success') showSuccess('Готово', msg, 3000)
    else if (type === 'warning') showWarning('Внимание', msg, 4500)
    else showError('Ошибка', msg, 4500)
  }

  // Filter out bots already bound to OTHER profiles
  const availableBots = useMemo(() => {
    const usedByOther = new Set(
      allProfiles
        .filter(p => p.id !== profile?.id)
        .map(p => String((p.botProfileIds || [])[0] || ''))
        .filter(Boolean)
    )
    return botProfiles.filter(b => !usedByOther.has(b.id))
  }, [botProfiles, allProfiles, profile?.id])

  const botGroups = useMemo<DarkSelectGroup[]>(() => [
    { label: 'Профиль бота', options: availableBots.map(p => ({ value: p.id, label: p.name })) }
  ], [availableBots])

  const [hintPos, setHintPos] = useState<{x: number, y: number, below: boolean} | null>(null)
  const hintRef = useRef<HTMLSpanElement>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [smtp, setSmtp] = useState(EMPTY_SMTP)
  const [smtpPassSet, setSmtpPassSet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [smtpTestEmail, setSmtpTestEmail] = useState('')
  const [smtpTesting, setSmtpTesting] = useState(false)

  const [lkLoading, setLkLoading] = useState(false)
  const [supportUrl, setSupportUrl] = useState('')
  const [enabledGroups, setEnabledGroups] = useState<string[]>([])
  const [enabledProviders, setEnabledProviders] = useState<string[]>([])
  const [inviteTabMode, setInviteTabMode] = useState('auto')
  const [partnerModuleAvailable, setPartnerModuleAvailable] = useState(false)
  const [availableGroups, setAvailableGroups] = useState<string[]>([])
  const [availableProviders, setAvailableProviders] = useState<Provider[]>([])

  useEffect(() => {
    if (profile) {
      const legacyDomains = (profile.settings as any)?.domains
      setForm({
        name: String(profile.name || ''),
        brandTitle: String(profile.settings?.brand_title || 'No-touch'),
        domain: String((profile.settings as any)?.domain || (Array.isArray(legacyDomains) ? legacyDomains[0] : '') || ''),
        botProfileId: String((profile.botProfileIds || [])[0] || ''),
      })
    } else {
      const firstFree = availableBots[0]?.id || ''
      setForm({ ...EMPTY_FORM, botProfileId: firstFree })
    }
    ;(async () => {
      try {
        const res = await fetch('/webpanel/api/lk-smtp', { credentials: 'include', cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data?.ok) {
          setSmtp({ host: String(data.host || ''), port: String(data.port || 587), user: String(data.user || ''), pass: '', from: String(data.from || '') })
          setSmtpPassSet(Boolean(data.pass_set))
        }
      } catch { /* ignore */ }
    })()
  }, [profile?.id])

  const loadLkSettings = async (botId: string) => {
    if (!botId) return
    try {
      setLkLoading(true)
      const [settingsRes, tariffsRes, providersRes, partnerRes] = await Promise.all([
        fetch(`/webpanel/api/bot-profiles/${encodeURIComponent(botId)}/lk-settings`, { credentials: 'include', cache: 'no-store' }),
        fetch(`/webpanel/api/bot-profiles/${encodeURIComponent(botId)}/lk-tariffs`, { credentials: 'include', cache: 'no-store' }),
        fetch(`/webpanel/api/bot-profiles/${encodeURIComponent(botId)}/lk-providers`, { credentials: 'include', cache: 'no-store' }),
        fetch(`/webpanel/api/bot-profiles/${encodeURIComponent(botId)}/lk-partner-module`, { credentials: 'include', cache: 'no-store' }),
      ])
      if (settingsRes.ok) {
        const s = await settingsRes.json()
        const d: LkSettings = s?.data ?? s
        setSupportUrl(String(d.support_url || ''))
        setEnabledGroups(Array.isArray(d.enabled_tariff_group_codes) ? d.enabled_tariff_group_codes : [])
        setEnabledProviders(Array.isArray(d.enabled_payment_providers) ? d.enabled_payment_providers.map((x: string) => x.toUpperCase()) : [])
        setInviteTabMode(String(d.invite_tab_mode || 'auto'))
      }
      if (partnerRes.ok) {
        const pr = await partnerRes.json().catch(() => ({}))
        const prData = pr?.data ?? pr
        if (typeof pr?.partner_module_available === 'boolean') setPartnerModuleAvailable(pr.partner_module_available)
        else if (typeof prData?.partner_module_available === 'boolean') setPartnerModuleAvailable(prData.partner_module_available)
      }
      if (tariffsRes.ok) {
        const td = await tariffsRes.json()
        const seen = new Set<string>(); const groups: string[] = []
        for (const t of (td.items ?? []) as TariffItem[]) { if (t.group_code && !seen.has(t.group_code)) { seen.add(t.group_code); groups.push(t.group_code) } }
        setAvailableGroups(groups)
      }
      if (providersRes.ok) { const pd = await providersRes.json(); setAvailableProviders(Array.isArray(pd.items) ? pd.items : []) }
    } catch { /* ignore */ }
    finally { setLkLoading(false) }
  }

  useEffect(() => {
    const botId = profile ? String((profile.botProfileIds || [])[0] || '') : (availableBots[0]?.id || '')
    void loadLkSettings(botId)
  }, [profile?.id])

  const testSmtp = async () => {
    const email = smtpTestEmail.trim()
    if (!email) { notify('error', 'Введите email для теста'); return }
    setSmtpTesting(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/webpanel/api/lk-smtp/test', {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ email }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) { notify('success', `Письмо отправлено на ${email}`) }
      else { notify('error', (json as any)?.detail || 'Ошибка отправки') }
    } catch { notify('error', 'Ошибка сети') }
    finally { setSmtpTesting(false) }
  }

  // Single save — profile + SMTP + LK settings all at once
  const saveAll = async () => {
    if (saving) return
    const n = form.name.trim(); if (!n) { notify('error', 'Заполните название'); return }
    const botId = form.botProfileId.trim(); if (!botId) { notify('error', 'Выберите профиль бота'); return }
    const d = form.domain.trim(); if (!d) { notify('error', 'Заполните домен'); return }
    setSaving(true)
    try {
      const payload = { name: n, botProfileIds: [botId], settings: { brand_title: form.brandTitle.trim() || 'No-touch', domain: d } }
      if (profile) { await updateLkProfile(profile.id, payload as any) } else { await createLkProfile(payload as any) }

      const headers = await getAuthHeaders()

      // Save SMTP
      try {
        const smtpBody: Record<string, unknown> = { host: smtp.host.trim(), port: parseInt(smtp.port) || 587, user: smtp.user.trim(), from: smtp.from.trim() }
        if (smtp.pass.trim()) smtpBody['pass'] = smtp.pass.trim()
        await fetch('/webpanel/api/lk-smtp', { method: 'PATCH', credentials: 'include', headers, body: JSON.stringify(smtpBody) })
      } catch { /* ignore */ }

      // Save LK settings (support, tariffs, providers, invite mode) + brand_title
      try {
        const res = await fetch(`/webpanel/api/bot-profiles/${encodeURIComponent(botId)}/lk-settings`, {
          method: 'PATCH', credentials: 'include', headers,
          body: JSON.stringify({
            brand_title: payload.settings.brand_title,
            support_url: supportUrl.trim(),
            enabled_tariff_group_codes: enabledGroups,
            enabled_payment_providers: enabledProviders,
            invite_tab_mode: inviteTabMode,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !(json as any)?.ok) notify('warning', 'Профиль сохранён, но настройки не применены в API‑модуле бота')
      } catch { notify('warning', 'Профиль сохранён, но настройки не применены в API‑модуле бота') }

      notify('success', 'Сохранено')
      onSaved()
    } catch (e: any) { notify('error', e?.message || 'Ошибка сохранения') }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!profile) return
    try { await deleteLkProfile(profile.id); notify('success', 'Профиль ЛК удалён'); onDeleted?.() }
    catch (e: any) { notify('error', e?.message || 'Ошибка удаления') }
    finally { setConfirmDelete(false) }
  }

  const [innerTab, setInnerTab] = useState<'main' | 'email' | 'invite'>('main')
  const inputCls = 'w-full px-3 py-2 text-sm bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint'
  const innerTabs = [
    { id: 'main' as const, label: 'Основное' },
    { id: 'email' as const, label: 'Почта' },
    { id: 'invite' as const, label: 'Пригласить' },
  ]

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Inner tabs */}
      <div className="flex gap-1 border-b border-default">
        {innerTabs.map(t => (
          <button key={t.id} type="button" onClick={() => setInnerTab(t.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              innerTab === t.id ? 'text-primary border-[var(--accent)]' : 'text-muted border-transparent hover:text-secondary hover:border-default'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Основное */}
      {innerTab === 'main' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Название</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="LK #1" autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Привязка к боту</label>
              <DarkSelect value={form.botProfileId}
                onChange={v => { const id = String(v || ''); setForm({ ...form, botProfileId: id }); void loadLkSettings(id) }}
                groups={botGroups}
                buttonClassName="w-full px-3 py-2 text-sm rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-30" />
              {availableBots.length === 0 && <p className="text-xs text-amber-400/80 mt-1">Все боты уже привязаны к другим профилям ЛК</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Домен</label>
              <input type="text" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} placeholder="lk.example.com" autoComplete="off" className={inputCls} />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs font-medium text-muted">Заголовок / бренд</label>
                <span ref={hintRef} className="cursor-help inline-block"
                  onMouseEnter={() => { const el = hintRef.current; if (el) { const r = el.getBoundingClientRect(); const below = r.top < window.innerHeight / 2; setHintPos({ x: r.left + r.width / 2, y: below ? r.bottom : r.top, below }) } }}
                  onMouseLeave={() => setHintPos(null)}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/50 hover:text-muted transition-colors"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                </span>
                {hintPos && (
                  <div className="pointer-events-none" style={{ position: 'fixed', left: hintPos.x, top: hintPos.below ? hintPos.y + 8 : hintPos.y - 8, transform: hintPos.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)', zIndex: 200000 }}>
                    <img src="/webpanel/hints/codemail.png" alt="Пример письма" className="w-96 rounded-lg shadow-2xl border border-white/10" />
                    <div className="mt-1.5 px-2 py-1 text-xs text-white/80 text-center bg-[#111] rounded-md border border-white/10">Отображается в шапке письма и заголовке вкладки браузера</div>
                  </div>
                )}
              </div>
              <input type="text" value={form.brandTitle} onChange={e => setForm({ ...form, brandTitle: e.target.value })} placeholder="No-touch" autoComplete="off" className={inputCls} />
            </div>
          </div>

          {lkLoading ? <div className="text-sm text-dim">Загрузка настроек…</div> : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Ссылка на поддержку</label>
                <input value={supportUrl} onChange={e => setSupportUrl(e.target.value)} placeholder="https://t.me/support" className={inputCls} />
              </div>
              {availableGroups.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    Тарифные группы <span className="normal-case font-normal text-faint">(пусто = все)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableGroups.map(code => (
                      <button key={code} type="button" onClick={() => setEnabledGroups(prev => prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code])}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-all ${enabledGroups.includes(code) ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-transparent text-muted border-default hover:border-white/30'}`}>
                        {code}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {availableProviders.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    Платёжные системы <span className="normal-case font-normal text-faint">(пусто = все включённые)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableProviders.map(p => (
                      <button key={p.key} type="button" onClick={() => { const k = p.key.toUpperCase(); setEnabledProviders(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]) }}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-all ${enabledProviders.includes(p.key.toUpperCase()) ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-transparent text-muted border-default hover:border-white/30'}`}>
                        {p.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Почта */}
      {innerTab === 'email' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Host</label>
              <input type="text" value={smtp.host} onChange={e => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.yandex.ru" autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Port</label>
              <input type="number" value={smtp.port} onChange={e => setSmtp({ ...smtp, port: e.target.value })} placeholder="587" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">User (email)</label>
              <input type="text" value={smtp.user} onChange={e => setSmtp({ ...smtp, user: e.target.value })} placeholder="noreply@example.com" autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Пароль{smtpPassSet ? <span className="ml-1 text-emerald-400">(задан)</span> : null}
              </label>
              <input type="password" value={smtp.pass} onChange={e => setSmtp({ ...smtp, pass: e.target.value })} placeholder={smtpPassSet ? '••••••••' : 'app-password'} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-muted mb-1">От кого (необязательно)</label>
              <input type="text" value={smtp.from} onChange={e => setSmtp({ ...smtp, from: e.target.value })} placeholder='Мой VPN <noreply@example.com>' autoComplete="off" className={inputCls} />
            </div>
          </div>

          {/* Test block */}
          <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-4 space-y-2">
            <div className="text-xs font-semibold text-muted uppercase tracking-wide">Тест отправки</div>
            <p className="text-xs text-faint">Отправим тестовое письмо чтобы убедиться что SMTP настроен корректно.</p>
            <div className="flex gap-2 mt-1">
              <input type="email" value={smtpTestEmail} onChange={e => setSmtpTestEmail(e.target.value)} placeholder="your@email.com" autoComplete="off" className={inputCls} />
              <button type="button" onClick={testSmtp} disabled={smtpTesting}
                className="shrink-0 px-4 py-2 rounded-lg text-xs font-medium border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition-colors disabled:opacity-50">
                {smtpTesting ? 'Отправка…' : 'Отправить тест'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Пригласить */}
      {innerTab === 'invite' && (
        <div className="space-y-3">
          <p className="text-xs text-faint">Выберите что показывать пользователям на вкладке «Пригласить» в личном кабинете.</p>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'auto', label: 'Авто' },
              { value: 'partner_program', label: 'Партнёрская программа', disabled: !partnerModuleAvailable },
              { value: 'referral', label: 'Реферальная программа' },
            ].map(opt => (
              <button key={opt.value} type="button" disabled={opt.disabled} onClick={() => !opt.disabled && setInviteTabMode(opt.value)}
                title={opt.disabled ? 'Модуль партнёрской программы не установлен' : undefined}
                className={`px-3 py-1.5 rounded-full text-xs border transition-all ${inviteTabMode === opt.value ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : opt.disabled ? 'opacity-30 cursor-not-allowed bg-transparent text-muted border-default' : 'bg-transparent text-muted border-default hover:border-white/30'}`}>
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-faint">
            Авто — показывает партнёрскую если модуль установлен, иначе реферальную.
            {!partnerModuleAvailable && <span className="text-amber-400/70"> Модуль партнёрской программы не установлен.</span>}
          </p>
        </div>
      )}

      {/* Save / Delete */}
      <div className="flex items-center gap-3 pt-2 border-t border-default">
        <button type="button" onClick={saveAll} disabled={saving}
          className="px-6 py-2 text-sm font-semibold rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20 disabled:opacity-50 transition-colors">
          {saving ? 'Сохранение…' : profile ? 'Сохранить' : 'Создать профиль'}
        </button>
        {profile && (
          <button type="button" onClick={() => setConfirmDelete(true)}
            className="px-4 py-2 text-sm rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 transition-colors">
            Удалить профиль
          </button>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal isOpen title="Подтвердите удаление" message={`Удалить профиль ЛК "${profile?.name}"?`}
          onConfirm={doDelete} onCancel={() => setConfirmDelete(false)} confirmText="Удалить" cancelText="Отмена" />
      )}
    </div>
  )
}

export default function LkTabsView({ botProfiles }: { botProfiles: BotProfile[] }) {
  const { showError } = useToastContext()
  const [profiles, setProfiles] = useState<LkProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('__new__')

  const load = async () => {
    try {
      setLoading(true)
      const res = await getLkProfiles()
      const ps: LkProfile[] = Array.isArray(res?.profiles) ? res.profiles : []
      setProfiles(ps)
      setActiveTab(prev => {
        if (prev !== '__new__' && ps.find(p => p.id === prev)) return prev
        return ps.length > 0 ? ps[0].id : '__new__'
      })
    } catch (e: any) {
      showError('Ошибка', e?.message || 'Не удалось загрузить профили ЛК', 4500)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const handleSaved = async () => {
    const prevTab = activeTab
    await load()
    if (prevTab === '__new__') {
      setActiveTab(prev => prev === '__new__' ? profiles[0]?.id ?? '__new__' : prev)
    }
  }

  const handleDeleted = async () => {
    await load()
    setActiveTab('__new__')
  }

  const currentProfile = profiles.find(p => p.id === activeTab) ?? null

  const tabs = [
    ...profiles.map(p => ({ id: p.id, label: p.name })),
    { id: '__new__', label: '+ Добавить' },
  ]

  return (
    <div className="glass-panel p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center gap-0.5 flex-wrap mb-6 border-b border-default">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px ${
                isActive ? 'text-primary border-[var(--accent)]'
                : tab.id === '__new__' ? 'text-[var(--accent)] border-transparent hover:border-[var(--accent)]/40'
                : 'text-muted border-transparent hover:text-secondary hover:border-default'
              }`}>
              {tab.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="text-sm text-dim py-4">Загрузка…</div>
      ) : (
        <ProfileForm
          key={activeTab}
          profile={activeTab === '__new__' ? null : currentProfile}
          botProfiles={botProfiles}
          allProfiles={profiles}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
