import { useEffect, useState } from 'react'
import { getAuthSessionInfo, changePassword } from '../api/client'
import TwoFactorSetup from '../components/settings/TwoFactorSetup'

const ShieldIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
)

const KeyIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
  </svg>
)

export default function Profile() {
  const [authInfo, setAuthInfo] = useState<{ username?: string; role?: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAuthSessionInfo()
      .then((info: any) => {
        if (cancelled) return
        setAuthInfo({
          username: String(info?.username || ''),
          role: String(info?.role || ''),
        })
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const roleBadge = (role: string) => {
    const k = role.toLowerCase()
    if (k === 'super_admin' || k === 'owner') return 'border-red-500/25 bg-red-500/10 text-red-300'
    if (k === 'manager') return 'border-sky-500/25 bg-sky-500/10 text-sky-300'
    if (k === 'operator') return 'border-amber-500/25 bg-amber-500/10 text-amber-300'
    return 'border-default bg-overlay-sm text-dim'
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwdMsg(null)

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPwdMsg({ type: 'error', text: 'Заполните все поля' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPwdMsg({ type: 'error', text: 'Пароли не совпадают' })
      return
    }
    if (newPassword.length < 8) {
      setPwdMsg({ type: 'error', text: 'Пароль минимум 8 символов' })
      return
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setPwdMsg({ type: 'error', text: 'Пароль должен содержать буквы и цифры' })
      return
    }
    if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]/.test(newPassword)) {
      setPwdMsg({ type: 'error', text: 'Пароль должен содержать спецсимвол (!@#$%^&*...)' })
      return
    }

    setPwdLoading(true)
    try {
      await changePassword(oldPassword, newPassword)
      setPwdMsg({ type: 'success', text: 'Пароль успешно изменён. Войдите заново.' })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => { window.location.href = '/login' }, 1500)
    } catch (err: any) {
      const detail = err?.detail || err?.message || 'Ошибка смены пароля'
      setPwdMsg({ type: 'error', text: detail })
    } finally {
      setPwdLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-[720px] mx-auto px-4 py-8">
        <div className="text-sm text-muted">Загрузка...</div>
      </div>
    )
  }

  const eyeBtn = (show: boolean, toggle: () => void) => (
    <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors">
      {show ? (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      )}
    </button>
  )

  return (
    <div className="w-full max-w-[720px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold text-primary">Мой профиль</h1>
        <p className="text-sm text-muted mt-1">Настройки безопасности аккаунта</p>
      </div>

      {/* Account card */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-accent-10 flex items-center justify-center shrink-0">
            <span className="text-[var(--accent)] font-bold text-2xl">{(authInfo?.username || 'A').slice(0, 1).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold text-primary truncate">{authInfo?.username || '—'}</p>
            {authInfo?.role && (
              <span className={`mt-1.5 inline-block px-2 py-0.5 rounded-md text-xs border font-semibold ${roleBadge(authInfo.role)}`}>
                {authInfo.role}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400 shrink-0">
            <KeyIcon />
          </div>
          <div>
            <p className="text-sm font-semibold text-primary">Смена пароля</p>
            <p className="text-xs text-muted mt-0.5">Введите текущий и новый пароль</p>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-3">
          <div className="relative">
            <input
              type={showOld ? 'text' : 'password'}
              value={oldPassword}
              onChange={e => setOldPassword(e.target.value)}
              placeholder="Текущий пароль"
              autoComplete="current-password"
              className="w-full h-10 px-3 pr-10 rounded-lg border border-default bg-overlay-sm text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent"
            />
            {eyeBtn(showOld, () => setShowOld(v => !v))}
          </div>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Новый пароль"
              autoComplete="new-password"
              className="w-full h-10 px-3 pr-10 rounded-lg border border-default bg-overlay-sm text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent"
            />
            {eyeBtn(showNew, () => setShowNew(v => !v))}
          </div>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Подтвердите новый пароль"
              autoComplete="new-password"
              className="w-full h-10 px-3 pr-10 rounded-lg border border-default bg-overlay-sm text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent"
            />
            {eyeBtn(showConfirm, () => setShowConfirm(v => !v))}
          </div>

          {pwdMsg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${pwdMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {pwdMsg.text}
            </div>
          )}

          <button
            type="submit"
            disabled={pwdLoading}
            className="h-9 px-4 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {pwdLoading ? 'Сохранение...' : 'Сменить пароль'}
          </button>
        </form>
      </div>

      {/* 2FA */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
            <ShieldIcon />
          </div>
          <div>
            <p className="text-sm font-semibold text-primary">Двухфакторная аутентификация</p>
            <p className="text-xs text-muted mt-0.5">Защитите аккаунт с помощью приложения-аутентификатора (TOTP)</p>
          </div>
        </div>
        <TwoFactorSetup />
      </div>
    </div>
  )
}
