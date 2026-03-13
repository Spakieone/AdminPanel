/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { NotificationsState } from '../hooks/useNotifications'

const NotificationsContext = createContext<NotificationsState | null>(null)

export function NotificationsProvider({ children, value }: { children: ReactNode; value: NotificationsState }) {
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotificationsContext(): NotificationsState {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotificationsContext must be used within NotificationsProvider')
  return ctx
}

