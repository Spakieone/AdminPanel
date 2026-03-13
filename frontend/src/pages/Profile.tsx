import { useEffect, useState } from 'react'
import { getAuthSessionInfo } from '../api/client'
import TwoFactorSetup from '../components/settings/TwoFactorSetup'

const ShieldIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
)

export default function Profile() {
  const [authInfo, setAuthInfo] = useState<{ username?: string; role?: string } | null>(null)
  const [loading, setLoading] = useState(true)

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

  if (loading) {
    return (
      <div className="w-full max-w-[720px] mx-auto px-4 py-8">
        <div className="text-sm text-muted">Загрузка...</div>
      </div>
    )
  }

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
