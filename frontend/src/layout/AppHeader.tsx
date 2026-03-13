import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSidebar } from "../context/SidebarContext";
import StatusIndicators from "../components/StatusIndicators";
import { getAuthSessionInfo, logout } from "../api/client";
import ThemeSettingsPanel, { useThemeSettings } from "../components/common/ThemeSettingsPanel";

const SEARCH_PAGES = [
  { label: "Дашборд", path: "/" },
  { label: "Пользователи", path: "/users" },
  { label: "Ключи / Подписки", path: "/users-hub" },
  { label: "Платежи", path: "/payments" },
  { label: "Тарифы", path: "/tariffs" },
  { label: "Купоны", path: "/coupons" },
  { label: "Подарки", path: "/gifts" },
  { label: "Рефералы", path: "/referrals" },
  { label: "UTM / Источники", path: "/utm" },
  { label: "Рассылка", path: "/sender" },
  { label: "Маркетинг", path: "/marketing" },
  { label: "Поддержка", path: "/support" },
  { label: "Бот — Кассы", path: "/bot-settings?tab=cashboxes" },
  { label: "Бот — Деньги", path: "/bot-settings?tab=money" },
  { label: "Бот — Кнопки", path: "/bot-settings?tab=buttons" },
  { label: "Бот — Уведомления", path: "/bot-settings?tab=notifications" },
  { label: "Бот — Режимы", path: "/bot-settings?tab=modes" },
  { label: "Бот — Тарификация", path: "/bot-settings?tab=tariffs" },
  { label: "Remnawave — Ноды", path: "/remnawave" },
  { label: "Remnawave — Хосты", path: "/remnawave?tab=hosts" },
  { label: "Панель — Основное", path: "/panel?tab=main" },
  { label: "Панель — Мониторинг", path: "/panel?tab=monitoring" },
  { label: "Панель — Доступ", path: "/panel?tab=access" },
  { label: "Обновление", path: "/updates" },
];

interface AppHeaderProps {
  onNotificationsClick?: (anchorRect?: DOMRect | null) => void;
  unreadCount?: number;
}

