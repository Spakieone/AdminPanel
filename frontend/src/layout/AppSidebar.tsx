import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSidebar } from "../context/SidebarContext";
import { getUiSettings } from "../api/client";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: { name: string; path: string }[];
};

/* ---- Icons (inline SVG, 20x20) ---- */
const DashIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const UsersIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const ChatIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const CreditCardIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);
const TagIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);
const MegaphoneIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10" /><path d="M12 19l9-4" /><path d="M12 19l-9-4" /><path d="M12 15v4" />
  </svg>
);
const BotIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
  </svg>
);
const SettingsIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const ActivityIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const UpdatesIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

/* ---- Nav config ---- */
const navItems: NavItem[] = [
  { icon: <DashIcon />, name: "Дашборд", path: "/" },
  {
    icon: <UsersIcon />,
    name: "Пользователи",
    subItems: [
      { name: "Пользователи", path: "/users" },
      { name: "Подписки", path: "/subscriptions" },
    ],
  },
  { icon: <ChatIcon />, name: "Чат поддержки", path: "/support-chat" },
  { icon: <CreditCardIcon />, name: "Платежи", path: "/payments" },
  { icon: <TagIcon />, name: "Тарифы", path: "/tariffs" },
  {
    icon: <MegaphoneIcon />,
    name: "Маркетинг",
    subItems: [
      { name: "UTM-метки", path: "/utm" },
      { name: "Купоны", path: "/coupons" },
      { name: "Рефералы", path: "/referrals" },
      { name: "Партнёрка", path: "/partners" },
      { name: "Подарки", path: "/gifts" },
      { name: "Рассылка", path: "/sender" },
    ],
  },
];

const othersItems: NavItem[] = [
  {
    icon: <BotIcon />,
    name: "Бот",
    subItems: [
      { name: "Обзор", path: "/bot?tab=overview" },
      { name: "Логи бота", path: "/bot?tab=logs" },
    ],
  },
  {
    icon: <SettingsIcon />,
    name: "Настройки бота",
    subItems: [
      { name: "Кассы", path: "/bot-settings?tab=cashboxes" },
      { name: "Деньги", path: "/bot-settings?tab=money" },
      { name: "Кнопки", path: "/bot-settings?tab=buttons" },
      { name: "Уведомления", path: "/bot-settings?tab=notifications" },
      { name: "Режимы", path: "/bot-settings?tab=modes" },
      { name: "Тарификация", path: "/bot-settings?tab=tariffs" },
      { name: "Серверы", path: "/bot-settings?tab=servers" },
    ],
  },
  {
    icon: <ActivityIcon />,
    name: "Remnawave",
    subItems: [
      { name: "Ноды", path: "/remnawave/nodes" },
      { name: "Хосты", path: "/remnawave/hosts" },
      { name: "Пользователи", path: "/remnawave/users" },
    ],
  },
  {
    icon: <UpdatesIcon />,
    name: "Обновления",
    path: "/updates",
  },
  {
    icon: <SettingsIcon />,
    name: "Панель",
    path: "/panel",
  },
];

/* ---- Helpers ---- */
function checkActive(path: string, loc: { pathname: string; search: string }) {
  try {
    const url = new URL(path, "http://x");
    const toPath = url.pathname;
    if (toPath === "/") return loc.pathname === "/";
    // Exact match or prefix match with boundary (next char must be "/" or end)
    if (loc.pathname !== toPath) {
      if (!loc.pathname.startsWith(toPath)) return false;
      const nextChar = loc.pathname[toPath.length];
      if (nextChar && nextChar !== "/") return false;
    }
    const toParams = url.searchParams;
    if ([...toParams].length > 0) {
      const curParams = new URLSearchParams(loc.search);
      for (const [key, val] of toParams) {
        if (curParams.get(key) !== val) return false;
      }
    }
    return true;
  } catch {
    return loc.pathname === path;
  }
}

