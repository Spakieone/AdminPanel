import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, useSidebar } from "../context/SidebarContext";
import AppHeader from "./AppHeader";
import Backdrop from "./Backdrop";
import AppSidebar from "./AppSidebar";
import ToastContainer from "../components/common/ToastContainer";
import { useToast } from "../hooks/useToast";
import { ToastProvider } from "../contexts/ToastContext";
import { useNotifications } from "../hooks/useNotifications";
import NotificationsToasts from "../components/notifications/NotificationsToasts";
import NotificationsPanel from "../components/notifications/NotificationsPanel";
import { NotificationsProvider } from "../contexts/NotificationsContext";
import { trackPanelAuditEvent } from "../api/client";

const LayoutContent: React.FC = () => {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();
  const [showNotifications, setShowNotifications] = useState(false);
  const location = useLocation();
  const lastAuditPathRef = useRef<string>("");
  const toast = useToast();
  const toastApi = useMemo(
    () => ({
      showToast: toast.showToast,
      showSuccess: toast.showSuccess,
      showError: toast.showError,
      showWarning: toast.showWarning,
      showInfo: toast.showInfo,
      removeToast: toast.removeToast,
    }),
    [toast.showToast, toast.showSuccess, toast.showError, toast.showWarning, toast.showInfo, toast.removeToast],
  );
  const notif = useNotifications();
  const [notifAnchorRect, setNotifAnchorRect] = useState<{
    top: number; left: number; right: number; bottom: number; width: number; height: number;
  } | null>(null);

  useEffect(() => {
    if (!notif.enabled) setShowNotifications(false);
  }, [notif.enabled]);

  useEffect(() => {
    const key = `${location.pathname || ""}${location.search || ""}`;
    if (!key || lastAuditPathRef.current === key) return;
    lastAuditPathRef.current = key;
    void trackPanelAuditEvent({
      action: "ui.page_view",
      meta: { path: location.pathname, search: location.search || "" },
    }).catch(() => {});
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!notif.enabled || (notif.toasts.length === 0 && !showNotifications)) {
      setNotifAnchorRect(null);
      return;
    }
    const compute = () => {
      try {
        const buttons = Array.from(
          document.querySelectorAll("[data-notif-btn]"),
        ) as HTMLButtonElement[];
        const visible = buttons.find((b) => b && b.getClientRects().length > 0);
        if (!visible) return;
        const r = visible.getBoundingClientRect();
        setNotifAnchorRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      } catch {}
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [notif.enabled, notif.toasts.length, showNotifications]);

  return (
    <ToastProvider value={toastApi}>
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <NotificationsProvider value={notif}>
        <div className="min-h-screen bg-base xl:flex">
          <div>
            <AppSidebar />
            <Backdrop />
          </div>
          <div
            className={`flex-1 transition-all duration-300 ease-in-out ${
              isExpanded || isHovered ? "lg:ml-[260px]" : "lg:ml-[70px]"
            } ${isMobileOpen ? "ml-0" : ""}`}
          >
            <AppHeader
              onNotificationsClick={(rect) => {
                if (!notif.enabled) return;
                if (rect) {
                  setNotifAnchorRect({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
                }
                setShowNotifications(true);
              }}
              unreadCount={notif.enabled ? notif.unreadCount : 0}
            />
            <div className="p-4 mx-auto max-w-screen-2xl md:p-6">
              <Outlet />
            </div>
          </div>
        </div>

        {notif.enabled ? (
          <NotificationsToasts
            items={notif.toasts}
            onDismiss={(id) => notif.dismissToast(id)}
            onOpenPanel={() => setShowNotifications(true)}
          />
        ) : null}

        {notif.enabled && showNotifications && (
          <NotificationsPanel
            onClose={() => setShowNotifications(false)}
            notifications={notif.notifications}
            readIds={notif.readIds}
            unreadCount={notif.unreadCount}
            loading={notif.loading}
            onMarkRead={(id) => notif.markAsRead(id)}
            onMarkAllRead={() => notif.markAllAsRead()}
            onClearAll={() => notif.clearAll()}
            anchorRect={notifAnchorRect}
          />
        )}
      </NotificationsProvider>
    </ToastProvider>
  );
};

const AppLayout: React.FC = () => {
  return (
    <SidebarProvider>
      <LayoutContent />
    </SidebarProvider>
  );
};

export default AppLayout;
