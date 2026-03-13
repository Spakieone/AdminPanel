import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Persists filter values in sessionStorage so they survive page navigation
 * but reset on browser tab close.
 *
 * @param key    Unique storage key, e.g. 'payments-filters'
 * @param init   Default values if nothing is stored yet (must be stable object)
 */
export function useSessionFilters<T extends Record<string, string | number>>(
  key: string,
  init: T
): [T, <K extends keyof T>(field: K, value: T[K]) => void, () => void] {
  // Keep init stable across renders via ref
  const initRef = useRef(init)

  const [filters, setFilters] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<T>
        return { ...initRef.current, ...parsed }
      }
    } catch {
      // ignore parse errors
    }
    return initRef.current
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(filters))
    } catch {
      // ignore storage errors
    }
  }, [key, filters])

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setFilters((prev) => ({ ...prev, [field]: value }))
  }, [])

  const reset = useCallback(() => {
    setFilters(initRef.current)
    try {
      sessionStorage.removeItem(key)
    } catch {
      // ignore
    }
  }, [key])

  return [filters, setField, reset]
}
