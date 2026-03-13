import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { CreditCard, LayoutGrid, User } from "lucide-react";

interface SignInPageProps {
  className?: string;
}

/* ─── CSS dot-grid background (replaces Three.js WebGL) ─── */
function DotBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(0,0,0,0.85)_0%,_transparent_70%)]" />
      <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-black to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black to-transparent" />
    </div>
  );
}

/* ─── NavBar ─── */

interface NavItem {
  name: string;
  url: string;
  icon: React.FC<{ size?: number; strokeWidth?: number }>;
}

function NavBar({ items, className }: { items: NavItem[]; className?: string }) {
  const [activeTab, setActiveTab] = useState(items[0].name);

  return (
    <div className={cn("fixed bottom-0 sm:top-0 left-1/2 -translate-x-1/2 z-50 mb-6 sm:pt-6 w-fit pointer-events-none", className)}>
      <div className="pointer-events-auto flex items-center gap-3 bg-white/5 border border-white/10 backdrop-blur-lg py-1 px-1 rounded-full shadow-lg">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.name;
          return (
            <a
              key={item.name}
              href={item.url}
              onClick={(e) => { e.preventDefault(); setActiveTab(item.name); }}
              className={cn(
                "relative cursor-pointer text-sm font-semibold px-6 py-2 rounded-full transition-colors",
                "text-white/60 hover:text-white",
                isActive && "bg-white/10 text-white",
              )}
            >
              <span className="hidden md:inline">{item.name}</span>
              <span className="md:hidden"><Icon size={18} strokeWidth={2.5} /></span>
              {isActive && (
                <motion.div
                  layoutId="lamp"
                  className="absolute inset-0 w-full bg-white/5 rounded-full -z-10"
                  initial={false}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-white rounded-t-full">
                    <div className="absolute w-12 h-6 bg-white/20 rounded-full blur-md -top-2 -left-2" />
                    <div className="absolute w-8 h-6 bg-white/20 rounded-full blur-md -top-1" />
                    <div className="absolute w-4 h-4 bg-white/20 rounded-full blur-sm top-0 left-2" />
                  </div>
                </motion.div>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

const navItems: NavItem[] = [
  { name: "Подписка", url: "/me", icon: CreditCard },
  { name: "Тарифы", url: "/tariffs", icon: LayoutGrid },
  { name: "Профиль", url: "/profile", icon: User },
];

/* ─── Main SignInPage ─── */

export const SignInPage = ({ className }: SignInPageProps) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "success">("email");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [botUsername, setBotUsername] = useState("");

  useEffect(() => {
    fetch("/api/lk/auth/telegram/meta", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.ok) setBotUsername(d.bot_username || "");
      })
      .catch(() => {});
    fetch("/api/lk/public/settings", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.brand_title) { document.title = d.brand_title; try { localStorage.setItem('lk_brand_title', d.brand_title); } catch(_){} } })
      .catch(() => {});
  }, []);

  const handleTelegramLogin = () => {
    if (!botUsername) return;
    // Inject Telegram Login Widget script dynamically — it opens the auth popup itself
    const container = document.getElementById("tg-login-widget-container");
    if (!container) return;
    container.innerHTML = "";
    // Define global callback
    // @ts-expect-error Telegram Login Widget global callback
    window.__tg_login_callback = async (user: Record<string, unknown>) => {
      const json = JSON.stringify(user);
      const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/lk/auth/telegram/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tgAuthResult: b64 }),
        });
        if (r.ok) {
          setStep("success");
        } else {
          const d = await r.json();
          setError(d.detail || "Ошибка входа через Telegram");
        }
      } catch {
        setError("Ошибка соединения");
      } finally {
        setLoading(false);
      }
    };
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "__tg_login_callback(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    container.appendChild(script);
  };
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setResendTimer(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendTimer(t => {
        if (t <= 1) { clearInterval(timerRef.current!); return 0; }
        return t - 1;
      });
    }, 1000);
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const sendCode = async (emailVal: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/lk/auth/email/request-code", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailVal }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.detail || "Ошибка отправки"); return false; }
      return true;
    } catch {
      setError("Ошибка соединения");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const ok = await sendCode(email);
    if (ok) { setStep("code"); startTimer(); }
  };

  useEffect(() => {
    if (step === "code") {
      setTimeout(() => { codeInputRefs.current[0]?.focus(); }, 300);
    }
  }, [step]);

  const submitCode = async (digits: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/lk/auth/email/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: digits.join("") }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.detail || "Неверный код");
        setCode(["", "", "", "", "", ""]);
        setTimeout(() => codeInputRefs.current[0]?.focus(), 50);
      } else {
        setStep("success");
      }
    } catch {
      setError("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = async (index: number, value: string) => {
    if (value.length <= 1) {
      const newCode = [...code];
      newCode[index] = value;
      setCode(newCode);
      if (value && index < 5) codeInputRefs.current[index + 1]?.focus();
      if (newCode.every(d => d.length === 1)) submitCode(newCode);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6).split("");
    if (!digits.length) return;
    const newCode = ["", "", "", "", "", ""];
    digits.forEach((d, i) => { newCode[i] = d; });
    setCode(newCode);
    const lastFilled = Math.min(digits.length, 5);
    codeInputRefs.current[lastFilled]?.focus();
    if (digits.length === 6) submitCode(newCode);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !code[index] && index > 0) codeInputRefs.current[index - 1]?.focus();
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setCode(["", "", "", "", "", ""]);
    setError(null);
    const ok = await sendCode(email);
    if (ok) { startTimer(); setTimeout(() => codeInputRefs.current[0]?.focus(), 50); }
  };

  const handleBackClick = () => {
    setStep("email");
    setCode(["", "", "", "", "", ""]);
    setError(null);
    if (timerRef.current) clearInterval(timerRef.current);
    setResendTimer(0);
  };

  return (
    <div className={cn("w-full min-h-screen bg-black relative", className)}>
      <DotBackground />

      <NavBar items={navItems} />

      <div className="relative z-10 flex h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
              <AnimatePresence mode="wait">
                {step === "email" ? (
                  <motion.div
                    key="email-step"
                    initial={{ opacity: 0, x: -60 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -60 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-1">
                      <h1 className="text-[2.5rem] font-bold leading-[1.1] tracking-tight text-white">Welcome</h1>
                      <p className="text-[1.5rem] text-white/50 font-light">Войдите в личный кабинет</p>
                    </div>
                    <div className="space-y-4">
                      {botUsername && (
                        <>
                          <button onClick={handleTelegramLogin} id="tg-login-btn" className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-full py-3 px-4 transition-colors">
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L6.145 13.5l-2.945-.924c-.64-.203-.654-.64.136-.954l11.508-4.44c.534-.194 1.001.13.718.066z"/>
                            </svg>
                            <span>Войти через Telegram</span>
                          </button>
                          <div id="tg-login-widget-container" className="flex justify-center" />
                        </>
                      )}
                      <div className="flex items-center gap-4">
                        <div className="h-px bg-white/10 flex-1" />
                        <span className="text-white/40 text-sm">or</span>
                        <div className="h-px bg-white/10 flex-1" />
                      </div>
                      <form onSubmit={handleEmailSubmit}>
                        <div className="relative">
                          <input
                            type="email"
                            placeholder="info@gmail.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full text-white border border-white/10 rounded-full py-3 px-5 focus:outline-none focus:border-white/30 text-center"
                            style={{ background: 'rgba(255,255,255,0.05)', caretColor: 'white' }}
                            required
                            disabled={loading}
                          />
                          <button
                            type="submit"
                            disabled={loading}
                            className="absolute right-1.5 top-1.5 text-white w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
                          >
                            {loading ? "…" : "→"}
                          </button>
                        </div>
                        {error && <p className="text-rose-400 text-xs mt-2">{error}</p>}
                      </form>
                    </div>
                    <p className="text-xs text-white/30 pt-6">
                      Нажимая кнопку, вы соглашаетесь с условиями использования сервиса.
                    </p>
                  </motion.div>
                ) : step === "code" ? (
                  <motion.div
                    key="code-step"
                    initial={{ opacity: 0, x: 60 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 60 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-1">
                      <h1 className="text-[2.5rem] font-bold leading-[1.1] tracking-tight text-white">Введите код</h1>
                      <p className="text-[1.1rem] text-white/50 font-light">Мы отправили код на {email}</p>
                    </div>
                    <div className="w-full">
                      <div className={`relative rounded-full py-4 px-5 border bg-transparent transition-colors ${error ? 'border-rose-500/50' : 'border-white/10'}`}>
                        <div className="flex items-center justify-center">
                          {code.map((digit, i) => (
                            <div key={i} className="flex items-center">
                              <div className="relative">
                                <input
                                  ref={(el) => { codeInputRefs.current[i] = el; }}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  maxLength={1}
                                  value={digit}
                                  onChange={e => handleCodeChange(i, e.target.value)}
                                  onKeyDown={e => handleKeyDown(i, e)}
                                  onPaste={handlePaste}
                                  disabled={loading}
                                  className="w-9 h-9 text-center text-xl bg-transparent text-white border-none focus:outline-none focus:ring-0 appearance-none disabled:opacity-50"
                                  style={{ caretColor: 'white' }}
                                />
                                {!digit && (
                                  <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none">
                                    <span className="text-xl text-white/20">·</span>
                                  </div>
                                )}
                              </div>
                              {i < 5 && <span className="text-white/20 text-xl mx-0.5">|</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      {error && <p className="text-rose-400 text-xs mt-2 text-center">{error}</p>}
                    </div>
                    <div>
                      <button
                        onClick={handleResend}
                        disabled={resendTimer > 0 || loading}
                        className="text-sm transition-colors disabled:cursor-default"
                        style={{ color: resendTimer > 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.5)' }}
                      >
                        {resendTimer > 0 ? `Отправить снова через ${resendTimer} сек.` : "Отправить снова"}
                      </button>
                    </div>
                    <div className="flex w-full gap-3">
                      <button
                        onClick={handleBackClick}
                        className="rounded-full bg-white/10 text-white font-medium px-8 py-3 hover:bg-white/20 transition-colors w-[30%]"
                      >
                        Назад
                      </button>
                      <button
                        className={`flex-1 rounded-full font-medium py-3 border transition-all duration-300 ${
                          code.every(d => d !== "")
                            ? "bg-white text-black border-transparent hover:bg-white/90 cursor-pointer"
                            : "bg-white/5 text-white/30 border-white/10 cursor-not-allowed"
                        }`}
                        disabled={!code.every(d => d !== "")}
                      >
                        Продолжить
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="success-step"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-1">
                      <h1 className="text-[2.5rem] font-bold leading-[1.1] tracking-tight text-white">Добро пожаловать!</h1>
                      <p className="text-[1.25rem] text-white/50 font-light">Вход выполнен</p>
                    </div>
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.4, delay: 0.2 }}
                      className="py-8"
                    >
                      <div className="mx-auto w-16 h-16 rounded-full bg-white flex items-center justify-center">
                        <svg className="h-8 w-8 text-black" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </motion.div>
                    <button
                      onClick={() => navigate('/me', { replace: true })}
                      className="w-full rounded-full bg-white text-black font-medium py-3 hover:bg-white/90 transition-colors"
                    >
                      Перейти в кабинет
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
