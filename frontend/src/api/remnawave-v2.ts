import { apiFetch } from './client'

const BASE = '/webpanel/api/remnawave/rw'

// ── Generic helpers ──────────────────────────────────────────────────────────

/** Encode each path segment to prevent path traversal via UUIDs or other user input */
function safePath(path: string): string {
  return path.replace(/^\//, '').split('/').map(seg => encodeURIComponent(seg)).join('/')
}

function buildUrl(path: string, profileId?: string | null): string {
  const url = new URL(`${BASE}/${safePath(path)}`, window.location.origin)
  if (profileId) url.searchParams.set('profile_id', profileId)
  return url.pathname + url.search
}

function addParams(url: string, params?: Record<string, string | number | boolean | null | undefined>): string {
  if (!params) return url
  const u = new URL(url, window.location.origin)
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') u.searchParams.set(k, String(v))
  })
  return u.pathname + u.search
}

async function rwv2Get(path: string, params?: Record<string, any>, profileId?: string | null): Promise<any> {
  let url = buildUrl(path, profileId)
  if (params) url = addParams(url, params)
  const r = await apiFetch(url)
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err?.detail || err?.message || `HTTP ${r.status}`)
  }
  return r.json()
}

async function rwv2Post(path: string, body?: any, profileId?: string | null): Promise<any> {
  const url = buildUrl(path, profileId)
  const r = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err?.detail || err?.message || `HTTP ${r.status}`)
  }
  return r.json().catch(() => ({}))
}

async function rwv2Patch(path: string, body?: any, profileId?: string | null): Promise<any> {
  const url = buildUrl(path, profileId)
  const r = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err?.detail || err?.message || `HTTP ${r.status}`)
  }
  return r.json().catch(() => ({}))
}

async function rwv2Delete(path: string, profileId?: string | null): Promise<any> {
  const url = buildUrl(path, profileId)
  const r = await apiFetch(url, { method: 'DELETE' })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err?.detail || err?.message || `HTTP ${r.status}`)
  }
  return r.json().catch(() => ({}))
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface RwUserParams {
  page?: number
  per_page?: number
  search?: string
  status?: string
  sort_by?: string
  sort_order?: string
}

export const getRwUsers = (params?: RwUserParams, profileId?: string) =>
  rwv2Get('users', params as any, profileId)

export const deleteRwUser = (uuid: string, profileId?: string) =>
  rwv2Delete(`users/${uuid}`, profileId)

export const enableRwUser = (uuid: string, profileId?: string) =>
  rwv2Post(`users/${uuid}/enable`, undefined, profileId)

export const disableRwUser = (uuid: string, profileId?: string) =>
  rwv2Post(`users/${uuid}/disable`, undefined, profileId)

export const resetRwUserTraffic = (uuid: string, profileId?: string) =>
  rwv2Post(`users/${uuid}/reset-traffic`, undefined, profileId)

export const getRwSystemStats = (profileId?: string) =>
  rwv2Get('system/stats', undefined, profileId)

// ── Nodes ────────────────────────────────────────────────────────────────────

export const getRwNodesV2 = (profileId?: string) =>
  rwv2Get('nodes', undefined, profileId)

export const getRwNodesMetrics = (profileId?: string) =>
  rwv2Get('system/nodes/metrics', undefined, profileId)

export const getRwNodesBandwidthRealtime = (profileId?: string) =>
  rwv2Get('bandwidth-stats/nodes/realtime', undefined, profileId)

export const createRwNode = (data: any, profileId?: string) =>
  rwv2Post('nodes', data, profileId)

export const updateRwNode = (uuid: string, data: any, profileId?: string) =>
  rwv2Patch(`nodes/${uuid}`, data, profileId)

export const restartRwNode = (uuid: string, profileId?: string) =>
  rwv2Post(`nodes/${uuid}/restart`, undefined, profileId)

export const enableRwNodeV2 = (uuid: string, profileId?: string) =>
  rwv2Post(`nodes/${uuid}/enable`, undefined, profileId)

export const disableRwNodeV2 = (uuid: string, profileId?: string) =>
  rwv2Post(`nodes/${uuid}/disable`, undefined, profileId)

