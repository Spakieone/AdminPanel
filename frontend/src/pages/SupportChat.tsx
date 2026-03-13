import { useEffect, useMemo, useRef, useState } from 'react'
import { useToastContext } from '../contexts/ToastContext'
import {
  getBotProfiles,
  getLkProfiles,
  getLkSupportConversations,
  getLkSupportMessages,
  replyLkSupportMessage,
  uploadLkSupportImage,
  type LkProfile,
  type LkSupportConversation,
  type LkSupportMessage,
} from '../api/client'

type BotProfile = { id: string; name: string }
type PendingUpload = { id: string; url: string }

function fmtTime(raw: string): string {
  if (!raw) return ''
  try {
    const d = new Date(raw)
    if (isNaN(d.getTime())) return raw
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return raw
  }
}

function fmtDay(raw: string): string {
  if (!raw) return ''
  try {
    const d = new Date(raw)
    if (isNaN(d.getTime())) return ''
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'Сегодня'
    if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  } catch {
    return ''
  }
}

function userInitial(tgId: string): string {
  if (!tgId) return '?'
  return tgId.replace(/\D/g, '').slice(-1) || tgId[0]?.toUpperCase() || '?'
}

export default function SupportChat() {
  const toast = useToastContext()
  const notify = (type: 'success' | 'error' | 'warning', title: string, message: string) => {
    if (type === 'success') toast.showSuccess(title, message, 3000)
    else if (type === 'warning') toast.showWarning(title, message, 4500)
    else toast.showError(title, message, 4500)
  }

  const [loadingMeta, setLoadingMeta] = useState(true)
  const [metaError, setMetaError] = useState('')
  const [botProfiles, setBotProfiles] = useState<BotProfile[]>([])
  const [lkProfiles, setLkProfiles] = useState<LkProfile[]>([])
  const [selectedBotId, setSelectedBotId] = useState<string>('')

  const [convosLoading, setConvosLoading] = useState(false)
  const [convosError, setConvosError] = useState('')
  const [conversations, setConversations] = useState<LkSupportConversation[]>([])

  const [activeTgId, setActiveTgId] = useState<string>('')
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState('')
  const [messages, setMessages] = useState<LkSupportMessage[]>([])

  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [replyUploads, setReplyUploads] = useState<PendingUpload[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState('')

  const listRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const lkProfileForBot = useMemo(() => {
    const bid = String(selectedBotId || '').trim()
    if (!bid) return null
    return lkProfiles.find((p) => String((p.botProfileIds || [])[0] || '') === bid) || null
  }, [lkProfiles, selectedBotId])

  const selectedLkProfileId = useMemo(() => String(lkProfileForBot?.id || '').trim(), [lkProfileForBot?.id])

  const botOptions = useMemo(() => {
    const byBot = new Map<string, LkProfile>()
    for (const p of lkProfiles) {
      const bid = String((p.botProfileIds || [])[0] || '').trim()
      if (bid) byBot.set(bid, p)
    }
    return botProfiles.map((b) => {
      const lp = byBot.get(String(b.id))
      return {
        id: b.id,
        label: lp ? b.name : `${b.name} (ЛК не настроен)`,
        disabled: !lp,
      }
    })
  }, [botProfiles, lkProfiles])

  const loadMeta = async () => {
    try {
      setLoadingMeta(true)
      setMetaError('')
      const [botsRes, lkRes] = await Promise.all([getBotProfiles(), getLkProfiles()])
      const bots = Array.isArray((botsRes as any)?.profiles) ? ((botsRes as any).profiles as any[]) : []
      const lk = Array.isArray((lkRes as any)?.profiles) ? ((lkRes as any).profiles as any[]) : []
      const safeBots: BotProfile[] = bots
        .filter((x) => x && typeof x === 'object')
        .map((x) => ({ id: String((x as any).id || ''), name: String((x as any).name || '') }))
        .filter((x) => x.id && x.name)
      setBotProfiles(safeBots)
      setLkProfiles(lk as any)

      const lkBotIds = new Set<string>(lk.map((p: any) => String(((p as any)?.botProfileIds || [])[0] || '')).filter(Boolean))
      const firstBot = safeBots.find((b) => lkBotIds.has(b.id))
      setSelectedBotId((prev) => (prev ? prev : firstBot?.id || safeBots[0]?.id || ''))
    } catch (e: any) {
      setMetaError(e?.message || 'Не удалось загрузить профили')
    } finally {
      setLoadingMeta(false)
    }
  }

  const loadConversations = async (lkProfileId: string) => {
    const pid = String(lkProfileId || '').trim()
    if (!pid) {
      setConversations([])
      setConvosError('')
      setConvosLoading(false)
      return
    }
    try {
      setConvosLoading(true)
      setConvosError('')
      const res = await getLkSupportConversations(pid)
      setConversations(Array.isArray((res as any)?.items) ? ((res as any).items as any) : [])
    } catch (e: any) {
      setConversations([])
      setConvosError(e?.message || 'Не удалось загрузить диалоги')
    } finally {
      setConvosLoading(false)
    }
  }

  const loadMessages = async (lkProfileId: string, tgId: string) => {
    const pid = String(lkProfileId || '').trim()
    const tid = String(tgId || '').trim()
    if (!pid || !tid) {
      setMessages([])
      setMessagesError('')
      setMessagesLoading(false)
      return
    }
    try {
      setMessagesLoading(true)
      setMessagesError('')
      const res = await getLkSupportMessages(pid, tid)
      setMessages(Array.isArray((res as any)?.items) ? ((res as any).items as any) : [])
    } catch (e: any) {
      setMessages([])
      setMessagesError(e?.message || 'Не удалось загрузить сообщения')
    } finally {
      setMessagesLoading(false)
    }
  }

  useEffect(() => {
    void loadMeta()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setActiveTgId('')
    setMessages([])
    setReplyText('')
    setReplyError('')
    setReplyUploads([])
    setUploadError('')
    void loadConversations(selectedLkProfileId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLkProfileId])

  useEffect(() => {
    if (!selectedLkProfileId || !activeTgId) return
    void loadMessages(selectedLkProfileId, activeTgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLkProfileId, activeTgId])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  useEffect(() => {
    if (!selectedLkProfileId) return
    const t = window.setInterval(() => {
      void loadConversations(selectedLkProfileId)
      if (activeTgId) void loadMessages(selectedLkProfileId, activeTgId)
    }, 5000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLkProfileId, activeTgId])

  const sendReply = async () => {
    const pid = String(selectedLkProfileId || '').trim()
    const tid = String(activeTgId || '').trim()
    const msg = String(replyText || '').trim()
    const atts = replyUploads.map((x) => String(x.id || '').trim()).filter(Boolean)
    if (!pid || !tid || replying) return
    if (!msg && atts.length === 0) return
    try {
      setReplying(true)
      setReplyError('')
      await replyLkSupportMessage(pid, tid, msg, atts)
      setReplyText('')
      setReplyUploads([])
      await loadMessages(pid, tid)
      await loadConversations(pid)
      notify('success', 'Готово', 'Сообщение отправлено')
    } catch (e: any) {
      setReplyError(e?.message || 'Не удалось отправить сообщение')
      notify('error', 'Ошибка', e?.message || 'Не удалось отправить сообщение')
    } finally {
      setReplying(false)
    }
  }

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (!selectedLkProfileId || !activeTgId) {
      notify('warning', 'Нужно выбрать диалог', 'Сначала выбери диалог, потом прикрепляй изображения')
      return
    }
    try {
      setUploading(true)
      setUploadError('')
      const list = Array.from(files).slice(0, 6)
      for (const f of list) {
        const res = await uploadLkSupportImage(f)
        const id = String((res as any)?.id || '').trim()
        const url = String((res as any)?.url || '').trim()
        if (id && url) {
          setReplyUploads((prev) => {
            const next = [...prev, { id, url }]
            return next.slice(0, 6)
          })
        }
      }
    } catch (e: any) {
      const m = e?.message || 'Не удалось загрузить изображение'
      setUploadError(m)
      notify('error', 'Ошибка', m)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const activeConversation = useMemo(() => {
    const tid = String(activeTgId || '').trim()
    if (!tid) return null
    return conversations.find((c) => String((c as any)?.tg_id || '') === tid) || null
  }, [activeTgId, conversations])

  const onReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    if (e.shiftKey) return
    e.preventDefault()
    void sendReply()
  }

  // Group messages by day
  const grouped = useMemo(() => {
    const groups: Array<{ day: string; messages: LkSupportMessage[] }> = []
    for (const m of messages) {
      const day = fmtDay(String((m as any)?.created_at || ''))
      const last = groups[groups.length - 1]
      if (!last || last.day !== day) {
        groups.push({ day, messages: [m] })
      } else {
        last.messages.push(m)
      }
    }
    return groups
  }, [messages])

  const canSend = !!activeTgId && !!selectedLkProfileId && !replying && !uploading &&
    (!!String(replyText || '').trim() || replyUploads.length > 0)

  return (
    <div className="space-y-4">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xl sm:text-2xl font-bold text-primary">Чат поддержки</div>
          <div className="mt-0.5 text-sm text-muted">Сообщения пользователей из личного кабинета</div>
        </div>

        <div className="flex gap-2 items-center">
          <select
            value={selectedBotId}
            onChange={(e) => setSelectedBotId(e.target.value)}
            className="h-9 rounded-xl border border-default bg-overlay-xs px-3 text-sm text-primary focus:outline-none focus:border-strong transition-colors"
            disabled={loadingMeta}
            title="Профиль бота"
          >
            {botOptions.map((o) => (
              <option key={o.id} value={o.id} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadMeta()}
            className="h-9 px-3 rounded-xl border border-default bg-overlay-xs hover:bg-overlay-sm text-secondary text-sm font-semibold transition-colors"
            disabled={loadingMeta}
          >
            {loadingMeta ? '…' : 'Обновить'}
          </button>
        </div>
      </div>

      {metaError ? (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">{metaError}</div>
      ) : null}

      {selectedBotId && !selectedLkProfileId ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Для выбранного профиля бота не создан профиль ЛК.
        </div>
      ) : null}

      {lkProfileForBot ? (
        <div className="text-xs text-muted">
          Профиль ЛК: <span className="text-dim font-mono">{lkProfileForBot.name}</span>
          {String((lkProfileForBot as any)?.settings?.domain || '').trim() ? (
            <> · Домен: <span className="text-dim font-mono">{String((lkProfileForBot as any).settings.domain || '')}</span></>
          ) : null}
        </div>
      ) : null}

      {/* ─── Main chat layout ─── */}
      <div className="glass-panel p-0 overflow-hidden rounded-2xl border border-default">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr]" style={{ minHeight: '72vh' }}>

          {/* ── Conversations sidebar ── */}
          <div className="border-b lg:border-b-0 lg:border-r border-subtle flex flex-col">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-subtle">
              <div className="text-sm font-semibold text-secondary">
                Диалоги
                {conversations.length > 0 ? (
                  <span className="ml-2 text-xs text-muted font-normal">{conversations.length}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="h-9 px-3 rounded-lg border border-default bg-overlay-xs hover:bg-overlay-sm text-dim text-xs font-semibold transition-colors"
                onClick={() => void loadConversations(selectedLkProfileId)}
                disabled={!selectedLkProfileId || convosLoading}
              >
                {convosLoading ? '…' : 'Обновить'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {convosError ? (
                <div className="px-2 py-2 text-xs text-rose-300">{convosError}</div>
              ) : null}
              {conversations.length === 0 && !convosLoading ? (
                <div className="px-2 py-4 text-sm text-muted text-center">Нет диалогов</div>
              ) : null}
              {conversations.map((c) => {
                const tid = String((c as any)?.tg_id || '')
                const active = tid && tid === activeTgId
                const unread = Number((c as any)?.unread_count || 0)
                const lastMsg = String((c as any)?.last_message || '').trim()
                const lastAt = String((c as any)?.last_created_at || '').trim()
                const time = fmtTime(lastAt)
                return (
                  <button
                    key={tid}
                    type="button"
                    onClick={() => setActiveTgId(tid)}
                    className={[
                      'w-full text-left rounded-xl px-3 py-2.5 transition-colors flex items-start gap-3',
                      active ? 'bg-accent-15 border border-accent-25' : 'hover:bg-overlay-xs border border-transparent',
                    ].join(' ')}
                  >
                    {/* Avatar */}
                    <div className={[
                      'shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold mt-0.5',
                      active ? 'bg-accent-25 text-[var(--accent)]' : 'bg-overlay-sm text-muted',
                    ].join(' ')}>
                      {userInitial(tid)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <div className="text-sm font-semibold text-secondary truncate font-mono">{tid || '—'}</div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {unread > 0 ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-200 font-bold">
                              {unread}
                            </span>
                          ) : null}
                          {time ? <div className="text-[10px] text-faint font-mono">{time}</div> : null}
                        </div>
                      </div>
                      <div className="mt-0.5 text-xs text-muted truncate">{lastMsg || 'Нет сообщений'}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Chat panel ── */}
          <div className="flex flex-col" style={{ minHeight: '72vh' }}>
            {/* Chat header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-subtle shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {activeConversation ? (
                  <>
                    <div className="w-8 h-8 rounded-full bg-overlay-sm flex items-center justify-center text-sm font-bold text-dim shrink-0">
                      {userInitial(String((activeConversation as any)?.tg_id || ''))}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-secondary font-mono truncate">
                        {String((activeConversation as any)?.tg_id || '')}
                      </div>
                      {String((activeConversation as any)?.email || '').trim() ? (
                        <div className="text-[11px] text-muted truncate">{String((activeConversation as any).email || '')}</div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted">Выберите диалог</div>
                )}
              </div>
              <button
                type="button"
                className="h-9 px-3 rounded-lg border border-default bg-overlay-xs hover:bg-overlay-sm text-dim text-xs font-semibold transition-colors shrink-0"
                onClick={() => void loadMessages(selectedLkProfileId, activeTgId)}
                disabled={!selectedLkProfileId || !activeTgId || messagesLoading}
              >
                {messagesLoading ? '…' : 'Обновить'}
              </button>
            </div>

            {/* Messages */}
            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {messagesError ? (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-3">{messagesError}</div>
              ) : null}

              {!activeTgId ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-faint py-16">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-12 h-12">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                  </svg>
                  <div className="text-sm">Выберите диалог слева</div>
                </div>
              ) : activeTgId && messages.length === 0 && !messagesLoading ? (
                <div className="text-sm text-muted text-center py-8">Сообщений нет</div>
              ) : null}

              {grouped.map(({ day, messages: dayMsgs }) => (
                <div key={day}>
                  {day ? (
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-overlay-xs" />
                      <div className="text-[11px] text-faint font-medium px-2">{day}</div>
                      <div className="flex-1 h-px bg-overlay-xs" />
                    </div>
                  ) : null}

                  {dayMsgs.map((m) => {
                    const sender = String((m as any)?.sender || 'user')
                    const msgText = String((m as any)?.message || '')
                    const at = String((m as any)?.created_at || '')
                    const attachments = Array.isArray((m as any)?.attachments) ? ((m as any).attachments as any[]) : []
                    const attUrls = attachments.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
                    const isUser = sender === 'user'
                    const time = fmtTime(at)

                    return (
                      <div
                        key={String((m as any)?.id || '') + at}
                        className={['flex mb-2', isUser ? 'justify-start' : 'justify-end'].join(' ')}
                      >
                        {/* User avatar */}
                        {isUser ? (
                          <div className="shrink-0 w-7 h-7 rounded-full bg-overlay-sm border border-subtle flex items-center justify-center text-[11px] font-bold text-muted mr-2 mt-1">
                            {userInitial(activeTgId)}
                          </div>
                        ) : null}

                        <div className={['flex flex-col max-w-[72%]', isUser ? 'items-start' : 'items-end'].join(' ')}>
                          <div
                            className={[
                              'rounded-2xl px-4 py-2.5',
                              isUser
                                ? 'rounded-tl-sm bg-overlay-xs border border-default text-primary'
                                : 'rounded-tr-sm bg-accent-20 border border-accent-25 text-[var(--accent)]',
                            ].join(' ')}
                          >
                            {!isUser ? (
                              <div className="text-[10px] text-accent opacity-70 font-semibold mb-1 uppercase tracking-wider">Поддержка</div>
                            ) : null}
                            {msgText ? (
                              <div className="text-sm whitespace-pre-wrap leading-relaxed break-words">{msgText}</div>
                            ) : null}
                            {attUrls.length > 0 ? (
                              <div className={msgText ? 'mt-2.5' : ''}>
                                <div className={['grid gap-1.5', attUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'].join(' ')}>
                                  {attUrls.map((u) => (
                                    <button
                                      key={u}
                                      type="button"
                                      onClick={() => setLightboxUrl(u)}
                                      className="block rounded-xl overflow-hidden border border-default hover:opacity-90 transition-opacity text-left"
                                      title="Открыть"
                                    >
                                      <img src={u} alt="" className="w-full h-28 object-cover" loading="lazy" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {time ? (
                            <div className="mt-1 text-[10px] text-faint font-mono px-1">{time}</div>
                          ) : null}
                        </div>

                        {/* Admin avatar */}
                        {!isUser ? (
                          <div className="shrink-0 w-7 h-7 rounded-full bg-accent-20 border border-accent-20 flex items-center justify-center text-[11px] font-bold text-[var(--accent)] ml-2 mt-1">
                            А
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Composer */}
            <div className="border-t border-subtle p-3 shrink-0">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => void onPickFiles(e.target.files)}
              />

              {/* Upload previews */}
              {replyUploads.length > 0 ? (
                <div className="mb-2.5 flex flex-wrap gap-2">
                  {replyUploads.map((u) => (
                    <div key={u.id} className="relative w-14 h-14 rounded-xl overflow-hidden border border-default bg-overlay-xs">
                      <img src={u.url} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 border border-default text-primary hover:bg-black/85 flex items-center justify-center text-xs leading-none"
                        onClick={() => setReplyUploads((prev) => prev.filter((x) => x.id !== u.id))}
                        title="Убрать"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex items-end gap-2">
                {/* Attach */}
                <button
                  type="button"
                  className="shrink-0 w-9 h-9 rounded-full border border-default bg-overlay-xs hover:bg-overlay-sm text-muted hover:text-secondary transition-colors flex items-center justify-center disabled:opacity-40"
                  onClick={() => fileRef.current?.click()}
                  disabled={!activeTgId || !selectedLkProfileId || replying || uploading || replyUploads.length >= 6}
                  title="Прикрепить изображение"
                >
                  {uploading ? (
                    <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                  )}
                </button>

                {/* Textarea */}
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={onReplyKeyDown}
                  rows={1}
                  placeholder={activeTgId ? 'Ответ…' : 'Выберите диалог'}
                  className="flex-1 resize-none rounded-2xl border border-default bg-overlay-xs px-4 py-2.5 text-sm text-primary placeholder:text-faint focus:outline-none focus:border-strong transition-colors leading-relaxed disabled:opacity-50"
                  style={{ maxHeight: '100px', overflowY: 'auto' }}
                  disabled={!activeTgId || !selectedLkProfileId || replying || uploading}
                  onInput={(e) => {
                    const el = e.currentTarget
                    el.style.height = 'auto'
                    el.style.height = `${Math.min(el.scrollHeight, 100)}px`
                  }}
                />

                {/* Send */}
                <button
                  type="button"
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-40"
                  style={{
                    background: canSend ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                  onClick={() => void sendReply()}
                  disabled={!canSend}
                  title="Отправить"
                >
                  {replying ? (
                    <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin text-muted" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-secondary -rotate-45 translate-x-px">
                      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                    </svg>
                  )}
                </button>
              </div>

              {uploadError ? <div className="mt-2 text-xs text-rose-300">{uploadError}</div> : null}
              {replyError ? <div className="mt-2 text-xs text-rose-300">{replyError}</div> : null}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Lightbox ─── */}
      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-[99990] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxUrl('')}
          role="dialog"
          aria-modal="true"
        >
          <div className="max-w-[92vw] max-h-[86vh]" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxUrl} alt="" className="max-w-[92vw] max-h-[80vh] object-contain rounded-2xl border border-default" />
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                className="h-9 px-5 rounded-full border border-default bg-overlay-sm hover:bg-overlay-md text-primary text-sm font-semibold"
                onClick={() => setLightboxUrl('')}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
