import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Share2, X, Check } from "lucide-react";
import LkLayout from "@/components/lk/LkLayout";
import LkLoader from "@/components/lk/LkLoader";

interface PartnerProgram {
  kind: "partner_program";
  referral_link: string | null;
  invited_count: number;
  partner_balance: number;
  percent: number;
  payout_method: string | null;
  payout_method_label: string | null;
  requisites_masked: string | null;
}

interface Referral {
  kind: "referral";
  referral_link: string | null;
  total_referrals: number;
  active_referrals: number;
  total_referral_bonus: number;
}

interface None { kind: "none"; }

type PartnerData = PartnerProgram | Referral | None;

interface PayoutMethod { key: string; label: string; }
interface PayoutMethods {
  methods: PayoutMethod[];
  min_payout: number;
  enable_withdraw_to_balance: boolean;
}

// Плейсхолдеры для ввода реквизитов
const REQUISITES_PLACEHOLDER: Record<string, string> = {
  card: "Номер карты: 5469000012345678",
  usdt: "USDT TRC20: TJ3C4...Gf9x1",
  ton: "TON: UQxxxxxx...",
  sbp: "Телефон и банк: +79991234567, Тинькофф",
};

function CopyLinkBlock({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const share = () => {
    if (navigator.share) navigator.share({ url: link }).catch(() => {});
    else copy();
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-white/40 font-medium">🔗 Ваша ссылка</div>
      <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 flex items-center gap-2">
        <span className="truncate font-mono text-xs text-white/70 flex-1">{link}</span>
        <button onClick={copy} className="shrink-0 text-white/40 hover:text-white transition-colors" title="Скопировать">
          <Copy size={14} className={copied ? "text-emerald-400" : ""} />
        </button>
        <button onClick={share} className="shrink-0 text-white/40 hover:text-white transition-colors" title="Поделиться">
          <Share2 size={14} />
        </button>
      </div>
    </div>
  );
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-white/50">{label}</span>
      <span className={`text-sm font-semibold ${valueClass ?? "text-white"}`}>{value}</span>
    </div>
  );
}

function ActionButton({ onClick, children, disabled, variant = "default" }: {
  onClick: () => void; children: React.ReactNode; disabled?: boolean;
  variant?: "default" | "danger" | "success";
}) {
  const cls = {
    default: "bg-white/[0.04] hover:bg-white/[0.07] border-white/10 text-white/60 hover:text-white/80",
    danger: "bg-rose-950/60 hover:bg-rose-900/70 border-rose-700/40 text-rose-400",
    success: "bg-emerald-950/60 hover:bg-emerald-900/70 border-emerald-700/40 text-emerald-400",
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {children}
    </button>
  );
}

