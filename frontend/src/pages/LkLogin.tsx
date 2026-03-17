import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

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
  const [botId, setBotId] = useState<number>(0);

  useEffect(() => {
    fetch("/api/lk/auth/telegram/meta", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.ok) {
          setBotUsername(d.bot_username || "");
          setBotId(d.bot_id || 0);
        }
      })
      .catch(() => {});
    fetch("/api/lk/public/settings", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.brand_title) { document.title = d.brand_title; try { localStorage.setItem('lk_brand_title', d.brand_title); } catch(_){} } })
      .catch(() => {});
  }, []);

  const submitTgUser = async (user: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const json = JSON.stringify(user);
      const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

  // Listen for postMessage from Telegram OAuth popup
  useEffect(() => {
    if (!botUsername) return;
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== "https://oauth.telegram.org") return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.event === "auth_result") {
          if (data.result) {
            submitTgUser(data.result);
          } else {
            setError("Авторизация отменена");
          }
        }
      } catch { /* ignore non-json messages */ }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [botUsername]);

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
                        <button
                          type="button"
                          onClick={() => {
                            const origin = window.location.origin;
                            const w = 550, h = 470;
                            const left = Math.max(0, (screen.width - w) / 2);
                            const top = Math.max(0, (screen.height - h) / 2);
                            window.open(
                              `https://oauth.telegram.org/auth?bot_id=${botId}&origin=${encodeURIComponent(origin)}&request_access=write&embed=0`,
                              "TelegramAuth",
                              `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=no`
                            );
                          }}
                          disabled={loading}
                          className="w-full flex items-center justify-center gap-3 rounded-full py-3 px-5 font-medium text-white transition-colors hover:bg-[#2CA5E0]/90 disabled:opacity-50"
                          style={{ background: '#2CA5E0' }}
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.492-1.302.48-.428-.012-1.252-.242-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                          </svg>
                          Войти через Telegram
                        </button>
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