/* ---- Component ---- */
const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered, toggleMobileSidebar } = useSidebar();
  const location = useLocation();
  const [panelTitle, setPanelTitle] = useState("Panel");
  const expanded = isExpanded || isHovered || isMobileOpen;

  // Auto-close mobile sidebar on navigation
  const prevPath = useRef(location.pathname + location.search);
  useEffect(() => {
    const cur = location.pathname + location.search;
    if (prevPath.current !== cur && isMobileOpen) {
      toggleMobileSidebar();
    }
    prevPath.current = cur;
  }, [location.pathname, location.search]);

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>({});
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    getUiSettings().then((s) => {
      if (cancelled) return;
      const title = String((s as any)?.brandTitle || "").trim();
      if (title) setPanelTitle(title);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const isActive = useCallback(
    (path: string) => checkActive(path, location),
    [location.pathname, location.search]
  );

  useEffect(() => {
    let submenuMatched = false;
    (["main", "others"] as const).forEach((menuType) => {
      const items = menuType === "main" ? navItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (isActive(subItem.path)) {
              setOpenSubmenu({ type: menuType, index });
              submenuMatched = true;
            }
          });
        }
      });
    });
    if (!submenuMatched) setOpenSubmenu(null);
  }, [location, isActive]);

  useEffect(() => {
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prev) => ({
          ...prev,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prev) => {
      if (prev && prev.type === menuType && prev.index === index) return null;
      return { type: menuType, index };
    });
  };

  const isSubActive = (nav: NavItem) => {
    if (!nav.subItems) return false;
    return nav.subItems.some((sub) => isActive(sub.path));
  };

  const renderMenuItems = (items: NavItem[], menuType: "main" | "others") => (
    <ul className="flex flex-col gap-1">
      {items.map((nav, index) => {
        const active = nav.path ? isActive(nav.path) : isSubActive(nav);
        const isOpen = openSubmenu?.type === menuType && openSubmenu?.index === index;

        return (
          <li key={nav.name}>
            {nav.subItems ? (
              <button
                onClick={() => handleSubmenuToggle(index, menuType)}
                className={`group flex items-center w-full rounded-xl transition-all duration-200 cursor-pointer ${
                  expanded ? "gap-3 px-3 py-2.5" : "justify-center px-0 py-2.5"
                } ${
                  active
                    ? ""
                    : isOpen
                      ? "bg-overlay-sm text-secondary"
                      : "text-muted hover:bg-overlay-sm hover:text-secondary"
                }`}
                style={active ? { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' } : undefined}
                title={!expanded ? nav.name : undefined}
              >
                <span className={`shrink-0 ${expanded ? "" : "mx-auto"}`}>
                  {nav.icon}
                </span>
                {expanded && (
                  <>
                    {active ? (
                      <span className="text-sm font-medium truncate">{nav.name}</span>
                    ) : (
                      <span className="text-sm font-medium truncate">{nav.name}</span>
                    )}
                    <svg
                      className={`ml-auto w-4 h-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M4.79175 7.396L10.0001 12.6043L15.2084 7.396" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </>
                )}
              </button>
            ) : (
              nav.path && (
                <Link
                  to={nav.path}
                  className={`group flex items-center rounded-xl transition-all duration-200 ${
                    expanded ? "gap-3 px-3 py-2.5" : "justify-center px-0 py-2.5"
                  } ${
                    active
                      ? ""
                      : "text-muted hover:bg-overlay-sm hover:text-secondary"
                  }`}
                  style={active ? { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' } : undefined}
                  title={!expanded ? nav.name : undefined}
                >
                  <span className={`shrink-0 ${expanded ? "" : "mx-auto"}`}>
                    {nav.icon}
                  </span>
                  {expanded && (
                    <span className="text-sm font-medium truncate">{nav.name}</span>
                  )}
                </Link>
              )
            )}

            {/* Submenu */}
            {nav.subItems && expanded && (
              <div
                ref={(el) => { subMenuRefs.current[`${menuType}-${index}`] = el; }}
                className="overflow-hidden transition-all duration-300"
                style={{
                  height: isOpen ? `${subMenuHeight[`${menuType}-${index}`]}px` : "0px",
                }}
              >
                <ul className="mt-1 space-y-0.5 ml-8">
                  {nav.subItems.map((subItem) => (
                    <li key={subItem.name}>
                      <Link
                        to={subItem.path}
                        className={`block px-3 py-1.5 text-sm transition-all duration-200 rounded-lg ${isActive(subItem.path) ? '' : 'text-muted hover:text-dim hover:bg-overlay-xs'}`}
                        style={isActive(subItem.path) ? { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' } : undefined}
                      >
                        {subItem.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside
      className={`fixed top-0 left-0 h-screen z-50 flex flex-col bg-[var(--bg-sidebar)] border-r border-subtle transition-all duration-300 ease-in-out
        ${expanded ? "w-[260px]" : "w-[70px]"}
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Logo */}
      <div className={`py-6 px-4 flex ${expanded ? "justify-start" : "justify-center"}`}>
        <Link to="/" className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--accent)] text-black font-bold text-sm shrink-0">
            {panelTitle.slice(0, 1).toUpperCase()}
          </div>
          {expanded && (
            <span className="text-lg font-semibold text-primary truncate">{panelTitle}</span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar px-3">
        <nav className="flex flex-col gap-6">
          {/* Main menu */}
          <div>
            {expanded && (
              <h2 className="mb-3 px-3 text-[10px] uppercase tracking-widest text-faint font-semibold">
                Меню
              </h2>
            )}
            {!expanded && (
              <div className="mb-3 flex justify-center">
                <div className="w-6 h-px bg-overlay-md" />
              </div>
            )}
            {renderMenuItems(navItems, "main")}
          </div>

          {/* System menu */}
          <div>
            {expanded && (
              <h2 className="mb-3 px-3 text-[10px] uppercase tracking-widest text-faint font-semibold">
                Система
              </h2>
            )}
            {!expanded && (
              <div className="mb-3 flex justify-center">
                <div className="w-6 h-px bg-overlay-md" />
              </div>
            )}
            {renderMenuItems(othersItems, "others")}
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;
