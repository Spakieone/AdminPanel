import { useState, useEffect } from "react"
import { apiFetch } from "../api/client"

type VersionInfo = {
  current_version: string
  latest_version: string | null
  update_available: boolean
  release_date?: string
  latest_release_date?: string | null
  error: string | null
  update_url?: string
}

type Status = "idle" | "loading" | "done" | "error"


function VersionCard({
  title, subtitle, icon, info, status, onCheck, updateUrl,
}: {
  title: string; subtitle: string; icon: React.ReactNode
  info: VersionInfo | null; status: Status; onCheck: () => void; updateUrl?: string
}) {
  const isUpToDate = info && !info.error && !info.update_available && info.latest_version
  const hasUpdate = info && !info.error && info.update_available
  const hasError = info?.error

  const currentDisplay = info?.current_version && info.current_version !== "undefined"
    ? `v${info.current_version}`
    : "—"

  return (
    <div className="rounded-2xl border border-subtle bg-[var(--bg-card)] p-6 flex flex-col gap-4 min-h-[220px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] flex items-center justify-center text-[var(--accent)]">
            {icon}
          </div>
          <div>
            <div className="text-sm font-semibold text-primary">{title}</div>
            <div className="text-xs text-muted mt-0.5">{subtitle}</div>
          </div>
        </div>
        {status === "loading" ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-overlay-sm text-muted shrink-0">Проверка...</span>
        ) : hasError ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#ef4444_12%,transparent)] text-rose-400 shrink-0">Ошибка</span>
        ) : hasUpdate ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#f59e0b_12%,transparent)] text-amber-400 shrink-0">Есть обновление</span>
        ) : isUpToDate ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#22c55e_12%,transparent)] text-emerald-400 shrink-0">Актуально</span>
        ) : (
          <span className="text-xs px-2.5 py-1 rounded-full bg-overlay-sm text-muted shrink-0">Не проверено</span>
        )}
      </div>

      {/* Version blocks */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-overlay-xs p-3">
          <div className="text-[10px] uppercase tracking-widest text-faint mb-1">Установлена</div>
          <div className="text-lg font-mono font-semibold text-primary">
            {status === "loading" && !info ? <span className="text-muted text-sm">...</span> : currentDisplay}
          </div>
          {info?.release_date && <div className="text-xs text-muted mt-0.5">{info.release_date}</div>}
        </div>
        <div className="rounded-xl bg-overlay-xs p-3">
          <div className="text-[10px] uppercase tracking-widest text-faint mb-1">Последняя</div>
          <div className={`text-lg font-mono font-semibold ${hasUpdate ? "text-amber-400" : "text-primary"}`}>
            {status === "loading" ? <span className="text-muted text-sm">...</span> : info?.latest_version ? `v${info.latest_version}` : "—"}
          </div>
          {info?.latest_release_date && <div className="text-xs text-muted mt-0.5">{info.latest_release_date}</div>}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Main button — always at same level */}
      <button
        onClick={onCheck}
        disabled={status === "loading"}
        className="w-full py-2 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: "color-mix(in srgb, #3b82f6 14%, transparent)",
          color: "#60a5fa",
          border: "1px solid color-mix(in srgb, #3b82f6 30%, transparent)",
        }}
      >
        {status === "loading" ? "Проверяем..." : status === "done" ? "Обновить статус" : "Проверить обновления"}
      </button>

      {/* Extra actions below — placeholder keeps height consistent */}
      <div style={{ minHeight: 38 }} className="flex flex-col gap-2">
        {hasError && (
          <div className="text-xs text-rose-400 bg-[color-mix(in_srgb,#ef4444_8%,transparent)] rounded-lg px-3 py-2">{info.error}</div>
        )}
        {hasUpdate && updateUrl && (
          <a
            href={updateUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium text-amber-400 no-underline transition-opacity hover:opacity-80"
            style={{ background: "color-mix(in srgb, #f59e0b 10%, transparent)", border: "1px solid color-mix(in srgb, #f59e0b 25%, transparent)" }}
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Перейти к обновлению →
          </a>
        )}
      </div>
    </div>
  )
}