const AppHeader: React.FC<AppHeaderProps> = ({ onNotificationsClick, unreadCount = 0 }) => {
  const [isApplicationMenuOpen, setApplicationMenuOpen] = useState(false);
  const { isMobileOpen, toggleSidebar, toggleMobileSidebar } = useSidebar();
  const theme = useThemeSettings();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getAuthSessionInfo()
      .then((info: any) => {
        if (cancelled) return;
        setUsername(String(info?.username || ""));
        setRole(String(info?.role || ""));
        setTotpEnabled(Boolean(info?.totp_enabled));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const doLogout = async () => {
    try { await logout(); } catch {} finally { navigate("/login"); }
  };

  const handleToggle = () => {
    if (window.innerWidth >= 991) {
      toggleSidebar();
    } else {
      toggleMobileSidebar();
    }
  };

  const toggleApplicationMenu = () => {
    setApplicationMenuOpen(!isApplicationMenuOpen);
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);

  const searchResults = searchQuery.trim().length > 0
    ? SEARCH_PAGES.filter(p => p.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  useEffect(() => { setSearchIdx(0); }, [searchQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      }
      if (event.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close search on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const goToResult = (path: string) => {
    navigate(path);
    setSearchOpen(false);
    setSearchQuery("");
  };

  const now = new Date();
  const formattedDate = now.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <header className="sticky top-0 z-[99999] w-full bg-base/80 backdrop-blur-xl border-b border-subtle">
      <div className="flex flex-col items-center justify-between flex-grow lg:flex-row lg:px-6">
        <div className="flex items-center justify-between w-full gap-2 px-3 py-3 border-b border-subtle sm:gap-4 lg:border-b-0 lg:px-0 lg:py-4">
          {/* Sidebar toggle */}
          <button
            className="flex items-center justify-center w-10 h-10 text-muted hover:text-secondary hover:bg-overlay-sm rounded-xl transition-all duration-200 z-[99999] lg:w-10 lg:h-10"
            onClick={handleToggle}
            aria-label="Toggle Sidebar"
          >
            {isMobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z" fill="currentColor" />
              </svg>
            ) : (
              <svg width="18" height="14" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z" fill="currentColor" />
              </svg>
            )}
          </button>

          {/* Mobile logo */}
          <Link to="/" className="lg:hidden">
            <span className="text-lg font-bold text-primary">Panel</span>
          </Link>

          {/* Mobile app menu toggle */}
          <button
            onClick={toggleApplicationMenu}
            className="flex items-center justify-center w-10 h-10 text-muted rounded-xl z-[99999] hover:bg-overlay-sm hover:text-secondary lg:hidden transition-all duration-200"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M5.99902 10.4951C6.82745 10.4951 7.49902 11.1667 7.49902 11.9951V12.0051C7.49902 12.8335 6.82745 13.5051 5.99902 13.5051C5.1706 13.5051 4.49902 12.8335 4.49902 12.0051V11.9951C4.49902 11.1667 5.1706 10.4951 5.99902 10.4951ZM17.999 10.4951C18.8275 10.4951 19.499 11.1667 19.499 11.9951V12.0051C19.499 12.8335 18.8275 13.5051 17.999 13.5051C17.1706 13.5051 16.499 12.8335 16.499 12.0051V11.9951C16.499 11.1667 17.1706 10.4951 17.999 10.4951ZM13.499 11.9951C13.499 11.1667 12.8275 10.4951 11.999 10.4951C11.1706 10.4951 10.499 11.1667 10.499 11.9951V12.0051C10.499 12.8335 11.1706 13.5051 11.999 13.5051C12.8275 13.5051 13.499 12.8335 13.499 12.0051V11.9951Z" fill="currentColor" />
            </svg>
          </button>

          {/* Desktop search */}
          <div className="hidden lg:block" ref={searchRef}>
            <div className="relative">
              <span className="absolute -translate-y-1/2 pointer-events-none left-4 top-1/2">
                <svg className="w-4 h-4 text-faint" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z" />
                </svg>
              </span>
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={e => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSearchIdx(i => Math.min(i + 1, searchResults.length - 1)); }
                  if (e.key === "ArrowUp")   { e.preventDefault(); setSearchIdx(i => Math.max(i - 1, 0)); }
                  if (e.key === "Enter" && searchResults[searchIdx]) goToResult(searchResults[searchIdx].path);
                  if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
                }}
                placeholder="Поиск по разделам..."
                className="h-10 w-full rounded-xl border border-default bg-overlay-xs py-2 pl-11 pr-14 text-sm text-primary placeholder:text-faint focus:border-accent-30 focus:outline-none focus:ring-1 focus:ring-accent-20 xl:w-[380px] transition-all duration-200"
              />
              <button type="button" className="absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-default bg-overlay-xs px-[7px] py-[4px] text-[10px] text-faint">
                <span>⌘</span><span>K</span>
              </button>
              {/* Dropdown */}
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-12 z-[99999] rounded-xl border border-default bg-[var(--bg-sidebar)] shadow-2xl overflow-hidden">
                  {searchResults.map((r, i) => (
                    <button
                      key={r.path}
                      type="button"
                      onMouseDown={() => goToResult(r.path)}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${i === searchIdx ? "bg-accent-10 text-[var(--accent)]" : "text-secondary hover:bg-overlay-sm"}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right side: actions */}
        <div
          className={`${
            isApplicationMenuOpen ? "flex" : "hidden"
          } items-center justify-between w-full gap-4 px-5 py-4 lg:flex lg:justify-end lg:px-0`}
        >
          <div className="flex items-center gap-2 2xsm:gap-3">
            {/* Date */}
            <span className="hidden lg:inline text-xs text-faint font-medium">{formattedDate}</span>

            {/* Status indicators */}
            <StatusIndicators />

            {/* Theme settings */}
            <button
              type="button"
              onClick={theme.toggle}
              className="relative flex items-center justify-center w-9 h-9 text-muted rounded-xl hover:bg-overlay-sm hover:text-secondary transition-all duration-200"
              title="Настройки темы"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </button>

            {/* Notifications */}
            <button
              data-notif-btn
              className="relative flex items-center justify-center w-9 h-9 text-muted rounded-xl hover:bg-overlay-sm hover:text-secondary transition-all duration-200"
              onClick={(e) => onNotificationsClick?.(e.currentTarget.getBoundingClientRect())}
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.5858 1.54248 9.25001 1.87827 9.25001 2.29248V2.83613C6.58985 3.20733 4.54169 5.50588 4.54169 8.27785V8.84843C4.54169 10.2653 4.0455 11.6381 3.13987 12.7265L2.87905 13.0393C2.5249 13.4649 2.40084 14.0389 2.54689 14.5759C2.69294 15.1128 3.08926 15.5437 3.61147 15.7368L6.04026 16.635C6.72166 17.6595 7.9211 18.3312 9.26543 18.4504C9.50879 18.4725 9.75476 18.4583 9.99808 18.4583C10.2436 18.4583 10.4898 18.4726 10.7338 18.4504C12.0785 18.3311 13.2783 17.659 13.9598 16.634L16.3886 15.7368C16.9108 15.5437 17.3071 15.1128 17.4531 14.5759C17.5992 14.0389 17.4751 13.4649 17.121 13.0393L16.8602 12.7265C15.9545 11.6381 15.4584 10.2653 15.4584 8.84843V8.27785C15.4584 5.50588 13.4102 3.20733 10.75 2.83613V2.29248Z" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-black">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>

          {/* User area */}
          <div className="relative flex items-center" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-overlay-sm transition-all duration-200"
            >
              <div className="hidden sm:block text-right">
                <p className="text-sm font-medium text-secondary">{username || "Admin"}</p>
                <p className="text-[11px] text-faint">{role || "Администратор"}</p>
              </div>
              <div className="flex items-center justify-center w-9 h-9 overflow-hidden rounded-xl bg-accent-10 shrink-0">
                <span className="text-[var(--accent)] font-bold text-sm">{(username || "A").slice(0, 1).toUpperCase()}</span>
              </div>
              <svg className={`w-3.5 h-3.5 text-faint transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>

            {/* Dropdown menu */}
            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-default bg-[var(--bg-sidebar)] shadow-2xl overflow-hidden z-[99999]">
                {/* Info block */}
                <div className="px-4 py-3.5 border-b border-default">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent-10 flex items-center justify-center shrink-0">
                      <span className="text-[var(--accent)] font-bold text-base">{(username || "A").slice(0, 1).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{username || "Admin"}</p>
                      <p className="text-[11px] text-faint mt-0.5">{role || "Администратор"}</p>
                    </div>
                  </div>
                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {totpEnabled ? (
                      <span className="px-2 py-0.5 rounded-md text-[11px] border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">2FA вкл</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md text-[11px] border border-amber-500/20 bg-amber-500/10 text-amber-400">2FA откл</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="py-1">
                  <Link
                    to="/profile"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-secondary hover:text-primary hover:bg-overlay-sm transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    Настройки профиля
                  </Link>
                </div>
                <div className="border-t border-default py-1">
                  <button
                    type="button"
                    onClick={() => { setUserMenuOpen(false); void doLogout(); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Выйти
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {theme.open && (
        <ThemeSettingsPanel onClose={theme.close} anchorRect={theme.anchorRect} />
      )}
    </header>
  );
};

export default AppHeader;
