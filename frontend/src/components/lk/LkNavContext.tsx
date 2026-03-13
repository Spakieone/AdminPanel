import { createContext, useContext, useEffect, useState } from "react";

interface LkNavState {
  hasPartner: boolean;
  hasSupport: boolean;
}

const LkNavContext = createContext<LkNavState>({ hasPartner: false, hasSupport: false });

export function useLkNav() {
  return useContext(LkNavContext);
}

export function LkNavProvider({ children }: { children: React.ReactNode }) {
  const [hasPartner, setHasPartner] = useState(false);
  const [hasSupport, setHasSupport] = useState(false);

  useEffect(() => {
    fetch("/api/lk/public/settings", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setHasSupport(Boolean(d.support_telegram || d.support_email)); })
      .catch(() => {});

    fetch("/api/lk/partner", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.kind && d.kind !== "none") setHasPartner(true); })
      .catch(() => {});
  }, []);

  return (
    <LkNavContext.Provider value={{ hasPartner, hasSupport }}>
      {children}
    </LkNavContext.Provider>
  );
}
