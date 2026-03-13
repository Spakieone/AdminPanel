// Utility functions for date/time formatting in MSK (Moscow time, UTC+3)

/**
 * Parses a date string/number as UTC and returns Date object
 * Strings without timezone are treated as UTC
 */
function parseDateAsUtc(dateString: string | number | Date | null | undefined): Date {
  if (!dateString) return new Date()
  if (dateString instanceof Date) return dateString
  if (typeof dateString === 'number') {
    return new Date(dateString < 10_000_000_000 ? dateString * 1000 : dateString)
  }
  
  const s = String(dateString).trim()
  
  // Check if string has timezone indicator
  const hasTz = /z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)
  if (hasTz) {
    const parsed = new Date(s)
    return isNaN(parsed.getTime()) ? new Date() : parsed
  }
  
  // No timezone: treat as UTC by adding 'Z'
  const normalized = s.replace(' ', 'T')
  const withZ = normalized.endsWith('Z') ? normalized : normalized + 'Z'
  const parsed = new Date(withZ)
  return isNaN(parsed.getTime()) ? new Date() : parsed
}

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000

/**
 * Parses a date string/number that is ALREADY in MSK timezone
 * Converts MSK string to proper UTC Date internally
 * Use this when backend sends time already in MSK (like payments)
 */
function parseDateAsMsk(dateString: string | number | Date | null | undefined): Date {
  if (!dateString) return new Date()
  if (dateString instanceof Date) return dateString
  if (typeof dateString === 'number') {
    // Timestamps are always UTC
    return new Date(dateString < 10_000_000_000 ? dateString * 1000 : dateString)
  }
  
  const s = String(dateString).trim()
  
  // Check if string has timezone indicator
  const hasTz = /z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)
  if (hasTz) {
    const parsed = new Date(s)
    return isNaN(parsed.getTime()) ? new Date() : parsed
  }
  
  // No timezone: the string is in MSK (e.g. "00:59" means 00:59 MSK)
  // To convert to UTC, we parse as UTC then SUBTRACT 3 hours
  // Because if it's 00:59 MSK, it's 21:59 UTC (previous day)
  const normalized = s.replace(' ', 'T') + 'Z' // Parse as if it were UTC
  const parsed = new Date(normalized)
  if (isNaN(parsed.getTime())) return new Date()
  
  // Subtract MSK offset to get real UTC time
  // "00:59" parsed as UTC = 00:59 UTC, but we know it's 00:59 MSK = 21:59 UTC
  return new Date(parsed.getTime() - MOSCOW_OFFSET_MS)
}

/**
 * Parses a date string and returns Date object (treats strings as UTC)
 * Use for data that comes in UTC from backend
 */
export function parseMskDate(dateString: string | number | Date | null | undefined): Date {
  return parseDateAsUtc(dateString)
}

/**
 * Parses a date string as MSK time
 * Use for data that already comes in MSK from backend (like payments)
 */
export function parseMskDateLocal(dateString: string | number | Date | null | undefined): Date {
  return parseDateAsMsk(dateString)
}

/**
 * Formats a date as MSK time in Russian format: "11 января 2026 г. в 09:46"
 * USE FOR DATA IN UTC (like users) - converts UTC to MSK
 */
export function formatMskDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return '-'
  
  const d = parseDateAsUtc(date)
  
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  
  const parts = formatter.formatToParts(d)
  const day = parts.find(p => p.type === 'day')?.value || ''
  const month = parts.find(p => p.type === 'month')?.value || ''
  const year = parts.find(p => p.type === 'year')?.value || ''
  const hour = parts.find(p => p.type === 'hour')?.value || ''
  const minute = parts.find(p => p.type === 'minute')?.value || ''
  
  return `${day} ${month} ${year} г. в ${hour}:${minute}`
}

/**
 * Formats a date as MSK time - USE FOR DATA ALREADY IN MSK (like payments)
 * Parses the input as MSK, then displays in MSK
 */
export function formatMskDateTimeLocal(date: Date | string | number | null | undefined): string {
  if (!date) return '-'
  
  // Parse as MSK (converts to proper UTC internally)
  const d = parseDateAsMsk(date)
  
  // Now use Intl to display in MSK - it will correctly convert UTC to MSK
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  
  const parts = formatter.formatToParts(d)
  const day = parts.find(p => p.type === 'day')?.value || ''
  const month = parts.find(p => p.type === 'month')?.value || ''
  const year = parts.find(p => p.type === 'year')?.value || ''
  const hour = parts.find(p => p.type === 'hour')?.value || ''
  const minute = parts.find(p => p.type === 'minute')?.value || ''
  
  return `${day} ${month} ${year} г. в ${hour}:${minute}`
}

/**
 * Formats a date as MSK time in short format: "11.01.2026 09:46"
 * USE FOR DATA IN UTC - converts to MSK
 */
export function formatMskDateTimeShort(date: Date | string | number | null | undefined): string {
  if (!date) return '-'
  
  const d = parseDateAsUtc(date)
  
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  
  const parts = formatter.formatToParts(d)
  const day = parts.find(p => p.type === 'day')?.value || ''
  const month = parts.find(p => p.type === 'month')?.value || ''
  const year = parts.find(p => p.type === 'year')?.value || ''
  const hour = parts.find(p => p.type === 'hour')?.value || ''
  const minute = parts.find(p => p.type === 'minute')?.value || ''
  
  return `${day}.${month}.${year} ${hour}:${minute}`
}

/**
 * Formats a Date in the user's local timezone in Russian format: "11 января 2026 г. в 09:46"
 * Use for UI elements where "server MSK" confuses users in other timezones (e.g. notifications panel).
 */
export function formatLocalDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return '-'
  const d = date instanceof Date ? date : new Date(date as any)
  if (Number.isNaN(d.getTime())) return '-'

  const formatter = new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(d)
  const day = parts.find(p => p.type === 'day')?.value || ''
  const month = parts.find(p => p.type === 'month')?.value || ''
  const year = parts.find(p => p.type === 'year')?.value || ''
  const hour = parts.find(p => p.type === 'hour')?.value || ''
  const minute = parts.find(p => p.type === 'minute')?.value || ''

  return `${day} ${month} ${year} г. в ${hour}:${minute}`
}

/**
 * Converts a date to datetime-local input format (YYYY-MM-DDTHH:mm) in MSK
 */
export function toMskDateTimeLocal(date: Date | string | number | null | undefined): string {
  if (!date) return ''
  
  const d = parseDateAsUtc(date)
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  
  const parts = formatter.formatToParts(d)
  const year = parts.find(p => p.type === 'year')?.value || ''
  const month = parts.find(p => p.type === 'month')?.value || ''
  const day = parts.find(p => p.type === 'day')?.value || ''
  const hour = parts.find(p => p.type === 'hour')?.value || ''
  const minute = parts.find(p => p.type === 'minute')?.value || ''
  
  return `${year}-${month}-${day}T${hour}:${minute}`
}

/**
 * Parses datetime-local input as MSK and converts to UTC timestamp
 */
export function fromMskDateTimeLocal(datetimeLocal: string): number {
  if (!datetimeLocal) return 0
  
  const m = datetimeLocal.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (m) {
    const year = Number(m[1])
    const mon = Number(m[2]) - 1
    const day = Number(m[3])
    const hh = Number(m[4])
    const mm = Number(m[5])
    const mskAsUtc = Date.UTC(year, mon, day, hh, mm, 0, 0) - MOSCOW_OFFSET_MS
    return mskAsUtc
  }
  
  return new Date(datetimeLocal).getTime()
}
