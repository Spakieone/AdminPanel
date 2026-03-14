import { useState, useEffect, useRef } from "react"
import { apiFetch, getAuthHeaders } from "../api/client"

type VersionInfo = {
  current_version: string
  latest_version: string | null
  update_available: boolean
  release_date?: string
  latest_release_date?: string | null
  error: string | null
}

type Status = "idle" | "loading" | "done" | "error"

type UpdateStatus = {
  running: boolean
  last_triggered_by?: string
  last_started_at?: number
  last_finished_at?: number
  last_exit_code?: number | null
}

// Угадываем прогресс по строкам лога
function guessProgress(log: string[]): number {
  if (log.length === 0) return 0
  const text = log.join("\n").toLowerCase()
  if (text.includes("перезапуск") || text.includes("restart") || text.includes("docker compose up")) return 90
  if (text.includes("docker compose build") || text.includes("building")) return 70
  if (text.includes("git pull") || text.includes("clone") || text.includes("загрузк")) return 50
  if (text.includes("бэкап") || text.includes("backup") || text.includes("резервн")) return 30
  if (text.includes("начало") || text.includes("start") || text.includes("запуск")) return 10
  return Math.min(5 + log.length * 2, 85)
}

function ProgressBar({ pct, running }: { pct: number; running: boolean }) {
  return (
    <div style={{
      width: "100%",
      height: 32,
      background: "#000",
      border: "3px solid #fff",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        width: `${pct}%`,
        height: "100%",
        background: "#fff",
        position: "absolute",
        top: 0,
        left: 0,
        transition: running ? "width 0.8s ease" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingRight: pct > 10 ? 8 : 0,
      }} />
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        fontWeight: "bold",
        fontSize: "0.9rem",
        color: pct > 50 ? "#000" : "#fff",
        mixBlendMode: "difference",
        pointerEvents: "none",
        userSelect: "none",
      }}>
        {pct}%
      </div>
    </div>
  )
}