const UPDATE_CMD = "cd /root/adminpanel && git pull && docker compose up -d --build"

function ManualUpdateCard() {
  const [copied, setCopied] = useState(false)

  const copyCmd = () => {
    navigator.clipboard.writeText(UPDATE_CMD).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-2xl border border-subtle bg-[var(--bg-card)] p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] flex items-center justify-center text-[var(--accent)]">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-primary">Обновление панели</div>
          <div className="text-xs text-muted mt-0.5">Выполните команду на сервере через SSH</div>
        </div>
      </div>

      <div className="text-xs text-muted bg-overlay-xs rounded-xl px-3 py-2.5 leading-relaxed">
        Для обновления панели подключитесь к серверу по SSH и выполните команду ниже. Она загрузит последнюю версию с GitHub, пересоберёт образ и перезапустит контейнер.
      </div>

      {/* Command block */}
      <div className="relative group">
        <div
          className="rounded-xl px-4 py-3 font-mono text-sm text-emerald-400 select-all overflow-x-auto"
          style={{ background: "#0c0c0c", border: "1px solid #222" }}
        >
          <span className="text-white/30 mr-2 select-none">$</span>{UPDATE_CMD}
        </div>
        <button
          onClick={copyCmd}
          className="absolute top-2 right-2 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200"
          style={{
            background: copied
              ? "color-mix(in srgb, #22c55e 14%, transparent)"
              : "color-mix(in srgb, #3b82f6 14%, transparent)",
            color: copied ? "#4ade80" : "#60a5fa",
            border: `1px solid color-mix(in srgb, ${copied ? "#22c55e" : "#3b82f6"} 30%, transparent)`,
          }}
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
    </div>
  )
}

const PanelIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
  </svg>
)

const BotApiIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)

export default function Updates() {
  const [panelInfo, setPanelInfo] = useState<VersionInfo | null>(null)
  const [panelStatus, setPanelStatus] = useState<Status>("loading")
  const [botApiInfo, setBotApiInfo] = useState<VersionInfo | null>(null)
  const [botApiStatus, setBotApiStatus] = useState<Status>("loading")

  const checkPanel = async () => {
    setPanelStatus("loading")
    try {
      const res = await apiFetch("/api/version/panel")
      const data = await res.json()
      setPanelInfo(data)
      setPanelStatus(data.error ? "error" : "done")
    } catch {
      setPanelInfo({ current_version: "—", latest_version: null, update_available: false, error: "Ошибка соединения" })
      setPanelStatus("error")
    }
  }

  const checkBotApi = async () => {
    setBotApiStatus("loading")
    try {
      const res = await apiFetch("/api/version/bot-api")
      const data = await res.json()
      setBotApiInfo(data)
      setBotApiStatus(data.error ? "error" : "done")
    } catch {
      setBotApiInfo({ current_version: "—", latest_version: null, update_available: false, error: "Ошибка соединения" })
      setBotApiStatus("error")
    }
  }

  useEffect(() => {
    checkPanel()
    checkBotApi()
  }, [])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-primary">Обновления</h1>
        <p className="text-sm text-muted mt-1">Актуальность версий компонентов системы</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          <VersionCard
            title="Панель управления" subtitle="Adminpanel + ЛК"
            icon={<PanelIcon />} info={panelInfo} status={panelStatus} onCheck={checkPanel}
            updateUrl={panelInfo?.update_url}
          />
          <VersionCard
            title="API модуль бота" subtitle="Модуль интеграции"
            icon={<BotApiIcon />} info={botApiInfo} status={botApiStatus} onCheck={checkBotApi}
            updateUrl={botApiInfo?.update_url}
          />
        </div>
        <ManualUpdateCard />
      </div>
    </div>
  )
}
