import { useEffect, useMemo, useRef, useState } from 'react'
import CapybaraLoader from '../components/common/CapybaraLoader'
import { GradientAlert } from '../components/common/GradientAlert'
import ConfirmModal from '../components/common/ConfirmModal'
import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../components/common/ModalShell'
import OpenPanelSettingsButton from '../components/common/OpenPanelSettingsButton'
import DeleteButton from '../components/ui/DeleteButton'
import DarkSelect from '../components/common/DarkSelect'
import { getBotConfigAsync } from '../utils/botConfig'
import {
  deleteSenderSavedMessage,
  listSenderSavedMessages,
  saveSenderSavedMessage,
  uploadSenderPhoto,
  type SenderSavedMessage,
} from '../api/client'
import {
  getBroadcastJob,
  listBroadcastJobs,
  startBroadcast,
  type BroadcastButton,
  type BroadcastJob,
  type BroadcastSendTo,
  type BotApiConfig,
} from '../api/botApi'

const SEND_TO: Array<{ value: BroadcastSendTo; label: string; hint: string }> = [
  { value: 'all', label: 'Все', hint: 'Все пользователи' },
  { value: 'subscribed', label: 'С подпиской', hint: 'Активная подписка' },
  { value: 'unsubscribed', label: 'Без подписки', hint: 'Нет активной подписки' },
  { value: 'trial', label: 'Триал', hint: 'Пользователи с триалом' },
  { value: 'untrial', label: 'Без триала', hint: 'Триал не использовали' },
  { value: 'hotleads', label: 'Горячие лиды', hint: 'Платили раньше, но без активных ключей' },
  { value: 'cluster', label: 'Кластер', hint: 'Пользователи в кластере' },
  { value: 'tg_id', label: 'TG ID', hint: 'Отправить одному пользователю по tg_id' },
]

function fmtState(s: BroadcastJob['state']) {
  if (s === 'queued') return 'В очереди'
  if (s === 'running') return 'Выполняется'
  if (s === 'done') return 'Завершено'
  if (s === 'failed') return 'Ошибка'
  return s
}

const BOT_CALLBACK_PRESETS: Array<{ value: string; label: string }> = [
  // Main / start
  { value: 'start', label: 'Старт (start)' },
  { value: 'profile', label: 'Личный кабинет (profile)' },
  { value: 'partner', label: 'Партнёрская программа (partner)' },
  { value: 'about_vpn', label: 'О VPN (about_vpn)' },
  { value: 'instructions', label: 'Инструкция (instructions)' },
  { value: 'check_subscription', label: 'Проверить подписку на канал (check_subscription)' },

  // Keys / subscriptions
  { value: 'view_keys', label: 'Мои ключи (view_keys)' },
  { value: 'create_key', label: 'Создать ключ / Триал (create_key)' },
  { value: 'buy', label: 'Купить подписку (buy)' },

  // Payments / balance
  { value: 'balance', label: 'Баланс (balance)' },
  { value: 'pay', label: 'Оплатить (pay)' },
  { value: 'balance_history', label: 'История баланса (balance_history)' },
  { value: 'donate', label: 'Донат (donate)' },

  // Referrals / gifts / coupons
  { value: 'invite', label: 'Рефералы (invite)' },
  { value: 'gifts', label: 'Подарки (gifts)' },
  { value: 'activate_coupon', label: 'Купон (activate_coupon)' },
]

const BOT_CALLBACK_PRESET_VALUES = new Set(BOT_CALLBACK_PRESETS.map((x) => x.value))

function normalizeSavedButtons(btns: any): BroadcastButton[] {
  if (!Array.isArray(btns)) return []
  return btns
    .filter((b) => b && typeof b === 'object')
    .map((b) => {
      const text = String((b as any).text || '').trim()
      const urlRaw = (b as any).url
      const cbRaw = (b as any).callback
      const url = urlRaw === null || urlRaw === undefined ? '' : String(urlRaw).trim()
      const callback = cbRaw === null || cbRaw === undefined ? '' : String(cbRaw).trim()
      if (callback) return { text, callback, url: undefined }
      if (url) return { text, url, callback: undefined }
      return { text, url: '', callback: undefined }
    })
    .filter((b) => b.text.length > 0 && (Boolean(b.url) || Boolean(b.callback)))
}

