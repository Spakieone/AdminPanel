import { useState, useEffect, useMemo, useCallback } from 'react'
import { getBotConfigAsync } from '../utils/botConfig'
import {
  getPartnerStats, getPartnersList,
  getBotPartnerWithdrawals, botApproveWithdrawal, botRejectWithdrawal, botResetPartnerMethods,
  type PartnerStats, type Partner, type WithdrawalItemBot,
} from '../api/botApi'
import CapybaraLoader from '../components/common/CapybaraLoader'

const C = 'rounded-2xl border border-default bg-overlay-xs p-4 sm:p-5 md:p-6'
const pillActive = 'rounded-full px-3 py-1.5 sm:py-1 text-xs font-medium border border-[var(--accent)] bg-accent-10 text-[var(--accent)] touch-manipulation'
const pill = 'rounded-full px-3 py-1.5 sm:py-1 text-xs font-medium border border-transparent text-muted bg-overlay-md touch-manipulation'
const paginationBtn = 'px-4 py-2.5 min-h-[44px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm border border-default bg-overlay-md text-primary hover:bg-overlay-md touch-manipulation active:opacity-70'

const fmtN = (n: number | undefined | null) => Number(n ?? 0).toLocaleString('ru-RU')
const fmtR = (n: number | undefined | null) =>
  `${Number(n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

const METHOD_LABELS: Record<string, string> = { card: '💳 Карта', usdt: '💎 USDT', ton: '💎 TON', sbp: '📱 СБП' }
const methodLabel = (m: string | null | undefined) => METHOD_LABELS[m ?? ''] ?? (m || '—')

function TgId({ id }: { id: number }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(String(id)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-sky-300 text-xs sm:text-sm">
      {String(id)}
      <button type="button" onClick={copy} className="text-muted hover:text-sky-300 transition-colors shrink-0" title="Скопировать">
        {copied
          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        }
      </button>
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  if (s === 'pending' || s.includes('wait') || s === 'new' || s === 'created')
    return <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">⏳ Ожидает</span>
  if (s === 'approved' || s === 'paid' || s === 'done' || s === 'success' || s === 'completed')
    return <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">✅ Одобрено</span>
  if (s === 'rejected' || s === 'declined' || s === 'cancelled')
    return <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-red-400/10 text-red-400 border border-red-400/20">❌ Отклонено</span>
  return <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-overlay-md text-muted border border-default">{status}</span>
}



type Tab = 'stats' | 'partners' | 'withdrawals' | 'completed'

export default function Partners() {
  const [loading, setLoading] = useState(true)
  const [hasModule, setHasModule] = useState(false)
  const [noProfile, setNoProfile] = useState(false)
  const [cfg, setCfg] = useState<any>(null)
  const [stats, setStats] = useState<PartnerStats | null>(null)
  const [partners, setPartners] = useState<Partner[]>([])
  const [tab, setTab] = useState<Tab>('stats')

  // Partners list
  const [sort, setSort] = useState<'invites' | 'balance'>('invites')
  const [search, setSearch] = useState('')
  const [partnerPage, setPartnerPage] = useState(1)
  const PAGE = 25

  // Withdrawals
  const [withdrawals, setWithdrawals] = useState<WithdrawalItemBot[]>([])
  const [wTotal, setWTotal] = useState(0)
  const [wPages, setWPages] = useState(1)
  const [wPage, setWPage] = useState(1)
  const [wLoading, setWLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [resetLoading, setResetLoading] = useState(false)

  useEffect(() => { void loadMain() }, [])

  const loadMain = async () => {
    setLoading(true)
    try {
      const config = await getBotConfigAsync()
      if (!config) { setNoProfile(true); setLoading(false); return }
      setCfg(config)
      const [st, list] = await Promise.all([
        getPartnerStats(config).catch(() => null),
        getPartnersList(config, 1000, 0).catch(() => null),
      ])
      if (!st || !(st as any).ok) { setHasModule(false) }
      else {
        setHasModule(true)
        setStats(st)
        setPartners(Array.isArray((list as any)?.items) ? (list as any).items : [])
      }
    } catch { setHasModule(false) }
    finally { setLoading(false) }
  }

  const loadWithdrawals = useCallback(async (status: 'pending' | 'completed', page: number) => {
    if (!cfg) return
    setWLoading(true)
    try {
      const data = await getBotPartnerWithdrawals(cfg, status, page, 25)
      setWithdrawals(data.items || [])
      setWTotal(data.total || 0)
      setWPages(data.pages || 1)
    } catch { setWithdrawals([]); setWTotal(0); setWPages(1) }
    finally { setWLoading(false) }
  }, [cfg])

  useEffect(() => {
    if (!cfg) return
    if (tab === 'withdrawals') void loadWithdrawals('pending', wPage)
    if (tab === 'completed') void loadWithdrawals('completed', wPage)
  }, [tab, wPage, cfg, loadWithdrawals])

  const showMsg = (text: string, ok: boolean) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000) }

  const handleApprove = async (id: number) => {
    if (!cfg) return
    setActionLoading(id)
    try {
      await botApproveWithdrawal(cfg, id)
      showMsg(`Заявка #${id} одобрена`, true)
      void loadWithdrawals('pending', wPage)
      getPartnerStats(cfg).then(s => s?.ok && setStats(s)).catch(() => {})
    } catch (e: any) { showMsg(e.message || 'Ошибка', false) }
    finally { setActionLoading(null) }
  }

  const handleReject = async (id: number) => {
    if (!cfg) return
    setActionLoading(id)
    try {
      const r = await botRejectWithdrawal(cfg, id)
      showMsg(`Заявка #${id} отклонена, возвращено ${fmtR(r.refunded)}`, true)
      void loadWithdrawals('pending', wPage)
      getPartnerStats(cfg).then(s => s?.ok && setStats(s)).catch(() => {})
    } catch (e: any) { showMsg(e.message || 'Ошибка', false) }
    finally { setActionLoading(null) }
  }

  const handleResetMethods = async () => {
    if (!cfg) return
    setResetLoading(true)
    try {
      const r = await botResetPartnerMethods(cfg)
      showMsg(`Сброшено методов: ${r.reset_count}`, true)
    } catch (e: any) { showMsg(e.message || 'Ошибка', false) }
    finally { setResetLoading(false) }
  }

  const sortedPartners = useMemo(() => {
    const filtered = search
      ? partners.filter(p => String(p.tg_id).includes(search) || String(p.code || '').toLowerCase().includes(search.toLowerCase()))
      : [...partners]
    return filtered.sort((a, b) =>
      sort === 'balance' ? Number(b.balance || 0) - Number(a.balance || 0) : Number(b.referred_count || 0) - Number(a.referred_count || 0)
    )
  }, [partners, sort, search])

  const pagedPartners = useMemo(() => sortedPartners.slice((partnerPage - 1) * PAGE, partnerPage * PAGE), [sortedPartners, partnerPage])
  const partnerPages = Math.max(1, Math.ceil(sortedPartners.length / PAGE))

  if (loading) return <div className="p-4 sm:p-6"><CapybaraLoader /></div>

  if (noProfile) return (
    <div className="p-4 sm:p-6"><div className={C}><div className="flex flex-col items-center py-10 gap-3">
      <span className="text-4xl">⚙️</span>
      <p className="text-lg font-semibold text-primary">Нет активного профиля</p>
      <p className="text-sm text-muted text-center">Создайте профиль бота в настройках панели.</p>
    </div></div></div>
  )

  if (!hasModule) return (
    <div className="p-4 sm:p-6"><div className={C}><div className="flex flex-col items-center py-14 gap-4">
      <span className="text-5xl">🤝</span>
      <p className="text-xl font-semibold text-primary text-center">Требуется модуль «Партнёрская программа»</p>
      <p className="text-sm text-muted text-center max-w-md">
        Модуль партнёрской программы не установлен или недоступен.
      </p>
    </div></div></div>
  )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'stats', label: '📊 Статистика' },
    { key: 'partners', label: `👥 Партнёры (${fmtN(partners.length)})` },
    { key: 'withdrawals', label: `📥 Заявки${stats?.pending_withdrawals_count ? ` (${stats.pending_withdrawals_count})` : ''}` },
    { key: 'completed', label: '✅ Завершённые' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-primary">Партнёрская программа</h1>
          <p className="text-xs sm:text-sm text-muted mt-0.5">Управление партнёрами и выплатами</p>
        </div>
        <button
          type="button"
          className={`${pill} hover:border-orange-400/50 hover:text-orange-400 transition-colors self-start sm:self-auto`}
          onClick={handleResetMethods}
          disabled={resetLoading}
        >
          {resetLoading ? '⏳ Сброс...' : '🔄 Сбросить методы'}
        </button>
      </div>

      {/* Message */}
      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between gap-3 ${msg.ok ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400' : 'border-red-400/30 bg-red-400/10 text-red-400'}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button key={t.key} type="button" className={tab === t.key ? pillActive : pill} onClick={() => { setTab(t.key); setWPage(1) }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== STATS ===== */}
      {tab === 'stats' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">
          {/* Card: Партнёры */}
          <div className="rounded-2xl border border-default bg-overlay-xs p-4 sm:p-5 md:p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-10 h-10 bg-overlay-md rounded-xl shrink-0 text-2xl">🤝</div>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-semibold text-muted">Партнёры</span>
                <span className="text-2xl font-bold text-primary font-mono">{fmtN(stats?.total_partners)}</span>
              </div>
            </div>
            <div className="pt-3 border-t border-default space-y-0.5">
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">Привлечено всего</span><span className="text-sm font-mono font-medium text-[var(--accent)]">{fmtN(stats?.total_referred)}</span></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">Суммарный баланс</span><span className="text-sm font-mono font-medium text-emerald-400">{fmtR(stats?.total_balance)}</span></div>
            </div>
          </div>

          {/* Card: Привлечено */}
          <div className="rounded-2xl border border-default bg-overlay-xs p-4 sm:p-5 md:p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-10 h-10 bg-overlay-md rounded-xl shrink-0 text-2xl">👥</div>
              <span className="text-base font-semibold text-muted">Привлечено</span>
            </div>
            <div className="pt-3 border-t border-default space-y-0.5">
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">🗓️ Сегодня</span><span className="text-sm font-mono font-medium text-[var(--accent)]">+{fmtN(stats?.referred_today)}</span></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">🗓️ Вчера</span><span className="text-sm font-mono font-medium text-primary">+{fmtN(stats?.referred_yesterday)}</span></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">📆 За неделю</span><span className="text-sm font-mono font-medium text-primary">+{fmtN(stats?.referred_week)}</span></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">📅 За месяц</span><span className="text-sm font-mono font-medium text-primary">+{fmtN(stats?.referred_month)}</span></div>
            </div>
          </div>

          {/* Card: Выплаты */}
          <div className="rounded-2xl border border-default bg-overlay-xs p-4 sm:p-5 md:p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-10 h-10 bg-overlay-md rounded-xl shrink-0 text-2xl">💸</div>
              <span className="text-base font-semibold text-muted">Выплаты</span>
            </div>
            <div className="pt-3 border-t border-default space-y-0.5">
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">📅 Сегодня</span><span className="text-sm font-mono font-medium text-[var(--accent)]">{fmtR(stats?.paid_today_amount)}</span></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">📆 За месяц</span><span className="text-sm font-mono font-medium text-emerald-400">{fmtR(stats?.paid_month_amount)}</span></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">✅ Всего</span><span className="text-sm font-mono font-medium text-primary">{fmtR(stats?.paid_total_amount)}</span></div>
              <div className="pt-2 mt-1 border-t border-default">
                <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">⏳ Ожидают</span><span className="text-sm font-mono font-bold text-yellow-400">{fmtR(stats?.pending_withdrawals_amount)}</span></div>
                <div className="flex items-center justify-between py-1"><span className="text-sm text-muted">📋 Заявок</span><span className="text-sm font-mono font-bold text-yellow-400">{fmtN(stats?.pending_withdrawals_count)}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== PARTNERS ===== */}
      {tab === 'partners' && (
        <div className={C}>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
            <span className="text-sm text-muted">Всего: <span className="text-primary font-mono">{fmtN(sortedPartners.length)}</span></span>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                placeholder="ID или реф. код..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPartnerPage(1) }}
                className="rounded-lg border border-default bg-overlay-sm text-sm text-primary px-3 py-2 sm:py-1.5 outline-none focus:border-[var(--accent)] w-full sm:w-44"
              />
              <button type="button" className={sort === 'invites' ? pillActive : pill} onClick={() => { setSort('invites'); setPartnerPage(1) }}>Приглашения</button>
              <button type="button" className={sort === 'balance' ? pillActive : pill} onClick={() => { setSort('balance'); setPartnerPage(1) }}>Баланс</button>
            </div>
          </div>

          {/* Pagination top */}
          {partnerPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mb-3">
              <div className="text-muted text-xs sm:text-sm">
                Показано {sortedPartners.length === 0 ? 0 : (partnerPage - 1) * PAGE + 1}–{Math.min(partnerPage * PAGE, sortedPartners.length)} из {fmtN(sortedPartners.length)}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPartnerPage(p => Math.max(1, p - 1))} disabled={partnerPage <= 1} className={paginationBtn}>Назад</button>
                <button onClick={() => setPartnerPage(p => Math.min(partnerPages, p + 1))} disabled={partnerPage >= partnerPages} className={paginationBtn}>Вперед</button>
              </div>
            </div>
          )}

          {/* Table — desktop */}
          <div className="hidden sm:block">
            {pagedPartners.length === 0 ? (
              <div className="glass-table p-2"><p className="text-muted text-center py-6 text-sm">Нет данных</p></div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Telegram ID</th>
                      <th>Реф. код</th>
                      <th>%</th>
                      <th>Метод</th>
                      <th>Приглашено</th>
                      <th>Баланс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPartners.map((p, idx) => (
                      <tr key={p.tg_id}>
                        <td className="text-muted">{(partnerPage - 1) * PAGE + idx + 1}</td>
                        <td><TgId id={p.tg_id} /></td>
                        <td className="font-mono text-muted">{p.code || '—'}</td>
                        <td>{p.percent != null ? (
                          <span className="font-mono text-primary">
                            {p.percent}%
                            {!p.percent_custom && <span className="text-muted text-xs ml-1">(дефолт)</span>}
                          </span>
                        ) : '—'}</td>
                        <td>{methodLabel(p.method)}</td>
                        <td className="font-mono text-primary">{fmtN(p.referred_count)}</td>
                        <td className="table-amount">{fmtR(p.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Cards — mobile */}
          <div className="sm:hidden space-y-2">
            {pagedPartners.length === 0 ? (
              <p className="text-muted text-center py-6 text-sm">Нет данных</p>
            ) : pagedPartners.map((p, idx) => (
              <div key={p.tg_id} className="rounded-xl border border-default bg-overlay-xs p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">#{(partnerPage - 1) * PAGE + idx + 1}</span>
                  <TgId id={p.tg_id} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Приглашено</span>
                  <span className="font-mono text-sm text-primary font-medium">{fmtN(p.referred_count)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Баланс</span>
                  <span className="font-mono text-sm text-emerald-400 font-medium">{fmtR(p.balance)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">%</span>
                  <span className="font-mono text-sm text-primary">{p.percent != null ? `${p.percent}%` : '—'}</span>
                </div>
                {(p.code || p.method) && (
                  <div className="flex items-center justify-between text-xs text-muted pt-1 border-t border-default">
                    <span>{p.code || '—'}</span>
                    <span>{methodLabel(p.method)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination bottom */}
          {partnerPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mt-3">
              <div className="text-muted text-xs sm:text-sm">
                Показано {sortedPartners.length === 0 ? 0 : (partnerPage - 1) * PAGE + 1}–{Math.min(partnerPage * PAGE, sortedPartners.length)} из {fmtN(sortedPartners.length)}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPartnerPage(p => Math.max(1, p - 1))} disabled={partnerPage <= 1} className={paginationBtn}>Назад</button>
                <button onClick={() => setPartnerPage(p => Math.min(partnerPages, p + 1))} disabled={partnerPage >= partnerPages} className={paginationBtn}>Вперед</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== WITHDRAWALS (pending) ===== */}
      {tab === 'withdrawals' && (
        <div className={C}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm sm:text-base font-semibold text-primary">📥 Заявки на вывод</h2>
            <span className="text-sm text-muted">Всего: <span className="text-primary font-mono">{wTotal}</span></span>
          </div>
          {wLoading ? <CapybaraLoader /> : (
            <>
              {/* Pagination top */}
              {wPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mb-3">
                  <div className="text-muted text-xs sm:text-sm">Страница {wPage} из {wPages}</div>
                  <div className="flex gap-2">
                    <button onClick={() => setWPage(p => Math.max(1, p - 1))} disabled={wPage <= 1} className={paginationBtn}>Назад</button>
                    <button onClick={() => setWPage(p => Math.min(wPages, p + 1))} disabled={wPage >= wPages} className={paginationBtn}>Вперед</button>
                  </div>
                </div>
              )}

              {withdrawals.length === 0 ? (
                <div className="glass-table p-2"><p className="text-muted text-center py-6 text-sm">Нет заявок на вывод</p></div>
              ) : (
                <>
                  {/* Table — desktop */}
                  <div className="hidden sm:block table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Telegram ID</th>
                          <th>Сумма</th>
                          <th>Метод</th>
                          <th>Реквизиты</th>
                          <th>Дата</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {withdrawals.map(w => (
                          <tr key={w.id}>
                            <td className="text-muted font-mono">#{w.id}</td>
                            <td><TgId id={w.tg_id} /></td>
                            <td className="table-amount">{fmtR(w.amount)}</td>
                            <td>{methodLabel(w.method)}</td>
                            <td className="font-mono text-muted max-w-[180px] truncate">{w.destination || '—'}</td>
                            <td className="text-muted">{fmtDate(w.created_at)}</td>
                            <td>
                              <div className="flex gap-2">
                                <button type="button" disabled={actionLoading === w.id} onClick={() => handleApprove(w.id)}
                                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-emerald-400/30 bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20 transition-colors disabled:opacity-50">
                                  {actionLoading === w.id ? '⏳' : '✅ Одобрить'}
                                </button>
                                <button type="button" disabled={actionLoading === w.id} onClick={() => handleReject(w.id)}
                                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-red-400/30 bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-colors disabled:opacity-50">
                                  {actionLoading === w.id ? '⏳' : '❌ Отклонить'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Cards — mobile */}
                  <div className="sm:hidden space-y-2">
                    {withdrawals.map(w => (
                      <div key={w.id} className="rounded-xl border border-default bg-overlay-xs p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted font-mono">#{w.id}</span>
                          <span className="text-xs text-muted">{fmtDate(w.created_at)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <TgId id={w.tg_id} />
                          <span className="font-mono text-emerald-400 font-bold text-base">{fmtR(w.amount)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted">
                          <span>{methodLabel(w.method)}</span>
                          {w.destination && <span className="font-mono truncate max-w-[160px]">{w.destination}</span>}
                        </div>
                        <div className="flex gap-2 pt-1 border-t border-default">
                          <button type="button" disabled={actionLoading === w.id} onClick={() => handleApprove(w.id)}
                            className="flex-1 py-2 rounded-lg text-xs font-medium border border-emerald-400/30 bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20 transition-colors disabled:opacity-50 touch-manipulation">
                            {actionLoading === w.id ? '⏳' : '✅ Одобрить'}
                          </button>
                          <button type="button" disabled={actionLoading === w.id} onClick={() => handleReject(w.id)}
                            className="flex-1 py-2 rounded-lg text-xs font-medium border border-red-400/30 bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-colors disabled:opacity-50 touch-manipulation">
                            {actionLoading === w.id ? '⏳' : '❌ Отклонить'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Pagination bottom */}
              {wPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mt-3">
                  <div className="text-muted text-xs sm:text-sm">Страница {wPage} из {wPages}</div>
                  <div className="flex gap-2">
                    <button onClick={() => setWPage(p => Math.max(1, p - 1))} disabled={wPage <= 1} className={paginationBtn}>Назад</button>
                    <button onClick={() => setWPage(p => Math.min(wPages, p + 1))} disabled={wPage >= wPages} className={paginationBtn}>Вперед</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== COMPLETED ===== */}
      {tab === 'completed' && (
        <div className={C}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm sm:text-base font-semibold text-primary">✅ Завершённые выплаты</h2>
            <span className="text-sm text-muted">Всего: <span className="text-primary font-mono">{wTotal}</span></span>
          </div>
          {wLoading ? <CapybaraLoader /> : (
            <>
              {/* Pagination top */}
              {wPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mb-3">
                  <div className="text-muted text-xs sm:text-sm">Страница {wPage} из {wPages}</div>
                  <div className="flex gap-2">
                    <button onClick={() => setWPage(p => Math.max(1, p - 1))} disabled={wPage <= 1} className={paginationBtn}>Назад</button>
                    <button onClick={() => setWPage(p => Math.min(wPages, p + 1))} disabled={wPage >= wPages} className={paginationBtn}>Вперед</button>
                  </div>
                </div>
              )}

              {withdrawals.length === 0 ? (
                <div className="glass-table p-2"><p className="text-muted text-center py-6 text-sm">Нет завершённых выплат</p></div>
              ) : (
                <>
                  {/* Table — desktop */}
                  <div className="hidden sm:block table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Telegram ID</th>
                          <th>Сумма</th>
                          <th>Метод</th>
                          <th>Реквизиты</th>
                          <th>Статус</th>
                          <th>Дата</th>
                        </tr>
                      </thead>
                      <tbody>
                        {withdrawals.map(w => (
                          <tr key={w.id}>
                            <td className="text-muted font-mono">#{w.id}</td>
                            <td><TgId id={w.tg_id} /></td>
                            <td className="table-amount">{fmtR(w.amount)}</td>
                            <td>{methodLabel(w.method)}</td>
                            <td className="font-mono text-muted max-w-[160px] truncate">{w.destination || '—'}</td>
                            <td><StatusBadge status={w.status} /></td>
                            <td className="text-muted">{fmtDate(w.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Cards — mobile */}
                  <div className="sm:hidden space-y-2">
                    {withdrawals.map(w => (
                      <div key={w.id} className="rounded-xl border border-default bg-overlay-xs p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted font-mono">#{w.id}</span>
                          <StatusBadge status={w.status} />
                        </div>
                        <div className="flex items-center justify-between">
                          <TgId id={w.tg_id} />
                          <span className="font-mono text-emerald-400 font-bold">{fmtR(w.amount)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted">
                          <span>{methodLabel(w.method)}</span>
                          <span>{fmtDate(w.created_at)}</span>
                        </div>
                        {w.destination && <p className="text-xs font-mono text-muted truncate">{w.destination}</p>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Pagination bottom */}
              {wPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 sm:gap-0 mt-3">
                  <div className="text-muted text-xs sm:text-sm">Страница {wPage} из {wPages}</div>
                  <div className="flex gap-2">
                    <button onClick={() => setWPage(p => Math.max(1, p - 1))} disabled={wPage <= 1} className={paginationBtn}>Назад</button>
                    <button onClick={() => setWPage(p => Math.min(wPages, p + 1))} disabled={wPage >= wPages} className={paginationBtn}>Вперед</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
