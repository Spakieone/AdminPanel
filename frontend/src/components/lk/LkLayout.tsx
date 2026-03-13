import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CreditCard, LayoutGrid, User, LogOut, Headphones, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLkNav } from "./LkNavContext";

function DotBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
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

const baseNavItems = [
  { name: "Подписка", url: "/me", icon: CreditCard },
  { name: "Тарифы", url: "/tariffs", icon: LayoutGrid },
  { name: "Профиль", url: "/profile", icon: User },
];

export default function LkLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { hasPartner, hasSupport } = useLkNav();

  const navItems = [
    ...baseNavItems,
    ...(hasPartner ? [{ name: "Пригласить", url: "/partner", icon: Users }] : []),
    ...(hasSupport ? [{ name: "Поддержка", url: "/support", icon: Headphones }] : []),
  ];

  const handleLogout = async () => {
    await fetch("/api/lk/auth/logout", { method: "POST", credentials: "include" });
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <DotBackground />

      {/* Top nav */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 z-50 pt-4">
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 backdrop-blur-lg py-1 px-1 rounded-full shadow-lg">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.name}
                to={item.url}
                className={({ isActive }) =>
                  cn(
                    "relative cursor-pointer text-sm font-semibold px-5 py-2 rounded-full transition-colors duration-200",
                    "text-white/50 hover:text-white",
                    isActive && "text-white"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative z-10 hidden md:inline">{item.name}</span>
                    <span className="relative z-10 md:hidden"><Icon size={18} strokeWidth={2.5} /></span>
                    {isActive && (
                      <motion.div
                        layoutId="nav-lamp"
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
                  </>
                )}
              </NavLink>
            );
          })}
          <button
            onClick={handleLogout}
            className="ml-1 text-white/30 hover:text-white/70 transition-colors p-2 rounded-full hover:bg-white/5"
            title="Выйти"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 pt-24 pb-12 px-4 max-w-2xl mx-auto">
        {children}
      </div>
    </div>
  );
}
