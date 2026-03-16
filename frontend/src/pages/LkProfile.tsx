import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, Mail, Send, Link2, Wallet, MessageCircle, Newspaper, FileText } from "lucide-react";
import LkLayout from "@/components/lk/LkLayout";
import LkLoader from "@/components/lk/LkLoader";

interface Me {
  authenticated: boolean;
  email: string | null;
  tg_id: number | null;
  shadow_tg_id: number | null;
  telegram_tg_id: number | null;
  csrf_token: string | null;
  balance_rub: number;
}

interface Payment {
  id: string;
  created_at: string;
  amount: number;
  currency: string;
  status: string;
  description: string | null;
}

const statusLabel: Record<string, string> = {
  paid: "Оплачен",
  pending: "В обработке",
  failed: "Ошибка",
  refunded: "Возврат",
};
const statusColor: Record<string, string> = {
  paid: "text-emerald-400",
  pending: "text-amber-400",
  failed: "text-rose-400",
  refunded: "text-white/40",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

export default function LkProfile() {
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [botUsername, setBotUsername] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [newsUrl, setNewsUrl] = useState("");
  const [termsUrl, setTermsUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    const loadAll = async () => {
      const [meRes, paymentsRes, metaRes, settingsRes] = await Promise.all([
        fetch("/api/lk/me", { credentials: "include" }),
        fetch("/api/lk/payments/history", { credentials: "include" }),
        fetch("/api/lk/auth/telegram/meta", { credentials: "include" }),
        fetch("/api/lk/public/settings", { credentials: "include" }),
      ]);
      if (meRes.status === 401) { navigate("/", { replace: true }); return; }

      const [meData, paymentsData, metaData, settingsData] = await Promise.all([
        meRes.json(), paymentsRes.json(), metaRes.json().catch(() => ({})), settingsRes.json().catch(() => ({})),
      ]);
      setMe(meData);
      setPayments(paymentsData.items ?? []);
      if (metaData?.ok) setBotUsername(metaData.bot_username || "");
      if (settingsData?.ok) {
        setSupportUrl(settingsData.support_url || "");
        setNewsUrl(settingsData.news_url || "");
        setTermsUrl(settingsData.terms_url || "");
        if (settingsData.brand_title) { document.title = settingsData.brand_title; try { localStorage.setItem('lk_brand_title', settingsData.brand_title); } catch(_){} }
      }
    };
    loadAll().finally(() => setLoading(false));
  }, [navigate]);

  // Embed Telegram Login Widget and handle callback for linking
  useEffect(() => {
    // @ts-expect-error Telegram Login Widget callback
    window.__tg_link_callback = async (tgUser: Record<string, unknown>) => {
      // tgUser has: id, first_name, last_name, username, photo_url, auth_date, hash
      // Encode as base64url JSON (tgAuthResult format)
      const json = JSON.stringify(tgUser);
      const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      setLinking(true);
      setLinkError(null);
      try {
        const csrf = me?.csrf_token || "";
        const r = await fetch("/api/lk/auth/telegram/link", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ tgAuthResult: b64 }),
        });
        const d = await r.json();
        if (!r.ok) { setLinkError(d.detail || "Ошибка привязки"); return; }
        // Reload /me
        const mr = await fetch("/api/lk/me", { credentials: "include" });
        if (mr.ok) setMe(await mr.json());
      } catch {
        setLinkError("Ошибка соединения");
      } finally {
        setLinking(false);
      }
    };
    return () => { delete (window as any).__tg_link_callback; };
  }, [me?.csrf_token]);

  const handleLinkTelegram = () => {
    if (!botUsername) return;
    // Dynamically add Telegram Login Widget
    const container = document.getElementById("tg-link-container");
    if (!container) return;
    container.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "__tg_link_callback(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    container.appendChild(script);
  };

  if (loading) {
    return (
      <LkLayout>
        <LkLoader />
      </LkLayout>
    );
  }

  return (
    <LkLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Профиль</h1>

        {/* Account info */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
          {me?.email && (
            <div className="flex items-center gap-3 p-4">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <Mail size={14} className="text-white/50" />
              </div>
              <div>
                <div className="text-xs text-white/40">Email</div>
                <div className="text-sm text-white">{me.email}</div>
              </div>
            </div>
          )}
          {me?.telegram_tg_id && (
            <div className="flex items-center gap-3 p-4">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <Send size={14} className="text-white/50" />
              </div>
              <div>
                <div className="text-xs text-white/40">Telegram ID</div>
                <div className="text-sm text-white">{me.telegram_tg_id}</div>
              </div>
            </div>
          )}
          {me != null && (
            <div className="flex items-center gap-3 p-4">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <Wallet size={14} className="text-white/50" />
              </div>
              <div>
                <div className="text-xs text-white/40">Баланс</div>
                <div className="text-sm font-semibold text-emerald-400">{me.balance_rub ?? 0} ₽</div>
              </div>
            </div>
          )}
          {!me?.email && !me?.tg_id && (
            <div className="flex items-center gap-3 p-4">
              <User size={14} className="text-white/50" />
              <div className="text-sm text-white/40">Нет данных аккаунта</div>
            </div>
          )}
        </div>

        {/* Link Telegram */}
        {me && !me.telegram_tg_id && botUsername && (
          <div className="space-y-2">
            <button
              onClick={handleLinkTelegram}
              disabled={linking}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] p-4 text-sm text-white/60 hover:text-white transition-colors disabled:opacity-50"
            >
              <Link2 size={15} />
              {linking ? "Привязка…" : "Привязать Telegram"}
            </button>
            <div id="tg-link-container" className="flex justify-center" />
            {linkError && <div className="text-xs text-rose-400 text-center">{linkError}</div>}
          </div>
        )}

        {/* Service links */}
        {(supportUrl || newsUrl || termsUrl) && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
            {newsUrl && (
              <a href={newsUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 text-sm text-white/70 hover:text-white hover:bg-white/[0.03] transition-colors">
                <Newspaper size={16} className="shrink-0 text-white/40" />
                Новости нашего сервиса
              </a>
            )}
            {supportUrl && (
              <a href={supportUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 text-sm text-white/70 hover:text-white hover:bg-white/[0.03] transition-colors">
                <MessageCircle size={16} className="shrink-0 text-white/40" />
                Техническая поддержка
              </a>
            )}
            {termsUrl && (
              <a href={termsUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 text-sm text-white/70 hover:text-white hover:bg-white/[0.03] transition-colors">
                <FileText size={16} className="shrink-0 text-white/40" />
                Правила и условия сервиса
              </a>
            )}
          </div>
        )}

        {/* Payment history */}
        <div>
          <h2 className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">История платежей</h2>
          {payments.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/30">
              Платежей пока нет
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
              {payments.slice(0, 20).map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="text-sm text-white truncate">{p.description || "Платёж"}</div>
                    <div className="text-xs text-white/30 mt-0.5">{formatDate(p.created_at)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-white">{p.amount} {p.currency}</div>
                    <div className={`text-xs ${statusColor[p.status] || "text-white/40"}`}>
                      {statusLabel[p.status] || p.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </LkLayout>
  );
}
