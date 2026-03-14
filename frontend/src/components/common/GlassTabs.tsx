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
      {/* Scroll only on X. Add vertical padding so the top "lamp" isn't clipped by the scroll container. */}
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
                  isActive ? "text-[var(--accent)]" : "text-muted hover:text-secondary"
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
                    className="absolute inset-0 w-full rounded-full"
                    style={{ zIndex: 0, background: 'rgba(255,255,255,0.07)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}
                    initial={false}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                    }}
                  >
                    {/* Top "lamp" */}
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-[var(--accent)] rounded-t-full">
                      <div className="absolute w-12 h-6 bg-accent-20 rounded-full blur-md -top-2 -left-2" />
                      <div className="absolute w-8 h-6 bg-accent-20 rounded-full blur-md -top-1" />
                      <div className="absolute w-4 h-4 bg-accent-20 rounded-full blur-sm top-0 left-2" />
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