export default function LkPartner() {
  const navigate = useNavigate();
  const [data, setData] = useState<PartnerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [csrf, setCsrf] = useState("");

  // Вывод средств
  const [payoutMeta, setPayoutMeta] = useState<PayoutMethods | null>(null);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // Настройка способа вывода
  const [showSetMethod, setShowSetMethod] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState("");
  const [requisites, setRequisites] = useState("");
  const [setMethodLoading, setSetMethodLoading] = useState(false);
  const [setMethodError, setSetMethodError] = useState<string | null>(null);
  const [setMethodOk, setSetMethodOk] = useState(false);

  const reload = async () => {
    const r = await fetch("/api/lk/partner", { credentials: "include" });
    if (r.ok) setData(await r.json());
  };

  useEffect(() => {
    const load = async () => {
      const [partnerRes, meRes, methodsRes] = await Promise.all([
        fetch("/api/lk/partner", { credentials: "include" }),
        fetch("/api/lk/me", { credentials: "include" }),
        fetch("/api/lk/partner/payout-methods", { credentials: "include" }),
      ]);
      if (partnerRes.status === 401) { navigate("/", { replace: true }); return; }
      if (partnerRes.ok) setData(await partnerRes.json());
      if (meRes.ok) { const m = await meRes.json(); setCsrf(m.csrf_token || ""); }
      if (methodsRes.ok) setPayoutMeta(await methodsRes.json());
    };
    load().finally(() => setLoading(false));
  }, [navigate]);

  const handleWithdraw = async (toBalance: boolean) => {
    setWithdrawLoading(true);
    setWithdrawError(null);
    setWithdrawResult(null);
    try {
      const r = await fetch("/api/lk/partner/withdraw", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ to_balance: toBalance }),
      });
      const d = await r.json();
      if (!r.ok) { setWithdrawError(d.detail || "Ошибка"); return; }
      if (toBalance) {
        setWithdrawResult(`✅ Переведено ${d.transferred?.toFixed(2)} ₽ на основной баланс`);
      } else {
        setWithdrawResult(`✅ Заявка на вывод ${d.amount?.toFixed(2)} ₽ создана. Ожидайте подтверждения.`);
      }
      await reload();
    } catch {
      setWithdrawError("Ошибка соединения");
    } finally {
      setWithdrawLoading(false);
    }
  };

  const handleSetMethod = async () => {
    if (!selectedMethod || !requisites.trim()) return;
    setSetMethodLoading(true);
    setSetMethodError(null);
    setSetMethodOk(false);
    try {
      const r = await fetch("/api/lk/partner/set-method", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ method: selectedMethod, requisites: requisites.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { setSetMethodError(d.detail || "Ошибка"); return; }
      setSetMethodOk(true);
      setShowSetMethod(false);
      setSelectedMethod(""); setRequisites("");
      await reload();
    } catch {
      setSetMethodError("Ошибка соединения");
    } finally {
      setSetMethodLoading(false);
    }
  };

  if (loading) return <LkLayout><LkLoader /></LkLayout>;

  if (!data || data.kind === "none") {
    return (
      <LkLayout>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">Пригласить</h1>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-white/30">
            Программа приглашений недоступна
          </div>
        </div>
      </LkLayout>
    );
  }

  const isPartner = data.kind === "partner_program";
  const pd = isPartner ? (data as PartnerProgram) : null;

  return (
    <LkLayout>
      <div className="space-y-4">

        {/* ─── ПАРТНЁРСКАЯ ПРОГРАММА ─── */}
        {data.kind === "partner_program" && pd && (
          <>
            <h1 className="text-2xl font-bold">👥 Партнёрская программа</h1>

            {/* Intro */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <div className="text-sm font-semibold text-white">💼 Зарабатывай вместе с нами!</div>
              <div className="pl-3 border-l-2 border-white/10 space-y-1 text-sm text-white">
                <p>1) Приглашай друзей по своей <span className="font-semibold">уникальной ссылке</span> и получай{" "}
                  <span className="text-emerald-400 font-bold">{pd.percent}%</span> с каждого пополнения.</p>
                <p>2) Выводи заработанные средства на удобный способ.</p>
              </div>
            </div>

            {/* Ссылка */}
            {pd.referral_link && <CopyLinkBlock link={pd.referral_link} />}

            {/* Статистика */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs text-white/40 font-medium mb-3">📊 Ваша статистика</div>
              <div className="pl-3 border-l-2 border-white/10">
                <StatRow label="👤 Приглашено" value={`${pd.invited_count}`} />
                <StatRow label="💰 Баланс" value={`${pd.partner_balance.toFixed(2)} ₽`} valueClass="text-emerald-400" />
                <StatRow label="🏦 Способ вывода" value={pd.payout_method_label || pd.payout_method || "не задан"} valueClass={pd.payout_method ? "text-white" : "text-white/40"} />
                <StatRow label="🧾 Реквизиты" value={pd.requisites_masked || "не указаны"} valueClass={pd.requisites_masked ? "text-white/70 font-mono text-xs" : "text-white/40"} />
              </div>
            </div>

            {/* Заметка о минимуме */}
            <div className="text-xs text-white/40 italic px-1">
              💸 Вывод доступен от <span className="text-white/60 not-italic font-medium">{payoutMeta?.min_payout ?? 300}₽</span>.
            </div>

            {/* Текущая ставка */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <div className="text-sm font-semibold text-white">
                📈 Текущая ставка: <span className="text-emerald-400">{pd.percent}%</span>
              </div>
              <div className="pl-3 border-l-2 border-white/10 text-xs text-white/50">
                <span className="font-medium text-white/70">Пример:</span>{" "}
                платёж 500₽ → бонус <span className="text-emerald-400 font-semibold">{(500 * pd.percent / 100).toFixed(1)}₽</span>
              </div>
            </div>

            {/* ─── КНОПКИ ─── */}
            <div className="space-y-2">

              {/* 💰 Вывести средства */}
              {!showWithdraw && !showSetMethod && (
                <ActionButton onClick={() => { setShowWithdraw(true); setWithdrawResult(null); setWithdrawError(null); }} variant="success">
                  💰 Вывести средства
                </ActionButton>
              )}

              {/* Панель вывода */}
              {showWithdraw && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">💰 Вывод средств</div>
                    <button onClick={() => setShowWithdraw(false)} className="text-white/30 hover:text-white"><X size={16} /></button>
                  </div>
                  <div className="text-sm text-white/50">Доступно: <span className="text-emerald-400 font-semibold">{pd.partner_balance.toFixed(2)} ₽</span></div>

                  {withdrawResult && <div className="text-sm text-emerald-400 bg-emerald-500/10 rounded-xl px-3 py-2">{withdrawResult}</div>}
                  {withdrawError && <div className="text-sm text-rose-400 bg-rose-500/10 rounded-xl px-3 py-2">{withdrawError}</div>}

                  <div className="space-y-2">
                    {/* На реквизиты */}
                    {pd.payout_method && pd.requisites_masked && (
                      <button
                        onClick={() => handleWithdraw(false)}
                        disabled={withdrawLoading || pd.partner_balance <= 0}
                        className="w-full flex items-center justify-between gap-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700/40 px-4 py-3 text-sm text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        <span>🏦 На реквизиты</span>
                        <span className="text-xs text-emerald-400/60 font-mono">{pd.requisites_masked}</span>
                      </button>
                    )}
                    {/* На баланс бота */}
                    {payoutMeta?.enable_withdraw_to_balance && (
                      <button
                        onClick={() => handleWithdraw(true)}
                        disabled={withdrawLoading || pd.partner_balance <= 0}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700/40 px-4 py-3 text-sm text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        💳 На баланс в боте
                      </button>
                    )}
                    {!pd.payout_method && (
                      <div className="text-xs text-white/40 text-center py-2">
                        Сначала укажите способ вывода ниже
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ⚙️ Способ вывода */}
              {!showWithdraw && !showSetMethod && (
                <ActionButton onClick={() => { setShowSetMethod(true); setSetMethodError(null); setSetMethodOk(false); setSelectedMethod(pd.payout_method || ""); setRequisites(""); }}>
                  ⚙️ {pd.payout_method ? `Вывод: ${pd.payout_method_label}` : "Вывод: не задан"}
                </ActionButton>
              )}

              {/* Панель настройки способа */}
              {showSetMethod && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">⚙️ Способ вывода</div>
                    <button onClick={() => setShowSetMethod(false)} className="text-white/30 hover:text-white"><X size={16} /></button>
                  </div>

                  {/* Выбор метода */}
                  {payoutMeta && payoutMeta.methods.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {payoutMeta.methods.map(m => (
                        <button
                          key={m.key}
                          onClick={() => { setSelectedMethod(m.key); setRequisites(""); setSetMethodError(null); }}
                          className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                            selectedMethod === m.key
                              ? "bg-white text-black border-white font-semibold"
                              : "bg-transparent text-white/50 border-white/15 hover:border-white/30"
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-white/40">Способы вывода временно недоступны</div>
                  )}

                  {/* Ввод реквизитов */}
                  {selectedMethod && (
                    <input
                      type="text"
                      value={requisites}
                      onChange={e => setRequisites(e.target.value)}
                      placeholder={REQUISITES_PLACEHOLDER[selectedMethod] || "Введите реквизиты"}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/30"
                    />
                  )}

                  {setMethodError && <div className="text-xs text-rose-400">{setMethodError}</div>}
                  {setMethodOk && <div className="text-xs text-emerald-400 flex items-center gap-1"><Check size={12} /> Сохранено</div>}

                  <button
                    onClick={handleSetMethod}
                    disabled={!selectedMethod || !requisites.trim() || setMethodLoading}
                    className="w-full rounded-full bg-white text-black text-sm font-semibold py-2.5 hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {setMethodLoading ? "Сохранение…" : "Сохранить"}
                  </button>
                </div>
              )}

              {/* 📨 Пригласить друзей */}
              {!showWithdraw && !showSetMethod && pd.referral_link && (
                <ActionButton onClick={() => {
                  if (navigator.share) navigator.share({ url: pd.referral_link!, title: "Приглашение в VPN" }).catch(() => {});
                  else navigator.clipboard.writeText(pd.referral_link!);
                }}>
                  📨 Пригласить друзей
                </ActionButton>
              )}
            </div>
          </>
        )}

        {/* ─── РЕФЕРАЛЬНАЯ ПРОГРАММА ─── */}
        {data.kind === "referral" && (
          <>
            <h1 className="text-2xl font-bold">👥 Реферальная программа</h1>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <div className="text-sm font-semibold text-white">🤝 Приглашайте друзей!</div>
              <div className="pl-3 border-l-2 border-white/10 text-sm text-white">
                Приглашайте друзей и получайте крутые бонусы на каждом уровне! 💰
              </div>
            </div>

            {data.referral_link && <CopyLinkBlock link={data.referral_link} />}

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs text-white/40 font-medium mb-3">📊 Статистика приглашений</div>
              <div className="pl-3 border-l-2 border-white/10">
                <StatRow label="👥 Всего приглашено" value={`${data.total_referrals} человек`} />
                <StatRow label="✅ Активных" value={`${data.active_referrals}`} valueClass="text-emerald-400" />
                {data.total_referral_bonus > 0 && (
                  <StatRow label="💰 Общий бонус" value={`${data.total_referral_bonus.toFixed(2)} ₽`} valueClass="text-amber-400" />
                )}
              </div>
            </div>

            {data.referral_link && (
              <ActionButton onClick={() => {
                if (navigator.share) navigator.share({ url: data.referral_link! }).catch(() => {});
                else navigator.clipboard.writeText(data.referral_link!);
              }}>
                📨 Пригласить друзей
              </ActionButton>
            )}
          </>
        )}

      </div>
    </LkLayout>
  );
}