function isDryRunJob(job?: BroadcastJob | null): boolean {
  return Boolean(job?.stats && typeof job.stats === 'object' && (job.stats as any).dry_run === true)
}

function pct(sent?: number | null, total?: number | null): number | null {
  const s = typeof sent === 'number' ? sent : Number(sent)
  const t = typeof total === 'number' ? total : Number(total)
  if (!Number.isFinite(s) || !Number.isFinite(t) || t <= 0) return null
  return Math.max(0, Math.min(100, Math.round((s / t) * 100)))
}

function SaveTemplateModal({
  isOpen,
  value,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean
  value: string
  busy: boolean
  onChange: (next: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const t = window.setTimeout(() => {
      try {
        inputRef.current?.focus()
        inputRef.current?.select()
      } catch {
        // ignore
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <ModalShell
      isOpen={isOpen}
      title="Сохранить в шаблон"
      subtitle="Шаблон будет доступен всем админам"
      onClose={onCancel}
      closeOnBackdropClick={false}
      closeOnEsc={false}
      closeButtonTone="danger"
      shellTone="neutral"
      size="sm"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onCancel} className={modalSecondaryButtonClass} disabled={busy}>
            Отмена
          </button>
          <button type="button" onClick={onConfirm} className={modalPrimaryButtonClass} disabled={busy}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      }
    >
      <label className="block">
        <div className="text-xs text-muted mb-1">Название</div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="filter-field"
          placeholder="Например: Партнёрка"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onConfirm()
            }
          }}
        />
      </label>
      <div className="mt-2 text-xs text-muted">Сохраняется: аудитория, TG ID/кластер, текст, фото и кнопки.</div>
    </ModalShell>
  )
}

