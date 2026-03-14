import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

interface Tab {
  id: string
  label: string
  count?: number
}

interface GlassTabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (tabId: string) => void
  className?: string
}

export default function GlassTabs({ tabs, activeTab, onTabChange, className = '' }: GlassTabsProps) {
  return (
    <div className={cn("max-w-full relative", className)}>
      <div className="max-w-full overflow-x-auto no-scrollbar py-2">
        <div
          className={cn(
            "inline-flex w-fit items-center gap-3 whitespace-nowrap",
            "bg-base/80 border border-default backdrop-blur-lg py-1 px-1 rounded-full shadow-lg",
            "overflow-visible"
          )}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id

            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "relative shrink-0 cursor-pointer text-sm font-semibold px-6 py-2 rounded-full transition-colors",
                  isActive
                    ? "dark:text-white text-[var(--accent)]"
                    : "text-muted hover:text-secondary"
                )}
                style={{ zIndex: 10 }}
              >
                <span className="relative" style={{ zIndex: 20 }}>
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="ml-1.5 opacity-75">({tab.count})</span>
                  )}
                </span>
                {isActive && (
                  <motion.div
                    layoutId={`glass-tabs-lamp-${tabs.map(t => t.id).join('-')}`}
                    className="absolute inset-0 w-full rounded-full dark:bg-white/7"
                    style={{ zIndex: 0 }}
                    initial={false}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                    }}
                  >
                    {/* Top "lamp" — white in dark mode, accent in light mode */}
                    <div
                      className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-t-full dark:bg-white bg-[var(--accent)]"
                    >
                      <div className="absolute w-12 h-6 dark:bg-white/20 bg-[var(--accent)]/20 rounded-full blur-md -top-2 -left-2" />
                      <div className="absolute w-8 h-6 dark:bg-white/20 bg-[var(--accent)]/20 rounded-full blur-md -top-1" />
                      <div className="absolute w-4 h-4 dark:bg-white/20 bg-[var(--accent)]/20 rounded-full blur-sm top-0 left-2" />
                    </div>
                  </motion.div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
