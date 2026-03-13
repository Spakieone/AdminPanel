import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send, Mail, MessageCircle } from "lucide-react";
import LkLayout from "@/components/lk/LkLayout";

interface PublicSettings {
  brand_title: string;
  support_telegram: string;
  support_email: string;
}

export default function LkSupport() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    const check = async () => {
      const r = await fetch("/api/lk/me", { credentials: "include" });
      if (r.status === 401) { navigate("/", { replace: true }); return; }
    };
    const load = async () => {
      const r = await fetch("/api/lk/public/settings", { credentials: "include" });
      if (r.ok) setSettings(await r.json());
    };
    check();
    load();
  }, [navigate]);

  const hasTg = Boolean(settings?.support_telegram);
  const hasEmail = Boolean(settings?.support_email);

  return (
    <LkLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Поддержка</h1>
          <p className="text-sm text-white/40 mt-1">Свяжитесь с нами удобным способом</p>
        </div>

        {(!hasTg && !hasEmail) ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-white/30">
            Контакты поддержки не указаны
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
            {hasTg && (
              <a
                href={`https://t.me/${settings!.support_telegram.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-5 hover:bg-white/[0.04] transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0">
                  <Send size={18} className="text-sky-400" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">Telegram</div>
                  <div className="text-xs text-white/40 mt-0.5">
                    @{settings!.support_telegram.replace(/^@/, "")}
                  </div>
                </div>
              </a>
            )}
            {hasEmail && (
              <a
                href={`mailto:${settings!.support_email}`}
                className="flex items-center gap-4 p-5 hover:bg-white/[0.04] transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0">
                  <Mail size={18} className="text-violet-400" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">Email</div>
                  <div className="text-xs text-white/40 mt-0.5">{settings!.support_email}</div>
                </div>
              </a>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm text-white/50">
            <MessageCircle size={15} className="shrink-0" />
            <span>Опишите проблему как можно подробнее — это ускорит решение.</span>
          </div>
        </div>
      </div>
    </LkLayout>
  );
}
