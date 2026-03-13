import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LkLayout from "@/components/lk/LkLayout";
import LkLoader from "@/components/lk/LkLoader";

interface Tariff {
  id: number;
  name: string;
  group_code: string;
  subgroup_title: string | null;
  duration_days: number;
  price_rub: number;
  traffic_limit: number | null;
  device_limit: number | null;
  configurable: boolean;
  traffic_options_gb: number[] | null;
  device_options: number[] | null;
  traffic_step_rub: number | null;
  device_step_rub: number | null;
  traffic_overrides: Record<string, number> | null;
  device_overrides: Record<string, number> | null;
  sort_order: number;
  is_active: boolean;
}

interface Provider {
  key: string;
  title: string;
  mode: "link" | "init";
  url?: string;
  currency: string;
}

function durationLabel(days: number) {
  if (days < 30) return `${days} дней`;
  const months = Math.round(days / 30);
  if (days < 365) return `${months} ${months === 1 ? "месяц" : months < 5 ? "месяца" : "месяцев"}`;
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? "год" : years < 5 ? "года" : "лет"}`;
}

function trafficLabel(limit: number | null) {
  if (limit == null) return null;
  if (limit === 0) return "Безлимит";
  return `${limit} ГБ`;
}

function calcPrice(tariff: Tariff, trafficGb: number | null, deviceLimit: number | null): number {
  let price = tariff.price_rub;
  if (!tariff.configurable) return price;
  if (trafficGb != null && tariff.traffic_options_gb && tariff.traffic_options_gb.length > 1) {
    const ovr = tariff.traffic_overrides?.[String(trafficGb)];
    if (ovr != null) {
      price = ovr;
    } else if (tariff.traffic_step_rub && tariff.traffic_options_gb[0] != null) {
      const extra = trafficGb - tariff.traffic_options_gb[0];
      if (extra > 0) price += extra * tariff.traffic_step_rub;
    }
  }
  if (deviceLimit != null && tariff.device_options && tariff.device_options.length > 1) {
    const ovr = tariff.device_overrides?.[String(deviceLimit)];
    if (ovr != null) {
      price = ovr;
    } else if (tariff.device_step_rub && tariff.device_options[0] != null) {
      const extra = deviceLimit - tariff.device_options[0];
      if (extra > 0) price += extra * tariff.device_step_rub;
    }
  }
  return price;
}

function TariffCard({ tariff, onConfigure }: { tariff: Tariff; onConfigure: (t: Tariff) => void }) {
  const tLabel = trafficLabel(tariff.traffic_limit);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] hover:border-white/20 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-white text-sm">{tariff.name}</span>
            <span className="text-xs text-white/30">{durationLabel(tariff.duration_days)}</span>
          </div>
          <div className="flex gap-3 mt-1">
            {tLabel && <span className="text-xs text-white/40">{tLabel} трафика</span>}
            {tariff.device_limit != null && (
              <span className="text-xs text-white/40">
                {tariff.device_limit === 0 ? "Безлимит устройств" : `${tariff.device_limit} ${tariff.device_limit === 1 ? "устройство" : tariff.device_limit < 5 ? "устройства" : "устройств"}`}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onConfigure(tariff)}
          className="shrink-0 rounded-full bg-white text-black text-xs font-semibold px-4 py-2 hover:bg-white/90 active:scale-[0.98] transition-all"
        >
          {tariff.price_rub} ₽
        </button>
      </div>
    </div>
  );
}

export default function LkTariffs() {
  const navigate = useNavigate();
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [csrf, setCsrf] = useState("");

  // screen: "list" | "config" | "payment"
  const [screen, setScreen] = useState<"list" | "config" | "payment">("list");
  const [configTariff, setConfigTariff] = useState<Tariff | null>(null);
  const [selectedTraffic, setSelectedTraffic] = useState<number | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<number | null>(null);

  const [balance, setBalance] = useState<number | null>(null);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [requiredAmount, setRequiredAmount] = useState(0);
  const [paymentUrl, setPaymentUrl] = useState("");
  const [paying, setPaying] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lk/tariffs", { credentials: "include" })
      .then(r => r.json())
      .then(data => setTariffs((data.items ?? []).filter((t: Tariff) => t.is_active)))
      .finally(() => setLoading(false));
    fetch("/api/lk/me", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        setCsrf(data.csrf_token || "");
        if (data.balance_rub != null) setBalance(data.balance_rub);
      });
  }, []);

  const openConfig = (t: Tariff) => {
    setConfigTariff(t);
    setSelectedTraffic(t.traffic_options_gb?.[0] ?? null);
    setSelectedDevices(t.device_options?.[0] ?? null);
    setError(null);
    setScreen("config");
  };

  const handleBuy = async () => {
    if (!configTariff) return;
    setError(null);
    setBuying(true);
    try {
      const body: Record<string, unknown> = { tariff_id: configTariff.id };
      if (selectedTraffic != null) body.traffic_gb = selectedTraffic;
      if (selectedDevices != null) body.device_limit = selectedDevices;

      const r = await fetch("/api/lk/subscriptions/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (r.status === 401) { navigate("/", { replace: true }); return; }
      const data = await r.json();

      if (data.code === "insufficient_funds") {
        setRequiredAmount(data.required_amount);
        setPaymentUrl("");
        setError(null);
        // load providers then go to payment screen
        const provRes = await fetch("/api/lk/payments/providers", { credentials: "include" });
        const provData = await provRes.json();
        const items: Provider[] = provData.items ?? [];
        setProviders(items);
        if (items.length > 0) setSelectedProvider(items[0].key);
        setScreen("payment");
      } else if (!r.ok) {
        setError(data.detail || "Ошибка при создании подписки");
      } else {
        navigate("/me");
      }
    } catch {
      setError("Ошибка соединения");
    } finally {
      setBuying(false);
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

  const subgroups = tariffs.reduce<Record<string, Tariff[]>>((acc, t) => {
    const key = t.subgroup_title || "";
    (acc[key] = acc[key] || []).push(t);
    return acc;
  }, {});

  // ── PAYMENT SCREEN ──────────────────────────────────────────────────────────
  if (screen === "payment") {
    return (
      <LkLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <button onClick={() => { setScreen("config"); setError(null); setPaymentUrl(""); }} className="text-white/40 hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold">Оплата</h1>
              <p className="text-sm text-white/40 mt-0.5">Недостаточно средств на балансе</p>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">{error}</div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
            {balance != null && (
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-white/40">Ваш баланс</span>
                <span className="text-white font-semibold">{balance.toFixed(2)} ₽</span>
              </div>
            )}
            <div className="flex justify-between px-4 py-3 text-sm">
              <span className="text-white/40">Вам не хватает</span>
              <span className="text-rose-400 font-semibold">{requiredAmount.toFixed(2)} ₽</span>
            </div>
          </div>

          {paying ? (
            <LkLoader text="Формируется ссылка . . . " />
          ) : paymentUrl ? (
            <a
              href={paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full rounded-full bg-white text-black text-sm font-semibold py-3 hover:bg-white/90 transition-all flex items-center justify-center"
            >
              Перейти к оплате →
            </a>
          ) : (
            <>
              {providers.length === 0 ? (
                <div className="text-sm text-white/40 text-center py-6">Способы оплаты недоступны</div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-white/30 uppercase tracking-widest">Способ оплаты</div>
                  {providers.map(p => (
                    <button
                      key={p.key}
                      onClick={() => setSelectedProvider(p.key)}
                      className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border transition-all ${
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
              {providers.length > 0 && (
                <button
                  onClick={handlePay}
                  disabled={!selectedProvider}
                  className="w-full rounded-full bg-white text-black text-sm font-semibold py-3 hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {`Оплатить ${requiredAmount.toFixed(2)} ₽`}
                </button>
              )}
            </>
          )}
        </div>
      </LkLayout>
    );
  }

  // ── CONFIG SCREEN ───────────────────────────────────────────────────────────
  if (screen === "config" && configTariff) {
    const totalPrice = calcPrice(configTariff, selectedTraffic, selectedDevices);
    const showTraffic = configTariff.configurable && configTariff.traffic_options_gb && configTariff.traffic_options_gb.length > 1;
    const showDevices = configTariff.configurable && configTariff.device_options && configTariff.device_options.length > 1;

    return (
      <LkLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <button onClick={() => { setScreen("list"); setError(null); }} className="text-white/40 hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold">{configTariff.name}</h1>
              <p className="text-sm text-white/40 mt-0.5">{durationLabel(configTariff.duration_days)}</p>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">{error}</div>
          )}

          {(showTraffic || showDevices) && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-6">
              {showTraffic && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-white">Трафик</div>
                    <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-sm">
                      <span className="text-white/40">Выбрано:</span>
                      <span className="font-semibold text-white">{selectedTraffic === 0 ? "Безлимит" : `${selectedTraffic} ГБ`}</span>
                    </div>
                  </div>
                  <input
                    type="range" min={0} max={configTariff.traffic_options_gb!.length - 1} step={1}
                    value={configTariff.traffic_options_gb!.indexOf(selectedTraffic ?? configTariff.traffic_options_gb![0])}
                    onChange={e => setSelectedTraffic(configTariff.traffic_options_gb![+e.target.value])}
                    className="lk-range w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{ background: (() => { const idx = configTariff.traffic_options_gb!.indexOf(selectedTraffic ?? configTariff.traffic_options_gb![0]); const pct = (idx / (configTariff.traffic_options_gb!.length - 1)) * 100; return `linear-gradient(to right, white ${pct}%, rgba(255,255,255,0.15) ${pct}%)`; })() }}
                  />
                  <div className="flex justify-between">
                    {configTariff.traffic_options_gb!.map(gb => <span key={gb} className="text-xs text-white/40">{gb === 0 ? "∞" : gb}</span>)}
                  </div>
                </div>
              )}
              {showDevices && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-white">Количество устройств</div>
                    <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-sm">
                      <span className="text-white/40">Выбрано:</span>
                      <span className="font-semibold text-white">{selectedDevices === 0 ? "Безлимит" : `${selectedDevices} ${selectedDevices === 1 ? "устройство" : selectedDevices != null && selectedDevices < 5 ? "устройства" : "устройств"}`}</span>
                    </div>
                  </div>
                  <input
                    type="range" min={0} max={configTariff.device_options!.length - 1} step={1}
                    value={configTariff.device_options!.indexOf(selectedDevices ?? configTariff.device_options![0])}
                    onChange={e => setSelectedDevices(configTariff.device_options![+e.target.value])}
                    className="lk-range w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{ background: (() => { const idx = configTariff.device_options!.indexOf(selectedDevices ?? configTariff.device_options![0]); const pct = (idx / (configTariff.device_options!.length - 1)) * 100; return `linear-gradient(to right, white ${pct}%, rgba(255,255,255,0.15) ${pct}%)`; })() }}
                  />
                  <div className="flex justify-between">
                    {configTariff.device_options!.map(d => <span key={d} className="text-xs text-white/40">{d === 0 ? "∞" : d}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
            <div className="flex justify-between px-4 py-3 text-sm">
              <span className="text-white/40">Период</span>
              <span className="text-white">{configTariff.duration_days} дней</span>
            </div>
            {(selectedTraffic ?? configTariff.traffic_limit) != null && (
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-white/40">Трафик</span>
                <span className="text-white">{(selectedTraffic ?? configTariff.traffic_limit) === 0 ? "Безлимит" : `${selectedTraffic ?? configTariff.traffic_limit} ГБ`}</span>
              </div>
            )}
            {(selectedDevices ?? configTariff.device_limit) != null && (
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-white/40">Устройства</span>
                <span className="text-white">{(() => { const d = selectedDevices ?? configTariff.device_limit; if (d === 0) return "Безлимит"; return `${d} ${d === 1 ? "устройство" : d != null && d < 5 ? "устройства" : "устройств"}`; })()}</span>
              </div>
            )}
            <div className="flex justify-between px-4 py-3">
              <span className="text-white/40 text-sm">Итого</span>
              <span className="text-white font-bold text-lg">{totalPrice} ₽</span>
            </div>
          </div>

          <button
            onClick={handleBuy}
            disabled={buying}
            className="w-full rounded-full bg-white text-black text-sm font-semibold py-3 hover:bg-white/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {buying ? "Оформляем..." : `Оплатить ${totalPrice} ₽`}
          </button>
        </div>
      </LkLayout>
    );
  }

  // ── LIST SCREEN ─────────────────────────────────────────────────────────────
  return (
    <LkLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Тарифы</h1>
          <p className="text-sm text-white/40 mt-1">Выберите подходящий план</p>
        </div>

        {loading ? (
          <LkLoader />
        ) : tariffs.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-white/40">
            Тарифы недоступны
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(subgroups).map(([subgroup, items]) => (
              <div key={subgroup} className="space-y-3">
                {subgroup && <div className="text-xs font-semibold text-white/30 uppercase tracking-widest">{subgroup}</div>}
                {items.map(t => <TariffCard key={t.id} tariff={t} onConfigure={openConfig} />)}
              </div>
            ))}
          </div>
        )}
      </div>
    </LkLayout>
  );
}
