import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Wifi, WifiOff, Clock, Key, RefreshCw, Send, Package, X } from "lucide-react";
import LkLayout from "@/components/lk/LkLayout";
import LkLoader from "@/components/lk/LkLoader";

interface Subscription {
  id: string;
  title: string;
  status: "active" | "paused" | "expired";
  expires_at: string | null;
  expires_at_ms: number | null;
  server_name: string | null;
  plan_name: string | null;
  subscription_url: string | null;
  traffic_used_gb: number | null;
  traffic_limit_gb: number | null;
  device_limit: number | null;
  email: string | null;
}

interface Profile {
  name: string | null;
  email: string | null;
  tg_id: number | null;
  telegram_tg_id: number | null;
  balance_rub: number;
}

interface AddonOption {
  gb?: number;
  devices?: number;
  price_rub: number;
}

interface AddonsInfo {
  available: boolean;
  balance_rub: number;
  current_traffic_gb: number | null;
  current_devices: number | null;
  traffic_options: AddonOption[];
  device_options: AddonOption[];
}

function timeLeft(ms: number | null): string | null {
  if (!ms) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} дн.`);
  if (hours > 0) parts.push(`${hours} ч.`);
  if (days === 0) parts.push(`${minutes} мин.`);
  return parts.join(" ");
}

function TrafficBar({ used, limit }: { used: number | null; limit: number | null }) {
  if (limit == null) return null;
  const pct = used != null ? Math.min(100, (used / limit) * 100) : 0;
  const color = pct > 80 ? "bg-rose-400" : pct > 50 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-white/50">Трафик</span>
        <span className="text-white">{used != null ? used.toFixed(1) : "0"} / {limit} ГБ</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface Provider {
  key: string;
  title: string;
  mode: "link" | "init";
  url?: string;
  currency: string;
}

function AddonsModal({ sub, onClose, onSuccess }: { sub: Subscription; onClose: () => void; onSuccess: () => void }) {
  const [addons, setAddons] = useState<AddonsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [csrf, setCsrf] = useState("");
  const [selectedTrafficGb, setSelectedTrafficGb] = useState<number | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Payment step
  const [step, setStep] = useState<"select" | "payment">("select");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [requiredAmount, setRequiredAmount] = useState(0);
  const [paying, setPaying] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/lk/subscriptions/${encodeURIComponent(sub.id)}/addons`, { credentials: "include" }).then(r => r.json()),
      fetch("/api/lk/me", { credentials: "include" }).then(r => r.json()),
    ]).then(([addonsData, meData]) => {
      setAddons(addonsData);
      setCsrf(meData.csrf_token || "");
    }).finally(() => setLoading(false));
  }, [sub.id]);

  const selectedTrafficPrice = addons?.traffic_options.find(o => o.gb === selectedTrafficGb)?.price_rub ?? 0;
  const selectedDevicesPrice = addons?.device_options.find(o => o.devices === selectedDevices)?.price_rub ?? 0;
  const totalPrice = selectedTrafficPrice + selectedDevicesPrice;

  const apply = async () => {
    if (totalPrice <= 0) return;
    setApplying(true);
    setError(null);
    try {
      const r = await fetch(`/api/lk/subscriptions/${encodeURIComponent(sub.id)}/addons`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          sub_id: sub.id,
          traffic_gb: selectedTrafficGb,
          device_limit: selectedDevices,
        }),
      });
      const data = await r.json();
      if (data.ok) {
        onSuccess();
        onClose();
      } else if (data.code === "insufficient_funds") {
        // Not enough balance — load providers and go to payment step
        const provRes = await fetch("/api/lk/payments/providers", { credentials: "include" });
        const provData = await provRes.json();
        const items: Provider[] = provData.items ?? [];
        setProviders(items);
        if (items.length > 0) setSelectedProvider(items[0].key);
        setRequiredAmount(data.required_amount);
        setStep("payment");
      } else {
        setError(data.detail || "Ошибка применения пакета");
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setApplying(false);
    }
  };

  const handlePay = async () => {
    setPaying(true);
    setError(null);
    try {
      const prov = providers.find(p => p.key === selectedProvider);
      if (prov?.mode === "link" && prov.url) {
        setPaymentUrl(prov.url);
        return;
      }
      const r = await fetch("/api/lk/payments/init", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ provider: selectedProvider, amount: requiredAmount }),
      });
      const data = await r.json();
      if (data.payment_url) {
        setPaymentUrl(data.payment_url);
      } else {
        setError(data.detail || "Ошибка создания платежа");
      }
    } catch {
      setError("Ошибка соединения");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative isolate w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 space-y-5 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="text-white font-semibold text-base">📦 Докупить</div>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <LkLoader text="Загрузка..." compact />
        ) : !addons?.available ? (
          <div className="text-white/50 text-sm text-center py-4">Расширение недоступно для этой подписки</div>
        ) : step === "payment" ? (
          <>
            {/* Payment step */}
            <div className="rounded-xl bg-white/5 divide-y divide-white/5">
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-white/50">Ваш баланс</span>
                <span className="text-white font-medium">{addons.balance_rub} ₽</span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-white/50">Не хватает</span>
                <span className="text-rose-400 font-semibold">{requiredAmount.toFixed(2)} ₽</span>
              </div>
            </div>

            {paying ? (
              <LkLoader text="Формируется ссылка..." compact />
            ) : paymentUrl ? (
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-xl bg-white text-black text-sm font-semibold py-3 hover:bg-white/90 transition-all flex items-center justify-center"
              >
                Перейти к оплате →
              </a>
            ) : (
              <>
                {providers.length === 0 ? (
                  <div className="text-sm text-white/40 text-center py-4">Способы оплаты недоступны</div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs text-white/40 uppercase tracking-widest font-semibold">Способ оплаты</div>
                    {providers.map(p => (
                      <button
                        key={p.key}
                        onClick={() => setSelectedProvider(p.key)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                          selectedProvider === p.key
                            ? "border-white/40 bg-white/[0.06]"
                            : "border-white/10 bg-white/[0.03] hover:border-white/20"
                        }`}
                      >
                        <span className="text-sm text-white font-medium">{p.title}</span>
                        <span className="text-xs text-white/40">{p.currency}</span>
                      </button>
                    ))}
                  </div>
                )}
                {error && (
                  <div className="text-rose-400 text-xs text-center bg-rose-500/10 rounded-xl px-3 py-2">{error}</div>
                )}
                {providers.length > 0 && (
                  <button
                    onClick={handlePay}
                    disabled={!selectedProvider}
                    className="w-full rounded-xl bg-white text-black text-sm font-semibold py-3 hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    Оплатить {requiredAmount.toFixed(2)} ₽
                  </button>
                )}
                <button
                  onClick={() => { setStep("select"); setError(null); }}
                  className="w-full text-xs text-white/30 hover:text-white/60 transition-colors py-1"
                >
                  ← Назад
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {/* Balance */}
            <div className="flex items-center justify-between text-xs bg-white/5 rounded-xl px-4 py-2.5">
              <span className="text-white/60">Ваш баланс</span>
              <span className="text-emerald-400 font-semibold">{addons.balance_rub} ₽</span>
            </div>

            {/* Traffic options */}
            {addons.traffic_options.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-white">
                  📶 Доп. трафик
                  {addons.current_traffic_gb != null && (
                    <span className="ml-1.5 font-normal text-white/40">сейчас {addons.current_traffic_gb} ГБ</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {addons.traffic_options.map(opt => (
                    <button
                      key={opt.gb}
                      onClick={() => setSelectedTrafficGb(selectedTrafficGb === opt.gb ? null : (opt.gb ?? null))}
                      className={`rounded-xl border px-3 py-3 text-sm font-medium transition-all flex flex-col items-center gap-1 ${
                        selectedTrafficGb === opt.gb
                          ? "border-emerald-500 bg-emerald-500/10 text-white"
                          : "border-white/10 bg-white/5 text-white hover:border-white/20"
                      }`}
                    >
                      <span className="font-bold">+{opt.gb} ГБ</span>
                      <span className={selectedTrafficGb === opt.gb ? "text-emerald-300 text-xs" : "text-white/50 text-xs"}>{opt.price_rub} ₽</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Device options */}
            {addons.device_options.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-white">
                  📱 Доп. устройства
                  {addons.current_devices != null && (
                    <span className="ml-1.5 font-normal text-white/40">сейчас {addons.current_devices}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {addons.device_options.map(opt => (
                    <button
                      key={opt.devices}
                      onClick={() => setSelectedDevices(selectedDevices === opt.devices ? null : (opt.devices ?? null))}
                      className={`rounded-xl border px-3 py-3 text-sm font-medium transition-all flex flex-col items-center gap-1 ${
                        selectedDevices === opt.devices
                          ? "border-sky-500 bg-sky-500/10 text-white"
                          : "border-white/10 bg-white/5 text-white hover:border-white/20"
                      }`}
                    >
                      <span className="font-bold">+{opt.devices} уст.</span>
                      <span className={selectedDevices === opt.devices ? "text-sky-300 text-xs" : "text-white/50 text-xs"}>{opt.price_rub} ₽</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="text-rose-400 text-xs text-center bg-rose-500/10 rounded-xl px-3 py-2">{error}</div>
            )}

            {/* Confirm */}
            <button
              onClick={apply}
              disabled={totalPrice <= 0 || applying}
              className="w-full rounded-xl py-3 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-700 hover:bg-emerald-600 active:scale-[0.98] text-white"
            >
              {applying ? "Проверяется баланс..." : totalPrice > 0 ? `Оплатить ${totalPrice} ₽` : "Выберите пакет"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SubCard({ sub, onRenew, onRefresh }: { sub: Subscription; onRenew: () => void; onRefresh: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showAddons, setShowAddons] = useState(false);
  const left = timeLeft(sub.expires_at_ms);

  const copyUrl = () => {
    if (!sub.subscription_url) return;
    navigator.clipboard.writeText(sub.subscription_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openSub = () => {
    if (sub.subscription_url) window.open(sub.subscription_url, "_blank");
  };

  const emailUsername = sub.email ? sub.email.split("@")[0] : null;
  const cardTitle = emailUsername ?? sub.title ?? sub.plan_name ?? "Подписка";

  const deviceLabel = sub.device_limit && sub.device_limit > 0 ? String(sub.device_limit) : "∞";

  const statusColor =
    sub.status === "active" ? "text-emerald-400" :
    sub.status === "paused" ? "text-amber-400" : "text-rose-400";
  const StatusIcon = sub.status === "active" ? Wifi : sub.status === "paused" ? Clock : WifiOff;
  const statusLabel = sub.status === "active" ? "Активна" : sub.status === "paused" ? "На паузе" : "Истекла";

  return (
    <>
      {showAddons && (
        <AddonsModal sub={sub} onClose={() => setShowAddons(false)} onSuccess={onRefresh} />
      )}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="font-semibold text-white text-base">
            🔑 {cardTitle}
          </div>
          <div className={`flex items-center gap-1.5 text-sm font-semibold shrink-0 ${statusColor}`}>
            <StatusIcon size={15} />
            {statusLabel}
          </div>
        </div>

        <div className="px-5 space-y-4 pb-5">
          {/* Subscription URL */}
          {sub.subscription_url && (
            <button
              onClick={copyUrl}
              className="w-full flex items-center justify-between gap-2 rounded-xl bg-white/5 hover:bg-white/[0.08] border border-white/10 px-4 py-3 transition-colors text-left"
            >
              <span className="truncate font-mono text-xs text-white/50">{sub.subscription_url}</span>
              <Copy size={13} className={`shrink-0 transition-colors ${copied ? "text-emerald-400" : "text-white/30"}`} />
            </button>
          )}

          {/* Time left */}
          {left && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/50">⏳ Осталось</span>
              <span className="text-white font-medium">{left}</span>
            </div>
          )}

          {/* Expires at */}
          {sub.expires_at && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/50">📅 Истекает</span>
              <span className="text-white">{sub.expires_at}</span>
            </div>
          )}

          {/* Tariff */}
          {sub.plan_name && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/50">🕒 Тариф</span>
              <span className="text-white">{sub.plan_name}</span>
            </div>
          )}

          {/* Devices */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/50">📱 Устройства</span>
            <span className="text-white">{deviceLabel}</span>
          </div>

          {/* Traffic */}
          <TrafficBar used={sub.traffic_used_gb} limit={sub.traffic_limit_gb} />

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {sub.subscription_url && (
              <button
                onClick={openSub}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] hover:bg-white/[0.10] px-3 py-2.5 text-xs text-white font-medium transition-colors"
              >
                <Key size={13} />
                Подключить
              </button>
            )}
            <button
              onClick={onRenew}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all active:scale-[0.98] ${!sub.subscription_url ? "col-span-2" : ""} bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-400 border border-emerald-700/40`}
            >
              <RefreshCw size={13} />
              Продлить
            </button>
          </div>

          {/* Addons button */}
          <button
            onClick={() => setShowAddons(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] px-3 py-2.5 text-xs text-white/60 hover:text-white font-medium transition-all"
          >
            <Package size={13} />
            Докупить трафик / устройства
          </button>
        </div>
      </div>
    </>
  );
}

export default function LkMe() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [trialAvailable, setTrialAvailable] = useState(false);
  const [trialDays, setTrialDays] = useState(0);
  const [trialLoading, setTrialLoading] = useState(false);

  const loadData = () => {
    fetch("/api/lk/subscriptions", { credentials: "include" })
      .then(r => {
        if (r.status === 401) { navigate("/", { replace: true }); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setProfile(data.profile ?? null);
        setSubs(data.items ?? []);
      })
      .finally(() => setLoading(false));
  };

  const loadTrial = () => {
    fetch("/api/lk/trial", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        setTrialAvailable(data.available ?? false);
        setTrialDays(data.duration_days ?? 0);
      })
      .catch(() => {});
  };

  const activateTrial = async () => {
    setTrialLoading(true);
    try {
      const meRes = await fetch("/api/lk/me", { credentials: "include" });
      const meData = await meRes.json();
      const csrf = meData.csrf_token || "";
      const res = await fetch("/api/lk/trial/activate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      });
      const data = await res.json();
      if (data.ok) {
        setTrialAvailable(false);
        loadData();
      }
    } catch {
      /* ignore */
    } finally {
      setTrialLoading(false);
    }
  };

  useEffect(() => { loadData(); loadTrial(); }, [navigate]);

  return (
    <LkLayout>
      <div className="space-y-6">
        {/* Profile header */}
        {profile && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
            {profile.email && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-white/40">Ваша почта</span>
                <span className="text-sm text-white">{profile.email}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-white/40 flex items-center gap-1.5">
                <Send size={12} className="text-sky-400" /> Telegram
              </span>
              {profile.telegram_tg_id ? (
                <span className="text-sm text-emerald-400 font-medium">Привязан</span>
              ) : (
                <span className="text-sm text-rose-400">Не привязан</span>
              )}
            </div>
          </div>
        )}

        {/* Subscriptions */}
        <div>
          <h2 className="text-sm font-semibold text-white mb-3">Подписки</h2>
          {loading ? (
            <LkLoader />
          ) : subs.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center space-y-4">
              <div className="text-white/40 text-sm">У вас нет активных подписок</div>
              <div className="flex flex-col items-center gap-3">
                {trialAvailable && (
                  <button
                    onClick={activateTrial}
                    disabled={trialLoading}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 text-emerald-300 text-sm font-semibold px-6 py-2.5 transition-colors"
                  >
                    {trialLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Key size={14} />
                    )}
                    Взять пробный период{trialDays > 0 ? ` на ${trialDays} дня` : ""} бесплатно
                  </button>
                )}
                {!trialAvailable && (
                  <button
                    onClick={() => navigate("/tariffs")}
                    className="inline-flex items-center gap-2 rounded-full bg-white text-black text-sm font-medium px-6 py-2.5 hover:bg-white/90 transition-colors"
                  >
                    Перейти к тарифам
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {subs.map(sub => (
                <SubCard key={sub.id} sub={sub} onRenew={() => navigate("/tariffs")} onRefresh={loadData} />
              ))}

            </div>
          )}
        </div>
      </div>
    </LkLayout>
  );
}
