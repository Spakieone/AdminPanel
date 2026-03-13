/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { ToastVariant } from '../components/common/ToastContainer'

interface ToastContextType {
  showToast: (variant: ToastVariant, title: string, description: string, duration?: number) => string
  showSuccess: (title: string, description: string, duration?: number) => string
  showError: (title: string, description: string, duration?: number) => string
  showWarning: (title: string, description: string, duration?: number) => string
  showInfo: (title: string, description: string, duration?: number) => string
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function ToastProvider({ children, value }: { children: ReactNode; value: ToastContextType }) {
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToastContext() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToastContext must be used within ToastProvider')
  }
  return context
}

