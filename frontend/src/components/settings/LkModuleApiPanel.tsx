import { useEffect, useMemo, useState } from 'react'
import { getAuthHeaders } from '../../api/client'

type BotProfile = { id: string; name: string; botApiUrl?: string }
type BotProfilesResponse = { profiles: BotProfile[]; activeProfileId?: string | null }

type BindingResp = {
  ok: boolean
  bot_profile_id?: string
  effective_base_url?: string
  mode?: string
  detail?: string
}

type ManualResp = {
  ok: boolean
  manual_base_url?: string
  effective_base_url?: string
  mode?: string
  bot_profile_id?: string
  detail?: string
}

type SmtpResp = {
  ok: boolean
  host?: string
  port?: number
  user?: string
  pass_set?: boolean
  from?: string
  detail?: string
}

export default function LkModuleApiPanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [okText, setOkText] = useState('')
  const [profiles, setProfiles] = useState<BotProfile[]>([])
  const [botProfileId, setBotProfileId] = useState<string>('')
  const [effectiveUrl, setEffectiveUrl] = useState<string>('')
  const [mode, setMode] = useState<string>('')

  // Advanced/manual override (optional)
  const [manualBaseUrl, setManualBaseUrl] = useState('')

  // SMTP settings
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpFrom, setSmtpFrom] = useState('')
  const [smtpPassSet, setSmtpPassSet] = useState(false)
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpError, setSmtpError] = useState('')
  const [smtpOk, setSmtpOk] = useState('')

  const profileOptions = useMemo(() => {
    const opts = profiles.map((p) => ({ id: String(p.id), label: String(p.name || p.id) }))
    return [{ id: '', label: 'Не привязывать (ручной URL ниже)' }, ...opts]
  }, [profiles])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError('')
        const [pRes, bRes, mRes, sRes] = await Promise.all([
          fetch('/webpanel/api/bot-profiles/', { credentials: 'include', cache: 'no-store' }),
          fetch('/webpanel/api/lk-binding', { credentials: 'include', cache: 'no-store' }),
          fetch('/webpanel/api/lk-module-api', { credentials: 'include', cache: 'no-store' }),
          fetch('/webpanel/api/lk-smtp', { credentials: 'include', cache: 'no-store' }),
        ])
        const pData = (await pRes.json()) as BotProfilesResponse
        const bData = (await bRes.json()) as BindingResp
        const mData = (await mRes.json()) as ManualResp
        const sData = (await sRes.json()) as SmtpResp
        if (!pRes.ok) throw new Error('Не удалось загрузить профили бота')
        if (!bRes.ok || !bData?.ok) throw new Error(String(bData?.detail || 'Не удалось загрузить привязку ЛК'))
        if (!mRes.ok || !mData?.ok) throw new Error(String(mData?.detail || 'Не удалось загрузить настройки ЛК'))
        if (cancelled) return
        setProfiles(Array.isArray(pData.profiles) ? pData.profiles : [])
        setBotProfileId(String(bData.bot_profile_id || ''))
        setEffectiveUrl(String(bData.effective_base_url || mData.effective_base_url || ''))
        setMode(String(bData.mode || mData.mode || ''))
        setManualBaseUrl(String(mData.manual_base_url || ''))
        if (sRes.ok && sData?.ok) {
          setSmtpHost(String(sData.host || ''))
          setSmtpPort(String(sData.port || 587))
          setSmtpUser(String(sData.user || ''))
          setSmtpFrom(String(sData.from || ''))
          setSmtpPassSet(Boolean(sData.pass_set))
        }
      } catch (e: any) {
        if (cancelled) return
        setError(e?.message || 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const saveBinding = async () => {
    try {
      setSaving(true)
      setError('')
      setOkText('')
      const headers = await getAuthHeaders()
      const res = await fetch('/webpanel/api/lk-binding', {
        method: 'PATCH',
        credentials: 'include',
        headers,
        body: JSON.stringify({ bot_profile_id: String(botProfileId || '').trim() }),
      })
      const data = (await res.json()) as BindingResp
      if (!res.ok || !data?.ok) throw new Error(String(data?.detail || 'Не удалось сохранить'))
      setEffectiveUrl(String(data.effective_base_url || ''))
      setMode(String(data.mode || ''))
      setOkText('Сохранено')
      window.setTimeout(() => setOkText(''), 1500)
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const saveManual = async () => {
    try {
      setSaving(true)
      setError('')
      setOkText('')
      const headers = await getAuthHeaders()
      const res = await fetch('/webpanel/api/lk-module-api', {
        method: 'PATCH',
        credentials: 'include',
        headers,
        body: JSON.stringify({ base_url: String(manualBaseUrl || '').trim() }),
      })
      const data = (await res.json()) as ManualResp
      if (!res.ok || !data?.ok) throw new Error(String(data?.detail || 'Не удалось сохранить'))
      setEffectiveUrl(String(data.effective_base_url || ''))
      setMode(String(data.mode || ''))
      setOkText('Сохранено')
      window.setTimeout(() => setOkText(''), 1500)
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const saveSmtp = async () => {
    try {
      setSmtpSaving(true)
      setSmtpError('')
      setSmtpOk('')
      const headers = await getAuthHeaders()
      const body: Record<string, unknown> = {
        host: smtpHost.trim(),
        port: parseInt(smtpPort) || 587,
        user: smtpUser.trim(),
        from: smtpFrom.trim(),
      }
      if (smtpPass.trim()) body['pass'] = smtpPass.trim()
      const res = await fetch('/webpanel/api/lk-smtp', {
        method: 'PATCH',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as SmtpResp
      if (!res.ok || !data?.ok) throw new Error(String(data?.detail || 'Не удалось сохранить'))
      setSmtpPassSet(Boolean(data.pass_set))
      setSmtpPass('')
      setSmtpOk('Сохранено')
      window.setTimeout(() => setSmtpOk(''), 1500)
    } catch (e: any) {
      setSmtpError(e?.message || 'Ошибка сохранения')
    } finally {
      setSmtpSaving(false)
    }
  }

  return (
    <div className="glass-panel p-4 sm:p-6 mt-4 sm:mt-6" id="settings-section-lk-module-api">
      <div className="mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-white">LK Module API</h2>
        <p className="text-sm text-muted mt-1">
          Привязка ЛК к конкретному bot-профилю (если у тебя несколько ботов на разных серверах).
          Все запросы `lk.nonotouch.com/api/lk/*` будут проксироваться в `botApiUrl` выбранного профиля.
        </p>
      </div>

      {loading ? <div className="text-sm text-dim">Загрузка…</div> : null}
      {error ? <div className="mt-3 text-sm text-red-300">{error}</div> : null}

      {!loading ? (
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-dim mb-2">Привязать ЛК к профилю бота</label>
            <select
              value={botProfileId}
              onChange={(e) => setBotProfileId(e.target.value)}
              className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-white"
            >
              {profileOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs text-muted">
              Текущий режим: <span className="font-mono text-secondary">{mode || '—'}</span>
              {'  '}•{'  '}
              Эффективный URL: <span className="font-mono text-secondary break-all">{effectiveUrl || '—'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={saveBinding}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 font-semibold disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            {okText ? <div className="text-sm text-[var(--accent)]">{okText}</div> : null}
          </div>

          <div className="border-t border-default pt-4">
            <div className="text-sm font-semibold text-primary">Ручной URL (опционально)</div>
            <div className="mt-2 text-xs text-muted">
              Используется только если привязка к профилю выключена. Пример: `http://127.0.0.1:7777/adminpanel/api` или
              `https://bot.nonotouch.com/adminpanel/api`.
            </div>
            <div className="mt-3">
              <input
                value={manualBaseUrl}
                onChange={(e) => setManualBaseUrl(e.target.value)}
                className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-white"
                placeholder="http://127.0.0.1:7777/adminpanel/api"
              />
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={saveManual}
                disabled={saving}
                className="px-5 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 font-semibold disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Сохранение…' : 'Сохранить ручной URL'}
              </button>
            </div>
          </div>

          {/* SMTP settings */}
          <div className="border-t border-default pt-4">
            <div className="text-sm font-semibold text-primary">SMTP для отправки кодов входа</div>
            <div className="mt-2 text-xs text-muted">
              Используется для отправки OTP-кодов на email при входе в ЛК. Если не настроено — код появляется только в логах бота.
            </div>
            {smtpError ? <div className="mt-3 text-sm text-red-300">{smtpError}</div> : null}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">SMTP Host</label>
                <input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-white text-sm"
                  placeholder="smtp.yandex.ru"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">SMTP Port</label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-white text-sm"
                  placeholder="587"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">SMTP User (email)</label>
                <input
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-white text-sm"
                  placeholder="noreply@example.com"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">
                  Пароль{smtpPassSet ? <span className="ml-1 text-emerald-400">(задан)</span> : null}
                </label>
                <input
                  type="password"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-white text-sm"
                  placeholder={smtpPassSet ? '••••••••' : 'app-password'}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-muted mb-1">От кого (необязательно)</label>
                <input
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                  className="w-full px-4 py-2 bg-overlay-md border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-30 text-white text-sm"
                  placeholder="Мой VPN <noreply@example.com>"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={saveSmtp}
                disabled={smtpSaving}
                className="px-5 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 font-semibold disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {smtpSaving ? 'Сохранение…' : 'Сохранить SMTP'}
              </button>
              {smtpOk ? <div className="text-sm text-[var(--accent)]">{smtpOk}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

