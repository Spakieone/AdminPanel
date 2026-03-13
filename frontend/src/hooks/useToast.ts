import { useMemo, useRef, useState, useCallback } from 'react'
import type { Toast, ToastVariant } from '../components/common/ToastContainer'

let toastIdCounter = 0

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  // Deduplicate identical toasts for a short window to prevent spam loops.
  const lastShownRef = useRef<Map<string, number>>(new Map())
  const DEDUPE_WINDOW_MS = 1500

  const showToast = useCallback((
    variant: ToastVariant,
    title: string,
    description: string,
    duration: number = 4000
  ) => {
    const key = `${variant}||${String(title)}||${String(description)}`
    const now = Date.now()
    const last = lastShownRef.current.get(key) || 0
    if (now - last < DEDUPE_WINDOW_MS) {
      return `toast-skipped`
    }
    lastShownRef.current.set(key, now)

    const id = `toast-${++toastIdCounter}`
    const newToast: Toast = { id, variant, title, description, duration }

    setToasts((prev) => [...prev, newToast])

    // Автоматическое удаление через duration
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id)
      }, duration)
    }

    return id
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const showSuccess = useCallback((title: string, description: string, duration?: number) => {
    return showToast('success', title, description, duration)
  }, [showToast])

  const showError = useCallback((title: string, description: string, duration?: number) => {
    return showToast('error', title, description, duration)
  }, [showToast])

  const showWarning = useCallback((title: string, description: string, duration?: number) => {
    return showToast('warning', title, description, duration)
  }, [showToast])

  const showInfo = useCallback((title: string, description: string, duration?: number) => {
    return showToast('information', title, description, duration)
  }, [showToast])

  // Keep referential stability for consumers (except `toasts` list).
  return useMemo(() => ({
    toasts,
    showToast,
    removeToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
  }), [toasts, showToast, removeToast, showSuccess, showError, showWarning, showInfo])
}