function UpdatePanel() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const failCountRef = useRef(0)

  const fetchStatus = async () => {
    try {
      const res = await apiFetch("/api/github-update/status")
      const data = await res.json()
      if (data.ok) {
        failCountRef.current = 0
        setRestarting(false)
        setUpdateStatus(data.status)
        const isRunning = !!data.status?.running
        setRunning(isRunning)
        if (!isRunning && data.status?.last_exit_code === 0) setProgress(100)
      }
    } catch {
      failCountRef.current += 1
      if (failCountRef.current >= 2) {
        // Контейнер перезапускается
        setRestarting(true)
        setProgress(95)
      }
    }
  }

  const fetchLog = async () => {
    try {
      const res = await apiFetch("/api/github-update/log?lines=300")
      const data = await res.json()
      if (data.ok) {
        const lines: string[] = data.lines || []
        setLog(lines)
        if (running) setProgress(guessProgress(lines))
      }
    } catch {}
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  useEffect(() => {
    if (running || restarting) {
      setShowLog(true)
      setProgress(p => p < 5 ? 5 : p)
      if (running) fetchLog()
      pollRef.current = setInterval(async () => {
        await fetchStatus()
        if (running) await fetchLog()
      }, 2000)
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      if (showLog) fetchLog()
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [running, restarting])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  const startUpdate = async () => {
    setError(null)
    setLog([])
    setProgress(5)
    try {
      const headers = await getAuthHeaders()
      const res = await apiFetch("/api/github-update/run", { method: "POST", headers })
      const data = await res.json()
      if (data.started) {
        setRunning(true)
        setShowLog(true)
      } else {
        setError(data.detail || "Не удалось запустить обновление")
        setProgress(0)
      }
    } catch {
      setError("Ошибка соединения. Проверьте права доступа (нужна роль super_admin).")
      setProgress(0)
    }
  }

  const lastSuccess = updateStatus && !updateStatus.running && updateStatus.last_exit_code === 0 && updateStatus.last_finished_at
  const lastFail = updateStatus && !updateStatus.running && updateStatus.last_exit_code != null && updateStatus.last_exit_code !== 0 && updateStatus.last_finished_at
  const showProgress = running || (lastSuccess && progress > 0) || (lastFail && progress > 0)

  return (
    <div className="rounded-2xl border border-subtle bg-[var(--bg-card)] p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] flex items-center justify-center text-[var(--accent)]">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-primary">Обновление панели</div>
            <div className="text-xs text-muted mt-0.5">Загрузка и установка с GitHub</div>
          </div>
        </div>
        {restarting ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#f59e0b_12%,transparent)] text-amber-400 shrink-0 animate-pulse">Перезапуск...</span>
        ) : running ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#3b82f6_12%,transparent)] text-blue-400 shrink-0 animate-pulse">Выполняется...</span>
        ) : lastSuccess ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#22c55e_12%,transparent)] text-emerald-400 shrink-0">Успешно</span>
        ) : lastFail ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,#ef4444_12%,transparent)] text-rose-400 shrink-0">Ошибка</span>
        ) : null}
      </div>

      <div className="text-xs text-muted bg-overlay-xs rounded-xl px-3 py-2.5 leading-relaxed">
        Обновление загружает последнюю версию с GitHub, создаёт резервную копию данных и перезапускает контейнер.
      </div>

      {/* Progress bar */}
      {showProgress && (
        <ProgressBar pct={lastSuccess ? 100 : progress} running={running} />
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-rose-400 bg-[color-mix(in_srgb,#ef4444_8%,transparent)] rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={startUpdate}
          disabled={running}
          className="flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "color-mix(in srgb, #22c55e 14%, transparent)",
            color: "#22c55e",
            border: "1px solid color-mix(in srgb, #22c55e 30%, transparent)",
          }}
        >
          {running ? "Обновляется..." : "Обновить сейчас"}
        </button>
        {log.length > 0 && (
          <button
            onClick={() => setShowLog(v => !v)}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200"
            style={{
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              color: "var(--accent)",
              border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
            }}
          >
            {showLog ? "Скрыть лог" : "Лог"}
          </button>
        )}
      </div>

      {/* Log */}
      {showLog && log.length > 0 && (
        <div
          ref={logRef}
          className="rounded-xl overflow-y-auto"
          style={{ maxHeight: 600, background: "#0c0c0c", border: "1px solid #222", fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
        >
          {/* Lines */}
          <div style={{ padding: "10px 0" }}>
            {log.map((line, i) => {
              // Parse timestamp
              const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s*(.*)$/)
              const ts = tsMatch ? tsMatch[1].slice(11) : "" // only HH:MM:SS
              const text = tsMatch ? tsMatch[2] : line

              const tlo = text.toLowerCase()

              // Classify
              const isError = tlo.includes("error") || tlo.includes("ошибк") || tlo.includes("failed") || tlo.includes("fatal")
              const isWarn = !isError && (tlo.includes("warn") || tlo.includes("deprecated") || tlo.includes("level=warning"))
              const isSuccess = !isError && (
                /[✓✔]/.test(text) || tlo.includes("успешн") || tlo.includes("обновлён") ||
                tlo.includes("образ собран") || tlo.includes("код обновлён") ||
                (tlo.includes("built in") && /\d+\.\d+s/.test(tlo)) ||
                tlo.includes("successfully built") || tlo.includes("successfully tagged")
              )
              const isStep = !isError && tlo.includes("step ") && /\d+\/\d+/.test(tlo)
              const isArrow = text.trimStart().startsWith("--->") || text.trimStart().startsWith("==>")
              const isCmd = text.trimStart().startsWith("$")
              const isSection = !isError && !isCmd && (
                tlo.includes("загрузка обновлений") || tlo.includes("сборка docker") ||
                tlo.includes("перезапуск") || tlo.includes("update started by") ||
                tlo.includes("project dir")
              )
              const isNpmAsset = /dist[/-]/.test(text) && /\d+\.\d+ k[bB]/.test(text)
              const isSendingContext = tlo.includes("sending build context")
              const isGitHash = /^[a-f0-9]{7,40}$/.test(text.trim()) || text.startsWith("HEAD is now at")
              const isEmpty = text.trim() === ""

              if (isEmpty) return <div key={i} style={{ height: 6 }} />

              const textColor = isError ? "#f87171"
                : isWarn ? "#fbbf24"
                : isSuccess ? "#4ade80"
                : isSection ? "#c084fc"
                : isStep ? "#60a5fa"
                : isCmd ? "#cbd5e1"
                : isArrow ? "#566577"
                : isNpmAsset || isSendingContext ? "#566577"
                : isGitHash ? "#7a8fa6"
                : "#6ee7b7"

              const lineNum = String(i + 1).padStart(4, " ")

              // Highlight sizes in sending context lines and npm asset lines
              const renderText = () => {
                const raw = isCmd ? text.trimStart().replace(/^\$\s*/, "") : text
                if (isSendingContext || isNpmAsset) {
                  // Highlight numbers with units
                  const parts = raw.split(/(\d+(?:\.\d+)?\s*(?:MB|KB|kB|B|kb|mb)\b)/)
                  return parts.map((p, j) =>
                    /\d/.test(p) && /MB|KB|kB|B|kb|mb/.test(p)
                      ? <span key={j} style={{ color: "#94a3b8" }}>{p}</span>
                      : <span key={j}>{p}</span>
                  )
                }
                return raw
              }

              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 0,
                    opacity: isNpmAsset || isSendingContext ? 0.5 : isArrow ? 0.6 : 1,
                    background: isError ? "rgba(239,68,68,0.07)" : isWarn ? "rgba(251,191,36,0.04)" : isSuccess && !isNpmAsset ? "rgba(74,222,128,0.03)" : "transparent",
                  }}
                >
                  {/* Line number */}
                  <span style={{ color: "#3a3a3a", fontSize: 11, padding: "0 10px 0 14px", flexShrink: 0, userSelect: "none", minWidth: 48, textAlign: "right" }}>
                    {lineNum}
                  </span>
                  {/* Timestamp */}
                  <span style={{ color: "#4a5568", fontSize: 11, flexShrink: 0, minWidth: 62, paddingRight: 10 }}>
                    {ts}
                  </span>
                  {/* Content */}
                  <span style={{ color: textColor, fontSize: 12, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1, paddingRight: 14 }}>
                    {isCmd && <span style={{ color: "#4b5563" }}>$ </span>}
                    {renderText()}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function VersionCard({
  title, subtitle, icon, info, status, onCheck, updateUrl,
}: {
  title: string; subtitle: string; icon: React.ReactNode
  info: VersionInfo | null; status: Status; onCheck: () => void; updateUrl?: string
}) {
  const isUpToDate = info && !info.error && !info.update_available && info.latest_version
  const hasUpdate = info && !info.error && info.update_available
  const hasError = info?.error

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
            {status === "loading" && !info ? <span className="text-muted text-sm">...</span> : info ? `v${info.current_version}` : "—"}
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
          background: "color-mix(in srgb, var(--accent) 14%, transparent)",
          color: "var(--accent)",
          border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
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
            updateUrl="https://github.com/Spakieone/AdminPanel/releases/latest"
          />
          <VersionCard
            title="API модуль бота" subtitle="Модуль интеграции"
            icon={<BotApiIcon />} info={botApiInfo} status={botApiStatus} onCheck={checkBotApi}
            updateUrl="https://pocomacho.ru/solonetbot/modules/AdminPanel"
          />
        </div>
        <UpdatePanel />
      </div>
    </div>
  )
}
