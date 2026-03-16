import { useEffect, useMemo, useState } from 'react'
import { useToastContext } from '../../contexts/ToastContext'
import ConfirmModal from '../common/ConfirmModal'
import DarkSelect, { type DarkSelectGroup } from '../common/DarkSelect'
import { createLkProfile, deleteLkProfile, getAuthHeaders, getLkProfiles, updateLkProfile, type LkProfile } from '../../api/client'

type BotProfile = {
  id: string
  name: string
}

const EMPTY = { name: '', brandTitle: 'No-touch', domain: '', botProfileId: '', supportUrl: '', newsUrl: '', termsUrl: '' }
const EMPTY_SMTP = { host: '', port: '587', user: '', pass: '', from: '' }

export default function LkProfilesPanel({ botProfiles }: { botProfiles: BotProfile[] }) {
  const toast = useToastContext()
  const notify = (type: 'success' | 'error' | 'warning', message: string) => {
    if (type === 'success') toast.showSuccess('Готово', message, 3000)
    else if (type === 'warning') toast.showWarning('Внимание', message, 4500)
    else toast.showError('Ошибка', message, 4500)
  }

  const [profiles, setProfiles] = useState<LkProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null) // profile.id or 'create'
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [form, setForm] = useState(EMPTY)
  const [smtp, setSmtp] = useState(EMPTY_SMTP)
  const [smtpPassSet, setSmtpPassSet] = useState(false)

  const botGroups = useMemo<DarkSelectGroup[]>(() => {
    const opts = botProfiles.map((p) => ({ value: p.id, label: p.name }))
    return [{ label: 'Профиль бота', options: opts }]
  }, [botProfiles])

  const defaultBotProfileId = useMemo(() => String(botProfiles?.[0]?.id || ''), [botProfiles])

  const load = async () => {
    try {
      setLoading(true)
      const res = await getLkProfiles()
      setProfiles(Array.isArray(res?.profiles) ? res.profiles : [])
    } catch (e: any) {
      notify('error', e?.message || 'Не удалось загрузить профили ЛК')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const loadSmtp = async () => {
    try {
      const res = await fetch('/webpanel/api/lk-smtp', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.ok) {
        setSmtp({ host: String(data.host || ''), port: String(data.port || 587), user: String(data.user || ''), pass: '', from: String(data.from || '') })
        setSmtpPassSet(Boolean(data.pass_set))
      }
    } catch { /* ignore */ }
  }

  const openEdit = (p: LkProfile) => {
    const legacyDomains = (p.settings as any)?.domains
    setForm({
      name: String(p.name || ''),
      brandTitle: String(p.settings?.brand_title || 'No-touch'),
      domain: String((p.settings as any)?.domain || (Array.isArray(legacyDomains) ? legacyDomains[0] : '') || ''),
      botProfileId: String((p.botProfileIds || [])[0] || ''),
      supportUrl: String((p.settings as any)?.support_url || ''),
      newsUrl: String((p.settings as any)?.news_url || ''),
      termsUrl: String((p.settings as any)?.terms_url || ''),
    })
    void loadSmtp()
    setFlippedCardId(p.id)
  }

  const openCreate = () => {
    setForm({ ...EMPTY, botProfileId: defaultBotProfileId, supportUrl: '' })
    void loadSmtp()
    setFlippedCardId('create')
  }

  const close = () => { setFlippedCardId(null); setSaving(false) }

  const save = async (targetId: string | null) => {
    if (saving) return
    const n = form.name.trim()
    if (!n) { notify('error', 'Заполните название'); return }
    const botId = form.botProfileId.trim()
    if (!botId) { notify('error', 'Выберите профиль бота'); return }
    const d = form.domain.trim()
    if (!d) { notify('error', 'Заполните домен'); return }
    setSaving(true)
    try {
      const payload = {
        name: n,
        botProfileIds: [botId],
        settings: { brand_title: form.brandTitle.trim() || 'No-touch', domain: d, support_url: form.supportUrl.trim(), news_url: form.newsUrl.trim(), terms_url: form.termsUrl.trim() },
      }
      if (targetId) {
        await updateLkProfile(targetId, payload as any)
      } else {
        await createLkProfile(payload as any)
      }
      // Save SMTP config if host is provided
      try {
        const headers = await getAuthHeaders()
        const smtpBody: Record<string, unknown> = { host: smtp.host.trim(), port: parseInt(smtp.port) || 587, user: smtp.user.trim(), from: smtp.from.trim() }
        if (smtp.pass.trim()) smtpBody['pass'] = smtp.pass.trim()
        await fetch('/webpanel/api/lk-smtp', { method: 'PATCH', credentials: 'include', headers, body: JSON.stringify(smtpBody) })
      } catch { /* ignore smtp errors */ }
      await load()
      close()
      notify('success', 'Профиль сохранён')
      if (botId) {
        try {
          const headers = await getAuthHeaders()
          const res = await fetch(`/webpanel/api/bot-profiles/${encodeURIComponent(botId)}/lk-settings`, {
            method: 'PATCH', credentials: 'include', headers,
            body: JSON.stringify({ brand_title: payload.settings.brand_title, support_url: form.supportUrl.trim() }),
          })
          const json = await res.json().catch(() => ({} as any))
          if (!res.ok || !(json as any)?.ok) notify('warning', 'Профиль сохранён, но настройки не применены в API‑модуле выбранного бота')
        } catch { notify('warning', 'Профиль сохранён, но настройки не применены в API‑модуле выбранного бота') }
      }
    } catch (e: any) {
      notify('error', e?.message || 'Ошибка сохранения')
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await deleteLkProfile(id)
      await load()
      notify('success', 'Профиль ЛК удалён')
    } catch (e: any) { notify('error', e?.message || 'Ошибка удаления') }
    finally { setConfirmDeleteId(null) }
  }

  const getBoundBotName = (p: LkProfile) => {
    const bid = String((p.botProfileIds || [])[0] || '')
    if (!bid) return '—'
    return botProfiles.find((x) => x.id === bid)?.name || '—'
  }

  const BackFace = ({ targetId, profileName }: { targetId: string | null; profileName?: string }) => (
    <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
      <div className="bg-gradient-to-br from-sky-500/8 to-sky-600/3 border-sky-500/25 rounded-xl p-4 border flex flex-col gap-2 h-full">
        <div className="text-sm font-semibold text-primary flex-shrink-0">
          {targetId ? `Редактировать: ${profileName}` : 'Новый профиль ЛК'}
        </div>
        <div className="flex-1 space-y-2 min-h-0 overflow-hidden">
          <div>
            <label className="block text-xs text-muted mb-1">Название</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="LK #1" autoComplete="off"
              className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Привязка к боту</label>
            <DarkSelect value={form.botProfileId} onChange={(v) => setForm({ ...form, botProfileId: String(v || '') })}
              groups={botGroups}
              buttonClassName="w-full px-3 py-1.5 text-sm rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-30" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Домен</label>
            <input type="text" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}
              placeholder="lk.example.com" autoComplete="off"
              className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Заголовок / бренд</label>
            <input type="text" value={form.brandTitle} onChange={(e) => setForm({ ...form, brandTitle: e.target.value })}
              placeholder="No-touch" autoComplete="off"
              className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Ссылка на поддержку</label>
            <input type="text" value={form.supportUrl} onChange={(e) => setForm({ ...form, supportUrl: e.target.value })}
              placeholder="https://t.me/support" autoComplete="off"
              className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Ссылка на новости</label>
            <input type="text" value={form.newsUrl} onChange={(e) => setForm({ ...form, newsUrl: e.target.value })}
              placeholder="https://t.me/news" autoComplete="off"
              className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Ссылка на правила</label>
            <input type="text" value={form.termsUrl} onChange={(e) => setForm({ ...form, termsUrl: e.target.value })}
              placeholder="https://example.com/terms" autoComplete="off"
              className="w-full px-3 py-1.5 text-sm bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
          </div>
          <div className="pt-1 border-t border-default">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5">SMTP</div>
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-xs text-muted mb-0.5">Host</label>
                  <input type="text" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
                    placeholder="smtp.yandex.ru" autoComplete="off"
                    className="w-full px-2 py-1 text-xs bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-0.5">Port</label>
                  <input type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })}
                    placeholder="587"
                    className="w-full px-2 py-1 text-xs bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-xs text-muted mb-0.5">User</label>
                  <input type="text" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
                    placeholder="noreply@example.com" autoComplete="off"
                    className="w-full px-2 py-1 text-xs bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-0.5">
                    Пароль{smtpPassSet ? <span className="ml-1 text-emerald-400">(задан)</span> : null}
                  </label>
                  <input type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })}
                    placeholder={smtpPassSet ? '••••••' : 'password'}
                    className="w-full px-2 py-1 text-xs bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-0.5">От кого</label>
                <input type="text" value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })}
                  placeholder='VPN <noreply@example.com>' autoComplete="off"
                  className="w-full px-2 py-1 text-xs bg-overlay-sm border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-30 text-primary placeholder:text-faint" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0 pt-1">
          <button onClick={() => save(targetId)} disabled={saving} type="button"
            className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/20 disabled:opacity-50 transition-colors">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button onClick={close} type="button"
            className="flex-1 py-1.5 text-xs rounded-lg bg-overlay-sm hover:bg-overlay-md text-secondary border border-default transition-colors">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div id="settings-section-lk-profiles" className="glass-panel p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-primary">Профили ЛК</h2>
          <p className="text-xs text-muted mt-0.5">Каждый профиль привязан к одному боту и домену.</p>
        </div>
      </div>

      {loading && <div className="text-sm text-dim py-2">Загрузка…</div>}

      {!loading && (
        <div className="flex flex-wrap gap-3">
          {profiles.map((p) => {
            const isFlipped = flippedCardId === p.id
            return (
              <div key={p.id} className="w-full sm:w-[380px] [perspective:1000px]">
                <div className={`relative h-[520px] transition-transform duration-500 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                  {/* Front */}
                  <div className="absolute inset-0 [backface-visibility:hidden]">
                    <div className="bg-gradient-to-br from-sky-500/10 to-sky-600/5 border-sky-500/35 hover:border-sky-400/60 hover:shadow-sky-500/10 rounded-xl p-4 border flex flex-col h-full transition-colors duration-200 hover:shadow-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full bg-sky-400/50" />
                        <h3 className="text-lg font-semibold text-primary truncate flex-1">{p.name}</h3>
                      </div>
                      <div className="flex-1 space-y-2 text-sm">
                        <p><span className="text-muted">Домен:</span> <span className="text-secondary">{String((p.settings as any)?.domain || '—')}</span></p>
                        <p><span className="text-muted">Бот:</span> <span className="text-secondary">{getBoundBotName(p)}</span></p>
                        <p><span className="text-muted">Бренд:</span> <span className="text-secondary">{String(p.settings?.brand_title || '—')}</span></p>
                        {(p.settings as any)?.support_url && (
                          <p><span className="text-muted">Поддержка:</span> <span className="text-secondary truncate block">{String((p.settings as any).support_url)}</span></p>
                        )}
                        {(p.settings as any)?.news_url && (
                          <p><span className="text-muted">Новости:</span> <span className="text-secondary truncate block">{String((p.settings as any).news_url)}</span></p>
                        )}
                        {(p.settings as any)?.terms_url && (
                          <p><span className="text-muted">Правила:</span> <span className="text-secondary truncate block">{String((p.settings as any).terms_url)}</span></p>
                        )}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => openEdit(p)} type="button"
                          className="flex-1 py-1.5 text-xs rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/25 transition-colors">
                          Редактировать
                        </button>
                        <button onClick={() => setConfirmDeleteId(p.id)} type="button"
                          className="py-1.5 px-3 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Back */}
                  <BackFace targetId={p.id} profileName={p.name} />
                </div>
              </div>
            )
          })}

          {/* Create card */}
          <div className="w-full sm:w-[380px] [perspective:1000px]">
            <div className={`relative h-[520px] transition-transform duration-500 [transform-style:preserve-3d] ${flippedCardId === 'create' ? '[transform:rotateY(180deg)]' : ''}`}>
              {/* Front */}
              <div className="absolute inset-0 [backface-visibility:hidden]">
                <div onClick={openCreate}
                  className="w-full h-full rounded-xl border-2 border-dashed border-default hover:border-sky-500/30 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors group">
                  <div className="w-10 h-10 rounded-full bg-overlay-xs group-hover:bg-sky-500/10 flex items-center justify-center transition-colors">
                    <svg className="w-5 h-5 text-muted group-hover:text-sky-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  </div>
                  <span className="text-sm font-medium text-muted group-hover:text-sky-400 transition-colors">Добавить профиль ЛК</span>
                </div>
              </div>
              {/* Back */}
              <BackFace targetId={null} />
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmModal
          isOpen={!!confirmDeleteId}
          title="Подтвердите удаление"
          message={`Удалить профиль ЛК "${profiles.find((p) => p.id === confirmDeleteId)?.name || confirmDeleteId}"?`}
          onConfirm={() => remove(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
          confirmText="Удалить"
          cancelText="Отмена"
        />
      )}
    </div>
  )
}