export default function Sender() {
  const [config, setConfig] = useState<BotApiConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const missingProfile = Boolean(error && error.includes('Нет активного профиля'))

  const [sendTo, setSendTo] = useState<BroadcastSendTo>('all')
  const [clusterName, setClusterName] = useState('')
  const [tgId, setTgId] = useState<number | ''>('')
  const [photo, setPhoto] = useState('')
  const [text, setText] = useState('')
  const [buttons, setButtons] = useState<BroadcastButton[]>([])
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const photoFileRef = useRef<HTMLInputElement | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)

  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<BroadcastJob | null>(null)
  const [recentJobs, setRecentJobs] = useState<BroadcastJob[]>([])
  const pollRef = useRef<number | null>(null)

  // Saved messages (server-side)
  const [savedMessages, setSavedMessages] = useState<SenderSavedMessage[]>([])
  const [saveName, setSaveName] = useState('')
  const [savedBusy, setSavedBusy] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [confirmDeleteSavedId, setConfirmDeleteSavedId] = useState<string | null>(null)

  const sendToGroups = useMemo(
    () => [
      {
        options: SEND_TO.map((x) => ({ value: x.value, label: x.label })),
      },
    ],
    [],
  )

  const buttonModeGroups = useMemo(
    () => [
      {
        options: [
          { value: 'url', label: 'URL' },
          { value: 'callback', label: 'Callback' },
        ],
      },
    ],
    [],
  )

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const cfg = await getBotConfigAsync()
        if (cancelled) return
        if (!cfg) {
          setConfig(null)
          setError('Нет активного профиля. Создайте профиль в настройках.')
          setLoading(false)
          return
        }
        setConfig(cfg)
        try {
          const list = await listBroadcastJobs(cfg, 20)
          setRecentJobs(list.items || [])
        } catch {
          // ignore
        }
        setLoading(false)
      } catch (e: any) {
        if (cancelled) return
        setLoading(false)
        setError(e?.message || 'Ошибка загрузки')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const reloadSavedMessages = async () => {
    try {
      const res = await listSenderSavedMessages()
      setSavedMessages(Array.isArray(res.items) ? res.items : [])
    } catch (_e: any) {
      // don't block Sender if this fails
      setSavedMessages([])
    }
  }

  useEffect(() => {
    if (!config) return
    reloadSavedMessages()
  }, [config])

  // Poll job status
  useEffect(() => {
    if (!config) return
    if (!job?.id) return
    if (job.state === 'done' || job.state === 'failed') return

    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await getBroadcastJob(config, job.id)
        setJob(res.job)
        // Keep "История" live without a full page refresh
        setRecentJobs((prev) => {
          const nextJob = res.job
          if (!nextJob?.id) return prev
          const idx = prev.findIndex((x) => String(x?.id) === String(nextJob.id))
          if (idx === -1) return [nextJob, ...prev].slice(0, 20)
          const copy = prev.slice()
          copy[idx] = nextJob
          return copy
        })
      } catch {
        // ignore transient
      }
    }, 2000)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [config, job?.id, job?.state])

  const addButton = () => setButtons((prev) => [...prev, { text: '', url: '' }])
  const removeButton = (idx: number) => setButtons((prev) => prev.filter((_, i) => i !== idx))

  const sendToMeta = useMemo(() => SEND_TO.find((x) => x.value === sendTo) || null, [sendTo])

  const buildCleanedButtons = () => {
    return (buttons || [])
      .map((b) => ({
        text: String(b.text || '').trim(),
        url: b.url ? String(b.url).trim() : undefined,
        callback: b.callback ? String(b.callback).trim() : undefined,
      }))
      .map((b) => {
        const url = String(b.url || '').trim()
        const callback = String(b.callback || '').trim()
        // enforce exactly one target
        if (url && callback) return { text: b.text, url, callback: undefined }
        if (url) return { text: b.text, url, callback: undefined }
        if (callback) return { text: b.text, url: undefined, callback }
        return { text: b.text, url: undefined, callback: undefined }
      })
      .filter((b) => b.text.length > 0 && (!!b.url || !!b.callback))
  }

  const run = async (dryRun: boolean, override?: { sendTo?: BroadcastSendTo; tgId?: number }) => {
    if (busy) return
    setError(null)
    if (!config) {
      setError('Нет активного профиля. Создайте профиль в настройках.')
      return
    }
    const t = String(text || '').trim()
    if (!t) {
      setError('Текст сообщения обязателен')
      return
    }
    const effectiveSendTo = override?.sendTo ?? sendTo
    if (effectiveSendTo === 'cluster' && !String(clusterName || '').trim()) {
      setError('Для режима "Кластер" нужно указать cluster_name')
      return
    }
    if (effectiveSendTo === 'tg_id') {
      const raw =
        typeof override?.tgId === 'number'
          ? override.tgId
          : typeof tgId === 'number'
            ? tgId
            : Number(String(tgId || '').trim())
      if (!Number.isFinite(raw) || raw <= 0) {
        setError('Для режима "TG ID" нужно указать tg_id')
        return
      }
    }

    const cleanedButtons = buildCleanedButtons()

    setBusy(true)
    try {
      const res = await startBroadcast(config, {
        send_to: effectiveSendTo,
        cluster_name: effectiveSendTo === 'cluster' ? String(clusterName || '').trim() : undefined,
        tg_id:
          effectiveSendTo === 'tg_id'
            ? typeof override?.tgId === 'number'
              ? override.tgId
              : typeof tgId === 'number'
                ? tgId
                : Number(String(tgId || '').trim())
            : undefined,
        text: t,
        photo: String(photo || '').trim() || undefined,
        buttons: cleanedButtons.length > 0 ? cleanedButtons : undefined,
        dry_run: dryRun,
      })
      setJob(res.job)
      try {
        const list = await listBroadcastJobs(config, 20)
        setRecentJobs(list.items || [])
      } catch {
        // ignore
      }
    } catch (e: any) {
      setError(e?.message || 'Ошибка запуска рассылки')
    } finally {
      setBusy(false)
    }
  }

  const runTestToAdmin = async () => {
    if (!config) {
      setError('Нет активного профиля. Создайте профиль в настройках.')
      return
    }
    // admin tg id is stored in active bot profile and exposed as config.tgId
    const adminTgId = Number(config.tgId)
    if (!Number.isFinite(adminTgId) || adminTgId <= 0) {
      setError('Не найден TG ID админа в профиле бота (adminId)')
      return
    }
    await run(false, { sendTo: 'tg_id', tgId: adminTgId })
  }

  const onQuote = () => {
    const el = textAreaRef.current
    if (!el) return
    const value = String(text || '')
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : 0
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : 0
    const hasSel = end > start
    let a = start
    let b = end
    if (!hasSel) {
      // wrap current line
      const ls = value.lastIndexOf('\n', Math.max(0, start - 1))
      a = ls === -1 ? 0 : ls + 1
      const le = value.indexOf('\n', start)
      b = le === -1 ? value.length : le
    }
    const chunk = value.slice(a, b)
    const wrapped = `<blockquote>${chunk}</blockquote>`
    const next = value.slice(0, a) + wrapped + value.slice(b)
    setText(next)
    requestAnimationFrame(() => {
      try {
        el.focus()
        const pos = a + wrapped.length
        el.setSelectionRange(pos, pos)
      } catch {
        // ignore
      }
    })
  }

  const onPickPhoto = () => photoFileRef.current?.click()

  const onPhotoSelected = async (e: any) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError(null)
    setPhotoUploading(true)
    try {
      const res = await uploadSenderPhoto(f)
      setPhoto(String(res.url || ''))
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки фото')
    } finally {
      setPhotoUploading(false)
    }
  }

  const onOpenSaveTemplate = () => {
    setError(null)
    const t = String(text || '').trim()
    if (!t) {
      setError('Текст сообщения обязателен')
      return
    }
    setSaveModalOpen(true)
  }

  const onSaveMessage = async () => {
    if (savedBusy) return
    setError(null)
    if (!config) {
      setError('Нет активного профиля. Создайте профиль в настройках.')
      return
    }
    const name = String(saveName || '').trim()
    if (!name) {
      setError('Введите название для сохранения')
      return
    }
    const t = String(text || '').trim()
    if (!t) {
      setError('Текст сообщения обязателен')
      return
    }
    const cleanedButtons = buildCleanedButtons()
    const savedClusterName = String(clusterName || '').trim()
    const rawTgId = typeof tgId === 'number' ? tgId : Number(String(tgId || '').trim())
    const savedTgId = Number.isFinite(rawTgId) && rawTgId > 0 ? rawTgId : null
    setSavedBusy(true)
    try {
      await saveSenderSavedMessage({
        name,
        send_to: sendTo,
        // Save absolutely all entered fields, regardless of current send_to
        cluster_name: savedClusterName ? savedClusterName : null,
        tg_id: savedTgId,
        text: String(text || ''),
        photo: String(photo || '').trim() || null,
        buttons: cleanedButtons.length > 0 ? cleanedButtons : null,
      })
      await reloadSavedMessages()
      setSaveModalOpen(false)
      setSaveName('')
    } catch (err: any) {
      setError(err?.message || 'Ошибка сохранения сообщения')
    } finally {
      setSavedBusy(false)
    }
  }

  const onDeleteSaved = (id: string) => {
    const mid = String(id || '').trim()
    if (!mid) return
    setConfirmDeleteSavedId(mid)
  }

  const onConfirmDeleteSaved = async () => {
    if (savedBusy) return
    const id = String(confirmDeleteSavedId || '').trim()
    if (!id) return
    setSavedBusy(true)
    try {
      await deleteSenderSavedMessage(id)
      await reloadSavedMessages()
      setConfirmDeleteSavedId(null)
    } catch (err: any) {
      setError(err?.message || 'Ошибка удаления сообщения')
    } finally {
      setSavedBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <CapybaraLoader />
      </div>
    )
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">
      <SaveTemplateModal
        isOpen={saveModalOpen}
        value={saveName}
        busy={savedBusy}
        onChange={setSaveName}
        onCancel={() => {
          if (savedBusy) return
          setSaveModalOpen(false)
        }}
        onConfirm={onSaveMessage}
      />
      <ConfirmModal
        isOpen={Boolean(confirmDeleteSavedId)}
        title="Удалить сохранённое сообщение?"
        message={
          (() => {
            const msg = savedMessages.find((m) => String(m.id) === String(confirmDeleteSavedId || ''))
            return msg ? `Удалить «${msg.name}»? Это действие нельзя отменить.` : 'Удалить сохранённое сообщение? Это действие нельзя отменить.'
          })()
        }
        confirmText={savedBusy ? 'Удаление…' : 'Удалить'}
        cancelText="Отмена"
        onCancel={() => setConfirmDeleteSavedId(null)}
        onConfirm={onConfirmDeleteSaved}
      />

      {error && (
        <div className="mt-4">
          <GradientAlert
            variant="error"
            title="Ошибка"
            description={
              missingProfile ? (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <span>{error}</span>
                  <OpenPanelSettingsButton className="sm:flex-shrink-0" />
                </div>
              ) : (
                error
              )
            }
            onClose={() => setError(null)}
          />
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-default bg-overlay-sm p-4">
          <div className="text-lg font-semibold text-primary">Сообщение</div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs text-muted mb-1">Аудитория</div>
              <DarkSelect
                value={sendTo}
                onChange={(v) => setSendTo(v as BroadcastSendTo)}
                groups={sendToGroups}
                buttonClassName="filter-field"
              />
              {sendToMeta?.hint ? <div className="mt-1 text-[11px] text-muted">{sendToMeta.hint}</div> : null}
            </label>

            {sendTo === 'tg_id' ? (
              <label className="block">
                <div className="text-xs text-muted mb-1">TG ID</div>
                <input
                  type="number"
                  value={tgId}
                  onChange={(e) => setTgId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="filter-field"
                  placeholder="Например 123456789"
                />
              </label>
            ) : (
              <div className="hidden md:block" />
            )}

            {sendTo === 'cluster' && (
              <label className="block md:col-span-2">
                <div className="text-xs text-muted mb-1">cluster_name</div>
                <input
                  value={clusterName}
                  onChange={(e) => setClusterName(e.target.value)}
                  className="filter-field"
                  placeholder="например: main"
                />
              </label>
            )}

            {/* workers / messages_per_second убраны из UI по запросу (используются дефолты на сервере) */}
          </div>

          <div className="mt-4">
            <div className="text-xs text-muted mb-1">Фото (URL, опционально)</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={photo}
                onChange={(e) => setPhoto(e.target.value)}
                className="filter-field"
                placeholder="https://..."
              />
              <input
                ref={photoFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPhotoSelected}
              />
              <button
                type="button"
                onClick={onPickPhoto}
                disabled={photoUploading}
                className="h-10 px-4 rounded-xl border border-default bg-overlay-xs text-secondary hover:bg-overlay-sm disabled:opacity-50"
                title="Загрузить фото на сервер и подставить URL"
              >
                {photoUploading ? 'Загрузка…' : 'Загрузить фото'}
              </button>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs text-muted">Текст (HTML как в боте)</div>
              <button
                type="button"
                onClick={onQuote}
                className="h-8 px-3 rounded-xl border border-default bg-overlay-xs text-secondary hover:bg-overlay-sm"
                title="Обернуть выделенный текст в <blockquote> (как на скрине)"
              >
                Цитата
              </button>
            </div>
            <textarea
              ref={textAreaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full min-h-[360px] sm:min-h-[520px] rounded-2xl border border-default bg-overlay-sm text-secondary px-3 py-2"
              placeholder="HTML поддерживается (как в боте). Для цитаты выдели текст и нажми «Цитата»."
            />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-primary">Кнопки</div>
              <button
                type="button"
                onClick={addButton}
                className="h-9 px-3 rounded-xl border border-default bg-overlay-xs text-secondary hover:bg-overlay-sm"
              >
                + Добавить
              </button>
            </div>

            {buttons.length === 0 ? (
              <div className="mt-2 text-sm text-muted">Нет кнопок</div>
            ) : (
              <div className="mt-2 space-y-2">
                {buttons.map((b, idx) => (
                  <div key={idx} className="flex flex-col md:flex-row gap-2 rounded-xl border border-default bg-overlay-xs p-2">
                    <input
                      value={b.text}
                      onChange={(e) =>
                        setButtons((prev) => prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))
                      }
                      className="filter-field"
                      placeholder="Текст кнопки"
                    />
                    <div className="md:w-[140px]">
                      <DarkSelect
                        value={b.url === undefined ? 'callback' : 'url'}
                        onChange={(mode) => {
                          setButtons((prev) =>
                            prev.map((x, i) => {
                              if (i !== idx) return x
                              if (mode === 'callback') return { ...x, callback: x.callback ?? '', url: undefined }
                              return { ...x, url: x.url ?? '', callback: undefined }
                            }),
                          )
                        }}
                        groups={buttonModeGroups}
                        buttonClassName="filter-field"
                      />
                    </div>
                    {b.url === undefined ? (
                      <div className="flex-[2]">
                        <DarkSelect
                          value={String(b.callback || '').trim()}
                          onChange={(v) =>
                            setButtons((prev) => prev.map((x, i) => (i === idx ? { ...x, callback: v, url: undefined } : x)))
                          }
                          groups={[
                            {
                              options: [
                                { value: '', label: 'Выбрать колбек…' },
                                ...(String(b.callback || '').trim() && !BOT_CALLBACK_PRESET_VALUES.has(String(b.callback || '').trim())
                                  ? [{ value: String(b.callback || '').trim(), label: `${String(b.callback || '').trim()} (неизвестно)` }]
                                  : []),
                                ...BOT_CALLBACK_PRESETS.map((p) => ({ value: p.value, label: p.label })),
                              ],
                            },
                          ]}
                          buttonClassName="filter-field"
                        />
                      </div>
                    ) : (
                      <input
                        value={b.url || ''}
                        onChange={(e) =>
                          setButtons((prev) => prev.map((x, i) => (i === idx ? { ...x, url: e.target.value, callback: undefined } : x)))
                        }
                        className="flex-[2] h-10 rounded-xl border border-default bg-overlay-sm text-secondary px-3"
                        placeholder="https://..."
                      />
                    )}
                    <DeleteButton size="sm" onClick={() => removeButton(idx)} ariaLabel="Удалить кнопку" title="Удалить" variant="big" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-default pt-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
              <div className="text-xs text-muted">
                {busy ? 'Выполняется…' : 'Готово к отправке'}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={runTestToAdmin}
                  className="h-10 px-3 rounded-xl border border-blue-500/25 bg-accent-10 text-blue-200 hover:bg-blue-500/15 disabled:opacity-50"
                >
                  Тест админу
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(false)}
                  className="h-10 px-4 rounded-xl border border-green-500/25 bg-green-500/15 text-green-200 hover:bg-green-500/20 disabled:opacity-50"
                >
                  Отправить
                </button>
                <button
                  type="button"
                  disabled={savedBusy || busy}
                  onClick={onOpenSaveTemplate}
                  className="h-10 px-4 rounded-xl border border-default bg-overlay-xs text-secondary hover:bg-overlay-sm disabled:opacity-50"
                  title="Сохранить текущие параметры как шаблон"
                >
                  Сохранить в шаблон
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-default bg-overlay-sm p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-lg font-semibold text-primary">Шаблоны</div>
              <button
                type="button"
                onClick={reloadSavedMessages}
                disabled={savedBusy}
                className="h-8 px-3 rounded-xl border border-default bg-overlay-xs text-secondary hover:bg-overlay-sm disabled:opacity-50 text-sm"
                title="Обновить список"
              >
                Обновить
              </button>
            </div>

            {savedMessages.length === 0 ? (
              <div className="mt-2 text-sm text-muted">Пока нет сохранённых шаблонов</div>
            ) : (
              <div className="mt-3 space-y-2 max-h-[420px] overflow-auto pr-1">
                {savedMessages.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      if (m.send_to) setSendTo(m.send_to as any)
                      setClusterName(String(m.cluster_name || ''))
                      setTgId(typeof m.tg_id === 'number' ? m.tg_id : '')
                      setPhoto(String(m.photo || ''))
                      setText(String(m.text || ''))
                      setButtons(normalizeSavedButtons(m.buttons))
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        ;(e.currentTarget as any).click()
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="w-full text-left rounded-xl border border-default border-l-4 border-l-indigo-400/40 bg-gradient-to-r from-indigo-500/10 to-black/10 hover:from-indigo-500/15 hover:to-black/10 hover:border-strong px-3 py-2.5 cursor-pointer outline-none focus:ring-2 focus:ring-accent-30"
                    title="Клик — применить"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-primary truncate leading-snug">{m.name}</div>
                        <div className="mt-1 text-xs text-muted truncate">
                          {(m.photo ? 'photo' : 'no photo')} • buttons: {Array.isArray(m.buttons) ? m.buttons.length : 0}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-xs text-muted">
                          {m.updated_at ? String(m.updated_at).replace('T', ' ').replace('Z', '') : ''}
                        </div>
                        <DeleteButton
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onDeleteSaved(String(m.id))
                          }}
                          ariaLabel="Удалить шаблон"
                          title="Удалить"
                          variant="small"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-2 text-xs text-muted">Шаблоны хранятся на сервере и доступны всем админам.</div>
          </div>

          <div className="rounded-2xl border border-default bg-overlay-sm p-4">
            <div className="text-lg font-semibold text-primary">Статус и история</div>
            {!job ? (
              <div className="mt-2 text-sm text-muted">Пока нет запущенных задач</div>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`text-[11px] px-2 py-1 rounded-full border ${
                      job.state === 'failed'
                        ? 'border-red-400/30 bg-red-500/10 text-red-200'
                        : job.state === 'done'
                          ? 'border-accent-30 bg-accent-10 text-[var(--accent)]'
                          : 'border-yellow-400/30 bg-yellow-500/10 text-yellow-200'
                    } ${job.state === 'running' ? 'animate-pulse' : ''}`}
                    title="Состояние"
                  >
                    {job.state === 'running' ? 'Выполняется…' : fmtState(job.state)}
                  </span>
                  <span
                    className={`text-[11px] px-2 py-1 rounded-full border ${
                      isDryRunJob(job) ? 'border-blue-400/30 bg-accent-10 text-blue-200' : 'border-accent-30 bg-accent-10 text-[var(--accent)]'
                    }`}
                  >
                    {isDryRunJob(job) ? 'DRY‑RUN' : 'ОТПРАВКА'}
                  </span>
                  <span className="text-[11px] px-2 py-1 rounded-full border border-default bg-overlay-xs text-secondary">
                    {String(job.params?.send_to || '—')}
                    {job.params?.cluster_name ? `:${job.params.cluster_name}` : ''}
                    {job.params?.tg_id ? `:${job.params.tg_id}` : ''}
                  </span>
                  {job.created_at ? (
                    <span className="text-[11px] px-2 py-1 rounded-full border border-default bg-overlay-xs text-dim">
                      {String(job.created_at).replace('T', ' ').replace('Z', '')}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-secondary">
                  <span className="text-muted">Job:</span> <span className="font-mono">{job.id}</span>
                </div>
                {pct(job.sent ?? null, job.total ?? null) !== null ? (
                  <div className="mt-1">
                    <div className="h-2 rounded-full bg-overlay-sm overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${
                          job.state === 'failed'
                            ? 'bg-red-500/70'
                            : job.state === 'done'
                              ? 'bg-accent'
                              : 'bg-yellow-500/70'
                        }`}
                        style={{ width: `${pct(job.sent ?? null, job.total ?? null)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Прогресс: {pct(job.sent ?? null, job.total ?? null)}% • отправлено: {job.sent ?? '—'} / {job.total ?? '—'}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted">
                    Отправлено: <span className="text-secondary">{job.sent ?? '—'}</span> • Всего:{' '}
                    <span className="text-secondary">{job.total ?? '—'}</span>
                  </div>
                )}
                {job.error ? (
                  <div className="text-sm text-red-200 break-words">
                    <span className="text-red-300">Ошибка:</span> {job.error}
                  </div>
                ) : null}
                {job.params && (
                  <details className="mt-1 rounded-xl border border-default bg-overlay-xs px-3 py-2">
                    <summary className="cursor-pointer text-sm text-secondary hover:text-primary">Что отправляем</summary>
                    <div className="mt-2 space-y-2">
                      {job.params?.photo ? (
                        <div className="text-xs text-secondary break-all">
                          <span className="text-muted">photo:</span> {String(job.params.photo)}
                        </div>
                      ) : (
                        <div className="text-xs text-muted">photo: —</div>
                      )}
                      <div className="text-xs text-secondary whitespace-pre-wrap break-words">
                        <span className="text-muted">text:</span>{' '}
                        {String(job.params?.text || '').trim() ? String(job.params.text) : '—'}
                      </div>
                      {Array.isArray(job.params?.buttons) && job.params.buttons.length > 0 ? (
                        <div className="text-xs text-secondary">
                          <div className="text-muted mb-1">buttons:</div>
                          <div className="space-y-1">
                            {job.params.buttons.slice(0, 12).map((b: any, i: number) => (
                              <div key={i} className="flex items-start justify-between gap-2">
                                <div className="truncate">{String(b?.text || '').trim() || '—'}</div>
                                <div className="font-mono text-muted truncate">
                                  {b?.url ? `url:${String(b.url)}` : b?.callback ? `cb:${String(b.callback)}` : '—'}
                                </div>
                              </div>
                            ))}
                            {job.params.buttons.length > 12 ? (
                              <div className="text-muted">…ещё {job.params.buttons.length - 12}</div>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted">buttons: —</div>
                      )}
                    </div>
                  </details>
                )}
                {job.stats && typeof job.stats === 'object' && job.stats ? (
                  <div className="mt-1 text-xs text-muted">
                    {'success_count' in job.stats ? (
                      <span className="text-[var(--accent)]">ok: {String((job.stats as any).success_count)}</span>
                    ) : null}
                    {'fail_count' in job.stats ? (
                      <span className="ml-3 text-red-200">fail: {String((job.stats as any).fail_count)}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            <div className="mt-5 border-t border-default pt-4">
              <div className="text-sm font-semibold text-primary">История</div>
              {recentJobs.length === 0 ? (
                <div className="mt-2 text-sm text-muted">Пусто</div>
              ) : (
                <div className="mt-2 space-y-2">
                  {recentJobs.slice(0, 10).map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setJob(j)}
                      className="w-full text-left rounded-xl border border-default bg-overlay-xs hover:bg-overlay-sm px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-xs text-secondary truncate">{j.id}</div>
                        <div
                          className={`text-[11px] px-2 py-1 rounded-full border ${
                            j.state === 'failed'
                              ? 'border-red-400/30 bg-red-500/10 text-red-200'
                              : j.state === 'done'
                                ? 'border-accent-30 bg-accent-10 text-[var(--accent)]'
                                : 'border-yellow-400/30 bg-yellow-500/10 text-yellow-200'
                          } ${j.state === 'running' ? 'animate-pulse' : ''}`}
                        >
                          {fmtState(j.state)}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-muted truncate">
                        {(j.stats && typeof j.stats === 'object' && (j.stats as any).dry_run) ? 'dry_run' : 'send'} • {j.params?.send_to || '—'}
                        {j.params?.tg_id ? `:${j.params.tg_id}` : ''}
                        {j.params?.cluster_name ? `:${j.params.cluster_name}` : ''} • total: {j.total ?? '—'} • sent: {j.sent ?? '—'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

