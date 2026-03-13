import { useState } from "react"
import { apiFetch } from "../api/client"

type VersionInfo = {
  current_version: string
  latest_version: string | null
  update_available: boolean
  release_date?: string
  latest_release_date?: string | null
  error: string | null
}

type Status = "idle" | "loading" | "done" | "error"

function VersionCard({
  title,
  subtitle,
  icon,
  info,
  status,
  onCheck,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  info: VersionInfo | null
  status: Status
  onCheck: () => void
}) {
  const isUpToDate = info && !info.error && !info.update_available && info.latest_version
  const hasUpdate = info && !info.error && info.update_available
  const hasError = info?.error

  return (
    <div className="rounded-2xl border border-subtle bg-[var(--bg-card)] p-6 flex flex-col gap-5">
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

        {/* Status badge */}
        {status === "loading" ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-overlay-sm text-muted">Проверка...</span>
        ) : hasError ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#ef4444_12%,transparent)] text-rose-400">Ошибка</span>
        ) : hasUpdate ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#f59e0b_12%,transparent)] text-amber-400">Доступно обновление</span>
        ) : isUpToDate ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#22c55e_12%,transparent)] text-emerald-400">Актуально</span>
        ) : null}
      </div>

      {/* Versions */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-overlay-xs p-3">
          <div className="text-[10px] uppercase tracking-widest text-faint mb-1">Установлена</div>
          <div className="text-lg font-mono font-semibold text-primary">
            {info ? `v${info.current_version}` : "—"}
          </div>
          {info?.release_date && (
            <div className="text-xs text-muted mt-0.5">{info.release_date}</div>
          )}
        </div>
        <div className="rounded-xl bg-overlay-xs p-3">
          <div className="text-[10px] uppercase tracking-widest text-faint mb-1">Последняя</div>
          <div className={`text-lg font-mono font-semibold ${hasUpdate ? "text-amber-400" : "text-primary"}`}>
            {status === "loading" ? (
              <span className="text-muted text-sm">...</span>
            ) : info?.latest_version ? (
              `v${info.latest_version}`
            ) : (
              "—"
            )}
          </div>
          {info?.latest_release_date && (
            <div className="text-xs text-muted mt-0.5">{info.latest_release_date}</div>
          )}
        </div>
      </div>

      {/* Error */}
      {hasError && (
        <div className="text-xs text-rose-400 bg-[color-mix(in_srgb,#ef4444_8%,transparent)] rounded-lg px-3 py-2">
          {info.error}
        </div>
      )}

      {/* Button */}
      <button
        onClick={onCheck}
        disabled={status === "loading"}
        className="w-full py-2 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: "color-mix(in srgb, var(--accent) 14%, transparent)",
          color: "var(--accent)",
          border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
        }}
      >
        {status === "loading" ? "Проверяем..." : "Проверить обновления"}
      </button>
    </div>
  )
}

const PanelIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M9 21V9" />
  </svg>
)

const BotApiIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" />
    <line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)

export default function Updates() {
  const [panelInfo, setPanelInfo] = useState<VersionInfo | null>(null)
  const [panelStatus, setPanelStatus] = useState<Status>("idle")

  const [botApiInfo, setBotApiInfo] = useState<VersionInfo | null>(null)
  const [botApiStatus, setBotApiStatus] = useState<Status>("idle")

  const checkPanel = async () => {
    setPanelStatus("loading")
    try {
      const res = await apiFetch("/api/version/panel")
      const data = await res.json()
      setPanelInfo(data)
      setPanelStatus("done")
    } catch {
      setPanelInfo({ current_version: "0.0.0", latest_version: null, update_available: false, error: "Ошибка соединения" })
      setPanelStatus("error")
    }
  }

  const checkBotApi = async () => {
    setBotApiStatus("loading")
    try {
      const res = await apiFetch("/api/version/bot-api")
      const data = await res.json()
      setBotApiInfo(data)
      setBotApiStatus("done")
    } catch {
      setBotApiInfo({ current_version: "0.0.0", latest_version: null, update_available: false, error: "Ошибка соединения" })
      setBotApiStatus("error")
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-primary">Обновления</h1>
        <p className="text-sm text-muted mt-1">Проверка актуальности версий компонентов</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <VersionCard
          title="Панель управления"
          subtitle="Adminpanel + ЛК"
          icon={<PanelIcon />}
          info={panelInfo}
          status={panelStatus}
          onCheck={checkPanel}
        />
        <VersionCard
          title="API модуль бота"
          subtitle="Модуль интеграции"
          icon={<BotApiIcon />}
          info={botApiInfo}
          status={botApiStatus}
          onCheck={checkBotApi}
        />
      </div>
    </div>
  )
}
