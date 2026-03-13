import { useState, useRef, useEffect } from 'react'
import type { FormEvent } from 'react'
import { login, login2fa } from '../api/client'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials')
  const [totpCode, setTotpCode] = useState('')
  const totpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === '2fa') totpRef.current?.focus()
  }, [step])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await login(username, password)
      if ((result as any)['2fa_required']) {
        setStep('2fa')
        setLoading(false)
        return
      }
      await new Promise((r) => setTimeout(r, 200))
      window.location.href = '/webpanel/'
    } catch (err: any) {
      setError(err?.message || 'Ошибка входа')
      setLoading(false)
    }
  }

  const handle2fa = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login2fa(totpCode)
      await new Promise((r) => setTimeout(r, 200))
      window.location.href = '/webpanel/'
    } catch (err: any) {
      setError(err?.message || 'Неверный код')
      setTotpCode('')
      setLoading(false)
      totpRef.current?.focus()
    }
  }

  return (
    <div className="lf-page">
      <div className="lf-form" style={{ animation: 'fadeInUp 0.4s ease-out both' }}>

        {/* ——— Credentials step ——— */}
        {step === 'credentials' && (
          <>
            {error && (
              <div className="lf-error">
                <svg style={{width:16,height:16,flexShrink:0}} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="lf-flex-column">
                <label>Логин</label>
              </div>
              <div className="lf-inputForm">
                <svg className="lf-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
                <input
                  type="text"
                  className="lf-input"
                  placeholder="Введите логин"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>

              <div className="lf-flex-column" style={{marginTop:10}}>
                <label>Пароль</label>
              </div>
              <div className="lf-inputForm">
                <svg className="lf-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="lf-input"
                  placeholder="Введите пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button type="button" className="lf-eye" onClick={() => setShowPassword(v => !v)}>
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  )}
                </button>
              </div>

              <button type="submit" className="lf-button-submit" disabled={loading}>
                {loading ? (
                  <span className="lf-btn-inner">
                    <svg className="auth-spinner" style={{width:18,height:18}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83" /></svg>
                    Входим…
                  </span>
                ) : 'Войти'}
              </button>

            </form>
          </>
        )}

        {/* ——— 2FA step ——— */}
        {step === '2fa' && (
          <>
            {error && (
              <div className="lf-error">
                <svg style={{width:16,height:16,flexShrink:0}} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <div className="lf-2fa-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <div className="lf-2fa-title">Двухфакторная аутентификация</div>
              <div className="lf-2fa-sub">Введите код из приложения-аутентификатора</div>
            </div>

            <form onSubmit={handle2fa} style={{animation:'fadeInUp 0.3s ease-out both'}}>
              <div className="lf-flex-column">
                <label>Код подтверждения</label>
              </div>
              <div className="lf-inputForm">
                <input
                  ref={totpRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9A-Fa-f]{6,8}"
                  value={totpCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\s/g, '')
                    setTotpCode(val)
                    if (val.length === 6 && !loading) {
                      setTimeout(() => {
                        const form = totpRef.current?.closest('form') as HTMLFormElement | null
                        form?.requestSubmit()
                      }, 0)
                    }
                  }}
                  className="lf-input lf-input-2fa"
                  placeholder="000000"
                  required
                  autoComplete="one-time-code"
                  maxLength={8}
                />
              </div>
              <p className="lf-hint">6-значный код из Google Authenticator или резервный код</p>

              <button type="submit" className="lf-button-submit" disabled={loading || totpCode.length < 6}>
                {loading ? (
                  <span className="lf-btn-inner">
                    <svg className="auth-spinner" style={{width:18,height:18}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83" /></svg>
                    Проверяем…
                  </span>
                ) : 'Подтвердить'}
              </button>

              <button type="button" className="lf-btn" style={{marginTop:8}} onClick={() => { setStep('credentials'); setError(''); setTotpCode('') }}>
                <svg style={{width:16,height:16}} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" /></svg>
                Назад
              </button>
            </form>
          </>
        )}

      </div>
    </div>
  )
}
