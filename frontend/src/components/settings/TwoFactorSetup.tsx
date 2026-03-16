import { useState, useEffect } from 'react'
import { get2faStatus, setup2fa, confirm2fa, disable2fa } from '../../api/client'
import { useToastContext } from '../../contexts/ToastContext'

export default function TwoFactorSetup() {
  const toast = useToastContext()
  const [enabled, setEnabled] = useState(false)
  const [hasBackup, setHasBackup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'idle' | 'setup' | 'disable'>('idle')

  // Setup state
  const [qrUri, setQrUri] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [setupStep, setSetupStep] = useState<'scan' | 'confirm' | 'done'>('scan')

  // Disable state
  const [disablePassword, setDisablePassword] = useState('')

  const loadStatus = async () => {
    try {
      const s = await get2faStatus()
      setEnabled(s.enabled)
      setHasBackup(s.has_backup_codes)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStatus() }, [])

  const startSetup = async () => {
    setLoading(true)
    try {
      const data = await setup2fa()
      setSecret(data.secret)
      setQrUri(data.otpauth_uri)
      setCode('')
      setSetupStep('scan')
      setMode('setup')
    } catch (e: any) {
      toast.showError('Ошибка', e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  const confirmSetup = async () => {
    if (code.length < 6) return
    setLoading(true)
    try {
      const data = await confirm2fa(code)
      setBackupCodes(data.backup_codes)
      setSetupStep('done')
      setEnabled(true)
      setHasBackup(true)
    } catch (e: any) {
      toast.showError('Ошибка', e?.message || 'Неверный код')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const doDisable = async () => {
    if (!disablePassword) return
    setLoading(true)
    try {
      await disable2fa(disablePassword)
      setEnabled(false)
      setHasBackup(false)
      setMode('idle')
      setDisablePassword('')
      toast.showSuccess('2FA отключена', '')
    } catch (e: any) {
      toast.showError('Ошибка', e?.message || 'Неверный пароль')
    } finally {
      setLoading(false)
    }
  }

  const qrImageUrl = qrUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUri)}`
    : ''

  if (loading && mode === 'idle') {
    return <div className="text-sm text-muted">Загрузка...</div>
  }

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-secondary">Двухфакторная аутентификация (TOTP)</div>
          <div className="text-xs text-muted mt-0.5">
            {enabled
              ? `Включена${hasBackup ? ' · есть резервные коды' : ' · резервные коды использованы'}`
              : 'Отключена — рекомендуется включить'}
          </div>
        </div>
        <div className="flex gap-2">
          {enabled ? (
            <button
              onClick={() => { setMode('disable'); setDisablePassword('') }}
              className="px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Отключить
            </button>
          ) : (
            <button
              onClick={startSetup}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
            >
              Включить 2FA
            </button>
          )}
        </div>
      </div>

      {/* Setup flow */}
      {mode === 'setup' && (
        <div className="mt-4 p-4 rounded-xl border border-default bg-overlay-xs space-y-4">
          {setupStep === 'scan' && (
            <>
              <div className="text-sm font-medium text-secondary">Шаг 1: Отсканируйте QR-код</div>
              <div className="flex flex-col items-center gap-4">
                {qrImageUrl && (
                  <img src={qrImageUrl} alt="QR code" className="rounded-lg" width={180} height={180} />
                )}
                <div className="text-center">
                  <div className="text-xs text-muted mb-1">или введите секрет вручную:</div>
                  <code className="text-xs font-mono text-sky-300 bg-sky-900/20 px-2 py-1 rounded select-all">{secret}</code>
                </div>
              </div>
              <button
                onClick={() => setSetupStep('confirm')}
                className="w-full py-2 rounded-lg bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)] font-semibold text-sm hover:bg-[rgb(var(--accent-rgb)/0.18)]"
              >
                Далее →
              </button>
            </>
          )}

          {setupStep === 'confirm' && (
            <>
              <div className="text-sm font-medium text-secondary">Шаг 2: Подтвердите код</div>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full px-3 py-2 rounded-lg bg-overlay-xs border border-default text-primary text-center text-xl tracking-widest font-mono focus:outline-none focus:border-[var(--accent)]"
                maxLength={6}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setSetupStep('scan')}
                  className="flex-1 py-2 rounded-lg border border-default text-dim text-sm"
                >
                  ← Назад
                </button>
                <button
                  onClick={confirmSetup}
                  disabled={code.length < 6 || loading}
                  className="flex-1 py-2 rounded-lg bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)] font-semibold text-sm disabled:opacity-50 hover:bg-[rgb(var(--accent-rgb)/0.18)]"
                >
                  {loading ? 'Проверяем...' : 'Подтвердить'}
                </button>
              </div>
            </>
          )}

          {setupStep === 'done' && (
            <>
              <div className="text-sm font-medium text-emerald-400">2FA успешно включена!</div>
              <div className="text-xs text-muted mb-2">
                Сохраните резервные коды — они одноразовые и позволят войти, если потеряете доступ к приложению.
              </div>
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((c, i) => (
                  <code key={i} className="text-xs font-mono text-amber-300 bg-amber-900/15 px-3 py-1.5 rounded text-center select-all">{c}</code>
                ))}
              </div>
              <button
                onClick={() => { setMode('idle'); setBackupCodes([]) }}
                className="w-full py-2 rounded-lg bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)] font-semibold text-sm mt-2 hover:bg-[rgb(var(--accent-rgb)/0.18)]"
              >
                Готово
              </button>
            </>
          )}
        </div>
      )}

      {/* Disable flow */}
      {mode === 'disable' && (
        <div className="mt-4 p-4 rounded-xl border border-red-500/20 bg-red-950/10 space-y-3">
          <div className="text-sm font-medium text-red-400">Отключение 2FA</div>
          <div className="text-xs text-muted">Введите пароль для подтверждения</div>
          <input
            type="password"
            value={disablePassword}
            onChange={e => setDisablePassword(e.target.value)}
            placeholder="Ваш пароль"
            className="w-full px-3 py-2 rounded-lg bg-overlay-xs border border-default text-primary focus:outline-none focus:border-red-500/50"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setMode('idle'); setDisablePassword('') }}
              className="flex-1 py-2 rounded-lg border border-default text-dim text-sm"
            >
              Отмена
            </button>
            <button
              onClick={doDisable}
              disabled={!disablePassword || loading}
              className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? 'Отключаем...' : 'Отключить 2FA'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
