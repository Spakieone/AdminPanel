// API клиент для работы с ботом
// Авторизация: заголовок X-Token и параметр tg_id в query string

import { getAuthHeaders, refreshCsrfToken } from './client'

import type {
  BotUser,
  BotKey,
  BotKeyCreateRequest,
  BotKeyUpdateRequest,
  BotServer,
  BotServerCreateRequest,
  BotServerUpdateRequest,
  BotTariff,
  BotTariffCreateRequest,
  BotTariffUpdateRequest,
  BotPayment,
  BotReferral,
  BotCoupon,
  BotCouponCreateRequest,
  BotCouponUpdateRequest,
  BotGift,
  BotGiftCreateRequest,
  BotGiftUpdateRequest,
  BotUtmTag,
  BotManualBan,
  BotBlockedUser,
  ErrorResponse,
  ErrorDetail
} from './types'

export interface BotApiConfig {
  tgId: number;
  botApiUrl: string;
}

// Paginated response from new module API
export interface PaginatedResponse<T> {
  ok: boolean;
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// Helper to extract items from paginated or array response
function extractItems<T>(data: T[] | PaginatedResponse<T> | { items?: T[] }): T[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) {
    return data.items;
  }
  return [];
}

function getBotHeaders() {
  // Токен добавляется на сервере в прокси из активного профиля
  // Не передаем токен с frontend для безопасности
  return {
    'Content-Type': 'application/json'
  };
}

function getBotParams(config: BotApiConfig) {
  return new URLSearchParams({ tg_id: config.tgId.toString() });
}

function getBotApiBase(_config: BotApiConfig): string {
  const API_BASE = '/webpanel'
  return `${API_BASE}/api/bot-proxy`
}

interface ErrorWithStatus extends Error {
  status?: number
  response?: Response
}

async function handleBotResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = 'Ошибка запроса';
    try {
      const errorData = await response.json() as ErrorResponse | string;
      
      // Обрабатываем разные форматы ошибок
      if (typeof errorData === 'object' && errorData !== null && Array.isArray(errorData.detail)) {
        // FastAPI validation errors
        errorMessage = errorData.detail.map((err: ErrorDetail | string) => {
          if (typeof err === 'string') return err;
          const field = err.loc ? err.loc.join('.') : 'field';
          const msg = err.msg || 'validation error';
          return `${field}: ${msg}`;
        }).join(', ');
      } else if (typeof errorData === 'object' && errorData !== null && errorData.detail) {
        errorMessage = String(errorData.detail);
      } else if (typeof errorData === 'object' && errorData !== null && errorData.message) {
        errorMessage = String(errorData.message);
      } else if (typeof errorData === 'string') {
        errorMessage = errorData;
      } else {
        errorMessage = JSON.stringify(errorData);
      }
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    const error = new Error(errorMessage) as ErrorWithStatus;
    error.status = response.status;
    error.response = response;
    throw error;
  }
  return await response.json();
}

// Users API
// NOTE: getBotUsers (full list) removed — use getCachedUsers with pagination (client.ts)

export async function getBotUser(config: BotApiConfig, tgId: number): Promise<BotUser> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/users/${tgId}?${params}`, {
    headers: getBotHeaders(),
  });
  const data: any = await handleBotResponse<any>(response);
  // AdminPanel module API returns { ok: true, user: {...} }, older Bot API may return the user directly.
  if (data && typeof data === 'object' && 'user' in data) return data.user as BotUser;
  return data as BotUser;
}

export async function deleteBotUser(config: BotApiConfig, tgId: number) {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

// Keys API
// NOTE: getBotKeys (full list) removed — use getCachedKeys with pagination (client.ts)

export async function getBotKeysByTgId(config: BotApiConfig, tgId: number): Promise<BotKey[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  params.append('user_tg_id', tgId.toString());
  const response = await fetch(`${baseUrl}/keys/?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotKey[] | PaginatedResponse<BotKey>>(response);
  return extractItems(data);
}

export async function getBotKey(config: BotApiConfig, keyIdentifier: string): Promise<BotKey> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const response = await fetch(`${baseUrl}/keys/${encodeURIComponent(keyIdentifier)}?${params}`, {
    headers: getBotHeaders(),
    credentials: 'include',
  })
  const res: any = await handleBotResponse<any>(response)
  if (res && typeof res === 'object' && 'key' in res) return res.key as BotKey
  return res as BotKey
}

export async function createBotKey(config: BotApiConfig, data: BotKeyCreateRequest): Promise<BotKey> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/keys/create?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotKey>(response);
}

export async function updateBotKey(config: BotApiConfig, keyIdentifier: string, data: BotKeyUpdateRequest): Promise<BotKey> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  await refreshCsrfToken();
  const headers = await getAuthHeaders();
  const response = await fetch(`${baseUrl}/keys/${encodeURIComponent(keyIdentifier)}?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
    credentials: 'include',
  });
  const res: any = await handleBotResponse<any>(response);
  // AdminPanel module API returns { ok: true, key: {...} }, older APIs may return key directly.
  if (res && typeof res === 'object' && 'key' in res) return res.key as BotKey;
  return res as BotKey;
}

export async function updateBotKeyByEmail(config: BotApiConfig, email: string, data: BotKeyUpdateRequest): Promise<BotKey> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/keys/edit/by_email/${encodeURIComponent(email)}?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  const res: any = await handleBotResponse<any>(response);
  if (res && typeof res === 'object' && 'key' in res) return res.key as BotKey;
  return res as BotKey;
}

export async function deleteBotKey(config: BotApiConfig, keyIdentifier: string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  await refreshCsrfToken();
  const headers = await getAuthHeaders();
  const response = await fetch(`${baseUrl}/keys/${encodeURIComponent(keyIdentifier)}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  return handleBotResponse(response);
}

export async function getKeyTraffic(config: BotApiConfig, keyIdentifier: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  // Use GET to avoid CSRF requirements on the AdminPanel backend proxy.
  const response = await fetch(`${baseUrl}/keys/${encodeURIComponent(keyIdentifier)}/traffic?${params}`, {
    method: 'GET',
    headers: getBotHeaders(),
  })
  const res: any = await handleBotResponse<any>(response)
  return res?.traffic ?? res
}

export async function resetKeyTraffic(config: BotApiConfig, keyIdentifier: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/keys/${encodeURIComponent(keyIdentifier)}/traffic/reset?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function reissueKeyFull(config: BotApiConfig, keyIdentifier: string, target?: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/keys/${encodeURIComponent(keyIdentifier)}/reissue/full?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ target: target || null }),
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function reissueKeyLink(config: BotApiConfig, keyIdentifier: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/keys/${encodeURIComponent(keyIdentifier)}/reissue/link?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  const res: any = await handleBotResponse<any>(response)
  return res?.key ?? res
}

export async function saveKeyConfig(
  config: BotApiConfig,
  keyIdentifier: string,
  data: { base_devices: number; extra_devices: number; base_traffic_gb: number; extra_traffic_gb: number }
): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/keys/${encodeURIComponent(keyIdentifier)}/config?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
    credentials: 'include',
  })
  const res: any = await handleBotResponse<any>(response)
  return res?.key ?? res
}

export async function deleteBotKeyByEmail(config: BotApiConfig, email: string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  
  // Согласно документации API: /api/keys/by_email/{email} с методом DELETE
  const response = await fetch(`${baseUrl}/keys/by_email/${encodeURIComponent(email)}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  
  return handleBotResponse(response);
}

// Servers API
export async function getBotServers(config: BotApiConfig): Promise<BotServer[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/servers?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotServer[] | PaginatedResponse<BotServer>>(response);
  return extractItems(data);
}

export async function createBotServer(config: BotApiConfig, data: BotServerCreateRequest): Promise<BotServer> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/servers?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotServer>(response);
}

export async function updateBotServer(config: BotApiConfig, identifier: number | string, data: BotServerUpdateRequest): Promise<BotServer> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // API использует server_name как идентификатор, не ID
  const idOrName = encodeURIComponent(String(identifier));
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/servers/${idOrName}?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotServer>(response);
}

export async function deleteBotServer(config: BotApiConfig, identifier: number | string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // API использует server_name как идентификатор, не ID
  const idOrName = encodeURIComponent(String(identifier));
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/servers/${idOrName}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  return handleBotResponse(response);
}

// Tariffs API
export async function getBotTariffs(config: BotApiConfig): Promise<BotTariff[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Avoid FastAPI trailing-slash redirect noise (307).
  const response = await fetch(`${baseUrl}/tariffs?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotTariff[] | PaginatedResponse<BotTariff>>(response);
  return extractItems(data);
}

export async function createBotTariff(config: BotApiConfig, data: BotTariffCreateRequest): Promise<BotTariff> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/tariffs?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotTariff>(response);
}

export async function updateBotTariff(config: BotApiConfig, name: string, data: BotTariffUpdateRequest): Promise<BotTariff> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  // API использует имя тарифа в URL (правильно экранированное)
  const encodedName = encodeURIComponent(String(name));
  const response = await fetch(`${baseUrl}/tariffs/${encodedName}?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotTariff>(response);
}

// Safer tariff update via module API (by numeric id; name is not unique in DB).
export async function updateBotTariffById(config: BotApiConfig, tariffId: number, data: BotTariffUpdateRequest): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/tariffs/${encodeURIComponent(String(tariffId))}?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data || {}),
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function deleteBotTariff(config: BotApiConfig, name: string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  // API использует имя тарифа в URL (правильно экранированное)
  const encodedName = encodeURIComponent(String(name));
  const response = await fetch(`${baseUrl}/tariffs/${encodedName}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  return handleBotResponse(response);
}

export async function deleteBotTariffById(config: BotApiConfig, tariffId: number) {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/tariffs/${encodeURIComponent(String(tariffId))}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  })
  return handleBotResponse(response)
}

// Payments API
// NOTE: getBotPayments (full list) removed — use getCachedPayments with pagination (client.ts)

export async function getBotPaymentsByTgId(config: BotApiConfig, tgId: number): Promise<BotPayment[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  params.append('user_tg_id', tgId.toString());
  params.append('limit', '200');
  const response = await fetch(`${baseUrl}/payments?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotPayment[] | PaginatedResponse<BotPayment>>(response);
  return extractItems(data);
}

// Referrals API
// NOTE: getBotReferrals (full list) removed — use getBotReferralsPage with pagination

export async function getBotReferralsPage(
  config: BotApiConfig,
  opts: { page?: number; limit?: number; referrer_tg_id?: number } = {},
): Promise<PaginatedResponse<BotReferral>> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  if (opts.page) params.append('page', String(opts.page))
  if (opts.limit) params.append('limit', String(opts.limit))
  if (opts.referrer_tg_id) params.append('referrer_tg_id', String(opts.referrer_tg_id))

  const response = await fetch(`${baseUrl}/referrals?${params}`, {
    headers: getBotHeaders(),
  })
  const data = await handleBotResponse<BotReferral[] | PaginatedResponse<BotReferral>>(response)
  if (Array.isArray(data)) {
    return { ok: true, items: data, total: data.length, page: 1, limit: data.length || (opts.limit || 50), pages: 1 }
  }
  if (data && typeof data === 'object' && Array.isArray((data as any).items)) {
    return data as PaginatedResponse<BotReferral>
  }
  return { ok: true, items: [], total: 0, page: opts.page || 1, limit: opts.limit || 50, pages: 1 }
}

export async function getBotReferralsAll(config: BotApiConfig, tgId: number): Promise<BotReferral[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  params.append('referrer_tg_id', tgId.toString());
  const response = await fetch(`${baseUrl}/referrals?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotReferral[] | PaginatedResponse<BotReferral>>(response);
  return extractItems(data);
}

export async function deleteBotReferral(config: BotApiConfig, referrerTgId: number, referredTgId: number) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/referrals/one?${params}&referrer_tg_id=${referrerTgId}&referred_tg_id=${referredTgId}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  return handleBotResponse(response);
}

// Coupons API
// NOTE: getBotCoupons (full list) removed — use getBotCouponsPage with pagination

export async function getBotCouponsPage(
  config: BotApiConfig,
  opts: { page?: number; limit?: number; search?: string } = {},
): Promise<PaginatedResponse<BotCoupon>> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  if (opts.page) params.append('page', String(opts.page))
  if (opts.limit) params.append('limit', String(opts.limit))
  if (opts.search) params.append('search', String(opts.search))

  const response = await fetch(`${baseUrl}/coupons?${params}`, {
    headers: getBotHeaders(),
  })
  const data = await handleBotResponse<BotCoupon[] | PaginatedResponse<BotCoupon>>(response)
  if (Array.isArray(data)) {
    return { ok: true, items: data, total: data.length, page: 1, limit: data.length || (opts.limit || 50), pages: 1 }
  }
  if (data && typeof data === 'object' && Array.isArray((data as any).items)) {
    return data as PaginatedResponse<BotCoupon>
  }
  return { ok: true, items: [], total: 0, page: opts.page || 1, limit: opts.limit || 50, pages: 1 }
}

export async function createBotCoupon(config: BotApiConfig, data: BotCouponCreateRequest): Promise<BotCoupon> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/coupons/?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotCoupon>(response);
}

export async function updateBotCoupon(config: BotApiConfig, id: number | string, data: BotCouponUpdateRequest): Promise<BotCoupon> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  // Кодируем ID/код купона для URL (на случай если это строка с спецсимволами)
  const encodedId = encodeURIComponent(String(id));
  const response = await fetch(`${baseUrl}/coupons/${encodedId}?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotCoupon>(response);
}

export async function deleteBotCoupon(config: BotApiConfig, id: number | string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  // Кодируем ID/код купона для URL (на случай если это строка с спецсимволами)
  const encodedId = encodeURIComponent(String(id));
  const response = await fetch(`${baseUrl}/coupons/${encodedId}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  return handleBotResponse(response);
}

// Gifts API
// NOTE: getBotGifts (full list) removed — use getBotGiftsPage with pagination

export async function getBotGiftsPage(
  config: BotApiConfig,
  opts: { page?: number; limit?: number } = {},
): Promise<PaginatedResponse<BotGift>> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  if (opts.page) params.append('page', String(opts.page))
  if (opts.limit) params.append('limit', String(opts.limit))

  const response = await fetch(`${baseUrl}/gifts?${params}`, {
    headers: getBotHeaders(),
  })
  const data = await handleBotResponse<BotGift[] | PaginatedResponse<BotGift>>(response)
  if (Array.isArray(data)) {
    return { ok: true, items: data, total: data.length, page: 1, limit: data.length || (opts.limit || 50), pages: 1 }
  }
  if (data && typeof data === 'object' && Array.isArray((data as any).items)) {
    return data as PaginatedResponse<BotGift>
  }
  return { ok: true, items: [], total: 0, page: opts.page || 1, limit: opts.limit || 50, pages: 1 }
}

export async function createBotGift(config: BotApiConfig, data: BotGiftCreateRequest): Promise<BotGift> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const response = await fetch(`${baseUrl}/gifts/?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotGift>(response);
}

export async function updateBotGift(config: BotApiConfig, id: number | string, data: BotGiftUpdateRequest): Promise<BotGift> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const encodedId = encodeURIComponent(String(id));
  const response = await fetch(`${baseUrl}/gifts/${encodedId}?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
    credentials: 'include'
  });
  return handleBotResponse<BotGift>(response);
}

export async function deleteBotGift(config: BotApiConfig, id: number | string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const encodedId = encodeURIComponent(String(id));
  const response = await fetch(`${baseUrl}/gifts/${encodedId}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  return handleBotResponse(response);
}

// UTM метки API (используем tracking-sources)
// Легкий список источников (без загрузки статистики для каждого)
export async function getBotTrackingSources(config: BotApiConfig): Promise<BotUtmTag[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/tracking-sources?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotUtmTag[] | PaginatedResponse<BotUtmTag>>(response);
  return extractItems(data);
}

export async function getBotUtmTags(config: BotApiConfig): Promise<BotUtmTag[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/tracking-sources?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotUtmTag[] | PaginatedResponse<BotUtmTag>>(response);
  const sources = extractItems(data);
  
  // Загружаем статистику для каждого источника параллельно
  if (Array.isArray(sources) && sources.length > 0) {
    const sourcesWithStats = await Promise.all(
      sources.map(async (source: BotUtmTag) => {
        try {
          const code = source.code;
          if (!code) {
            return {
              ...source,
              registrations: 0,
              trials: 0,
              payments: 0,
              total_amount: 0
            };
          }
          
          // Загружаем статистику через /stats эндпоинт
          const statsResponse = await fetch(`${baseUrl}/tracking-sources/${encodeURIComponent(code)}/stats?${params}`, {
            headers: getBotHeaders(),
          });
          const statsData = await handleBotResponse<{ ok: boolean; source: BotUtmTag; stats: { registrations: number; trials: number; payments: number; total_amount: number } }>(statsResponse);
          return {
            ...source,
            ...statsData.source,
            registrations: statsData.stats?.registrations || 0,
            trials: statsData.stats?.trials || 0,
            payments: statsData.stats?.payments || 0,
            total_amount: statsData.stats?.total_amount || 0,
          };
        } catch {
          // Если не удалось загрузить статистику, возвращаем источник с нулевой статистикой
          return {
            ...source,
            registrations: 0,
            trials: 0,
            payments: 0,
            total_amount: 0
          };
        }
      })
    );
    return sourcesWithStats;
  }
  
  return sources;
}

export async function getBotUtmTagStats(config: BotApiConfig, code: string): Promise<BotUtmTag> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/tracking-sources/${encodeURIComponent(code)}/stats?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<{
    ok: boolean
    source: BotUtmTag
    stats: { registrations: number; trials: number; payments: number; total_amount: number }
    monthly?: any[]
  }>(response)
  return {
    ...data.source,
    registrations: data.stats?.registrations || 0,
    trials: data.stats?.trials || 0,
    payments: data.stats?.payments || 0,
    total_amount: data.stats?.total_amount || 0,
    monthly: Array.isArray((data as any)?.monthly) ? ((data as any).monthly as any[]) : undefined,
  };
}

// UTM Daily Stats (aggregated server-side) 
export interface UtmDailyStat {
  date: string; // YYYY-MM-DD
  registrations: number;
  trials: number;
  new_purchases_count: number;
  new_purchases_amount: number;
  repeat_purchases_count: number;
  repeat_purchases_amount: number;
}
export interface UtmDailyResponse {
  code: string;
  daily: UtmDailyStat[];
}

export async function getUtmDailyStats(config: BotApiConfig, code: string): Promise<UtmDailyResponse> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/tracking-sources/${encodeURIComponent(code)}/daily?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<{ ok: boolean; code: string; daily: UtmDailyStat[] }>(response);
  return { code: data.code || code, daily: data.daily || [] };
}

export async function deleteBotUtmTag(config: BotApiConfig, id: number | string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const encodedId = encodeURIComponent(String(id));
  const response = await fetch(`${baseUrl}/tracking-sources/${encodedId}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  return handleBotResponse(response);
}

// Misc API (Bans, Notifications)
export async function getBotManualBans(config: BotApiConfig, limit: number = 500): Promise<BotManualBan[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/manual-bans?${params}&limit=${limit}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotManualBan[] | PaginatedResponse<BotManualBan>>(response);
  return extractItems(data);
}

export async function getBotBlockedUsers(config: BotApiConfig, limit: number = 500): Promise<BotBlockedUser[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/blocked-users?${params}&limit=${limit}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<BotBlockedUser[] | PaginatedResponse<BotBlockedUser>>(response);
  return extractItems(data);
}

export async function getBotManualBansPage(
  config: BotApiConfig,
  page: number = 1,
  limit: number = 50,
): Promise<PaginatedResponse<BotManualBan>> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/manual-bans?${params}&page=${page}&limit=${limit}`, {
    headers: getBotHeaders(),
  });
  return handleBotResponse<PaginatedResponse<BotManualBan>>(response);
}

export async function getBotBlockedUsersPage(
  config: BotApiConfig,
  page: number = 1,
  limit: number = 50,
): Promise<PaginatedResponse<BotBlockedUser>> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/blocked-users?${params}&page=${page}&limit=${limit}`, {
    headers: getBotHeaders(),
  });
  return handleBotResponse<PaginatedResponse<BotBlockedUser>>(response);
}

async function _fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<PaginatedResponse<T>>,
  limit: number,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  while (true) {
    const data = await fetchPage(page, limit);
    const items = Array.isArray(data?.items) ? data.items : [];
    all.push(...items);
    const totalPages = Number((data as any)?.pages ?? (data as any)?.total_pages ?? 1) || 1;
    if (page >= totalPages) break;
    page += 1;
  }
  return all;
}

export async function getAllBotManualBans(config: BotApiConfig): Promise<BotManualBan[]> {
  // manual-bans обычно мало, но пусть будет корректно
  return _fetchAllPages((page, limit) => getBotManualBansPage(config, page, limit), 500);
}

export async function getAllBotBlockedUsers(config: BotApiConfig): Promise<BotBlockedUser[]> {
  // blocked-users может быть много (1500+), берём все страницы по 500
  return _fetchAllPages((page, limit) => getBotBlockedUsersPage(config, page, limit), 500);
}

// Get total counts for banned users (for counter)
export async function getBotBannedCounts(config: BotApiConfig): Promise<{ manualBans: number; blockedUsers: number }> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const [manualRes, blockedRes] = await Promise.all([
    fetch(`${baseUrl}/manual-bans?${params}&limit=1`, { headers: getBotHeaders() }),
    fetch(`${baseUrl}/blocked-users?${params}&limit=1`, { headers: getBotHeaders() }),
  ]);
  const [manualData, blockedData] = await Promise.all([
    handleBotResponse<PaginatedResponse<any>>(manualRes),
    handleBotResponse<PaginatedResponse<any>>(blockedRes),
  ]);
  return {
    manualBans: (manualData as any)?.total || 0,
    blockedUsers: (blockedData as any)?.total || 0,
  };
}

export async function deleteBotManualBan(config: BotApiConfig, tgId: number | string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const encodedTgId = encodeURIComponent(String(tgId));
  const response = await fetch(`${baseUrl}/manual-bans/${encodedTgId}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  return handleBotResponse(response);
}

export async function deleteBotBlockedUser(config: BotApiConfig, tgId: number | string) {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  // Обновляем CSRF токен перед мутационной операцией
  await refreshCsrfToken();
  const headers = await getAuthHeaders(); // Используем getAuthHeaders для CSRF токена
  const encodedTgId = encodeURIComponent(String(tgId));
  const response = await fetch(`${baseUrl}/blocked-users/${encodedTgId}?${params}`, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  return handleBotResponse(response);
}

// -----------------------
// Payment Providers API
// -----------------------

export async function getPaymentProviders(config: BotApiConfig): Promise<string[]> {
  const baseUrl = getBotApiBase(config);
  const params = getBotParams(config);
  const response = await fetch(`${baseUrl}/payment-providers?${params}`, {
    headers: getBotHeaders(),
  });
  const data = await handleBotResponse<{ ok: boolean; providers: string[] }>(response);
  return data.providers || [];
}

// -----------------------
// UTM / Tracking Sources - Users & Stats
// -----------------------

// -----------------------
// Module AdminPanel API (panel/*)
// Bot module API (status, modules, systemd, logs, settings, broadcast)
// -----------------------

export type ModuleAdminpanelStatus = Record<string, any> & { ok?: boolean }

export async function getModuleStatus(config: BotApiConfig): Promise<ModuleAdminpanelStatus> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const response = await fetch(`${baseUrl}/status?${params}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse<ModuleAdminpanelStatus>(response)
}

export async function getModuleModules(config: BotApiConfig): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const response = await fetch(`${baseUrl}/modules?${params}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse<any>(response)
}

export async function enableModule(config: BotApiConfig, name: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/modules/${encodeURIComponent(name)}/enable?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function disableModule(config: BotApiConfig, name: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/modules/${encodeURIComponent(name)}/disable?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function getSystemdStatus(config: BotApiConfig, unit: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const response = await fetch(`${baseUrl}/systemd/status?${params}&unit=${encodeURIComponent(unit)}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse<any>(response)
}

export async function restartBotService(config: BotApiConfig): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/actions/restart-bot?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function getJournalLogs(
  config: BotApiConfig,
  opts: { unit: string; lines?: number; since?: string },
): Promise<{ ok: boolean; unit: string; lines: number; items: string[] }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const qp = new URLSearchParams(params)
  qp.set('unit', opts.unit)
  if (typeof opts.lines === 'number') qp.set('lines', String(opts.lines))
  if (opts.since) qp.set('since', String(opts.since))

  const response = await fetch(`${baseUrl}/logs/journal?${qp.toString()}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse(response)
}

export async function getBotAdminSettings(config: BotApiConfig): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const response = await fetch(`${baseUrl}/bot/settings?${params}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse<any>(response)
}

export async function patchBotButtonsSettings(config: BotApiConfig, payload: Record<string, any>): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/bot/settings/buttons?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function toggleBotButton(config: BotApiConfig, key: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/bot/settings/buttons/${encodeURIComponent(key)}/toggle?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function patchBotCashboxesSettings(config: BotApiConfig, payload: Record<string, any>): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/bot/settings/cashboxes?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function toggleBotCashbox(config: BotApiConfig, key: string): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/bot/settings/cashboxes/${encodeURIComponent(key)}/toggle?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function patchBotModesSettings(config: BotApiConfig, payload: Record<string, any>): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/bot/settings/modes?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function patchBotNotificationsSettings(config: BotApiConfig, payload: Record<string, any>): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/bot/settings/notifications?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function patchBotMoneySettings(config: BotApiConfig, payload: Record<string, any>): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/bot/settings/money?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

export async function patchBotTariffsSettings(config: BotApiConfig, payload: Record<string, any>): Promise<any> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/bot/settings/tariffs?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  })
  return handleBotResponse<any>(response)
}

// -----------------------
// User balance operations (module API)
// -----------------------

export async function addUserBalance(
  config: BotApiConfig,
  tgId: number,
  amount: number,
  note?: string,
): Promise<{ ok: boolean; tg_id: number; balance: number }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/balance/add?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount, note }),
    credentials: 'include',
  })
  return handleBotResponse(response)
}

export async function takeUserBalance(
  config: BotApiConfig,
  tgId: number,
  amount: number,
  note?: string,
): Promise<{ ok: boolean; tg_id: number; balance: number; deducted: number }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/balance/take?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount, note }),
    credentials: 'include',
  })
  return handleBotResponse(response)
}

export async function setUserBalance(
  config: BotApiConfig,
  tgId: number,
  amount: number,
  note?: string,
): Promise<{ ok: boolean; tg_id: number; balance: number; delta: number }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/balance/set?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount, note }),
    credentials: 'include',
  })
  return handleBotResponse(response)
}

// -----------------------
// Sender / Broadcast (module API)
// -----------------------

export type BroadcastSendTo = 'all' | 'subscribed' | 'unsubscribed' | 'trial' | 'untrial' | 'hotleads' | 'cluster' | 'tg_id'

export type BroadcastButton = {
  text: string
  url?: string
  callback?: string
}

export type BroadcastJob = {
  id: string
  state: 'queued' | 'running' | 'done' | 'failed'
  created_at?: string
  updated_at?: string
  total?: number | null
  sent?: number | null
  stats?: any
  error?: string | null
  params?: any
}

export async function startBroadcast(
  config: BotApiConfig,
  payload: {
    send_to: BroadcastSendTo
    cluster_name?: string
    tg_id?: number
    text: string
    photo?: string
    buttons?: BroadcastButton[]
    workers?: number
    messages_per_second?: number
    limit?: number
    dry_run?: boolean
  },
): Promise<{ ok: boolean; job: BroadcastJob }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/broadcast?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload || {}),
    credentials: 'include',
  })
  return handleBotResponse(response)
}

export async function getBroadcastJob(config: BotApiConfig, jobId: string): Promise<{ ok: boolean; job: BroadcastJob }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const response = await fetch(`${baseUrl}/broadcast/${encodeURIComponent(jobId)}?${params}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse(response)
}

export async function listBroadcastJobs(
  config: BotApiConfig,
  limit = 30,
): Promise<{ ok: boolean; items: BroadcastJob[] }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const qp = new URLSearchParams(params)
  qp.set('limit', String(limit))
  const response = await fetch(`${baseUrl}/broadcast?${qp.toString()}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse(response)
}

// -----------------------
// Bot Management Actions (backup, restore trials, maintenance)
// -----------------------

export interface MaintenanceStatus {
  ok: boolean
  maintenance_enabled: boolean
  message?: string
}

export interface BackupResult {
  ok: boolean
  message: string
}

export interface RestoreTrialsResult {
  ok: boolean
  restored_count: number
  message: string
}

export async function getMaintenanceStatus(config: BotApiConfig): Promise<MaintenanceStatus> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const response = await fetch(`${baseUrl}/management/maintenance?${params}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse<MaintenanceStatus>(response)
}

export async function toggleMaintenance(config: BotApiConfig): Promise<MaintenanceStatus> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/management/maintenance/toggle?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<MaintenanceStatus>(response)
}

export async function createBackup(config: BotApiConfig): Promise<BackupResult> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/management/backup?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<BackupResult>(response)
}

export type ManagementMetrics = {
  ok: boolean
  ts?: number
  iso?: string
  system?: {
    cpu_pct?: number | null
    cpu_cores?: number
    load1?: number | null
    load5?: number | null
    load15?: number | null
    mem_total_mb?: number | null
    mem_used_mb?: number | null
    mem_used_pct?: number | null
    swap_total_mb?: number | null
    swap_used_mb?: number | null
    swap_used_pct?: number | null
    disk_total_gb?: number | null
    disk_used_gb?: number | null
    disk_used_pct?: number | null
  }
  network?: {
    rx_mb_s?: number | null
    tx_mb_s?: number | null
  }
  bot?: {
    unit?: string
    pid?: number | null
    cpu_pct?: number | null
    rss_mb?: number | null
  }
  gpu?: {
    ok?: boolean
    vendor?: string | null
    gpu_pct?: number | null
    vram_used_mb?: number | null
    vram_total_mb?: number | null
  }
}

export async function getManagementMetrics(config: BotApiConfig): Promise<ManagementMetrics> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const response = await fetch(`${baseUrl}/management/metrics?${params}`, {
    headers: getBotHeaders(),
  })
  return handleBotResponse<ManagementMetrics>(response)
}

export async function restoreTrials(config: BotApiConfig): Promise<RestoreTrialsResult> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  await refreshCsrfToken()
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/management/restore-trials?${params}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<RestoreTrialsResult>(response)
}

// ==================== ПАРТНЁРСКАЯ ПРОГРАММА ====================

export interface PartnerStats {
  ok: boolean
  total_partners: number
  total_referred: number
  referred_today?: number
  referred_yesterday?: number
  referred_week?: number
  referred_month?: number
  total_balance: number
  pending_withdrawals_count: number
  pending_withdrawals_amount: number
  paid_today_amount: number
  paid_yesterday_amount?: number
  paid_week_amount?: number
  paid_month_amount: number
  paid_total_amount?: number
  top_partner_tg_id: number
  top_partner_refs: number
}

export interface Partner {
  tg_id: number
  balance: number
  percent: number | null
  percent_custom: number | boolean
  code: string | null
  method: string | null
  referred_count: number
}

export interface PartnersListResponse {
  ok: boolean
  total: number
  items: Partner[]
}

// Получить общую статистику партнёрской программы
export async function getPartnerStats(config: BotApiConfig): Promise<PartnerStats> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = getBotHeaders()
  const response = await fetch(`${baseUrl}/partners/stats/all?${params}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<PartnerStats>(response)
}

// Получить список всех партнёров
export async function getPartnersList(config: BotApiConfig, limit = 1000, offset = 0): Promise<PartnersListResponse> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  params.append('limit', limit.toString())
  params.append('offset', offset.toString())
  const headers = getBotHeaders()
  const response = await fetch(`${baseUrl}/partners/all?${params}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  })
  return handleBotResponse<PartnersListResponse>(response)
}

// Получить топ партнёров по приглашениям
export async function getTopPartners(config: BotApiConfig, limit = 5): Promise<Partner[]> {
  const data = await getPartnersList(config, limit, 0)
  return data.items.sort((a, b) => b.referred_count - a.referred_count).slice(0, limit)
}

// Заявки на вывод (admin)
export interface WithdrawalItemBot {
  id: number
  tg_id: number
  amount: number
  method: string | null
  destination: string | null
  status: string
  created_at: string | null
}
export interface WithdrawalsResponseBot {
  ok: boolean
  items: WithdrawalItemBot[]
  total: number
  pages: number
  no_module?: boolean
}

export async function getBotPartnerWithdrawals(config: BotApiConfig, status: 'pending' | 'completed' | 'all', page = 1, limit = 25): Promise<WithdrawalsResponseBot> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  params.append('status', status)
  params.append('page', page.toString())
  params.append('limit', limit.toString())
  const headers = getBotHeaders()
  const response = await fetch(`${baseUrl}/partners/withdrawals?${params}`, { method: 'GET', headers, credentials: 'include' })
  return handleBotResponse<WithdrawalsResponseBot>(response)
}

export async function botApproveWithdrawal(config: BotApiConfig, id: number): Promise<{ ok: boolean }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = getBotHeaders()
  const response = await fetch(`${baseUrl}/partners/withdrawals/${id}?${params}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }), credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean }>(response)
}

export async function botRejectWithdrawal(config: BotApiConfig, id: number): Promise<{ ok: boolean; refunded?: number }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = getBotHeaders()
  const response = await fetch(`${baseUrl}/partners/withdrawals/${id}?${params}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reject' }), credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean; refunded?: number }>(response)
}

export async function botResetPartnerMethods(config: BotApiConfig): Promise<{ ok: boolean; reset_count: number }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = getBotHeaders()
  const response = await fetch(`${baseUrl}/partners/reset-methods?${params}`, {
    method: 'POST', headers, credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean; reset_count: number }>(response)
}

// ── Per-user partner ─────────────────────────────────────────────────────────

export interface UserPartnerData {
  ok: boolean
  no_module?: boolean
  partner_balance: number
  partner_code: string | null
  percent: number
  percent_custom: number | boolean
  default_percent: number
  referred_count: number
  who_invited: number | null
  referral_link: string | null
  payout_method: string | null
  payout_method_label: string | null
  requisites_masked: string | null
  paid_today: number
  paid_month: number
  paid_total: number
  pending_count: number
  pending_amount: number
}

export async function getUserPartner(config: BotApiConfig, tgId: number): Promise<UserPartnerData> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = getBotHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/partner?${params}`, { method: 'GET', headers, credentials: 'include' })
  return handleBotResponse<UserPartnerData>(response)
}

export async function setUserPartnerPercent(config: BotApiConfig, tgId: number, percent: number | null): Promise<{ ok: boolean }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/partner/set-percent?${params}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ percent }), credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean }>(response)
}

export async function setUserPartnerCode(config: BotApiConfig, tgId: number, code: string | null): Promise<{ ok: boolean }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/partner/set-code?${params}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }), credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean }>(response)
}

export async function resetUserPartner(config: BotApiConfig, tgId: number): Promise<{ ok: boolean }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/partner/reset?${params}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({}), credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean }>(response)
}

export async function addUserPartnerBalance(config: BotApiConfig, tgId: number, amount: number): Promise<{ ok: boolean; partner_balance: number }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/partner/add-balance?${params}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }), credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean; partner_balance: number }>(response)
}

export async function subtractUserPartnerBalance(config: BotApiConfig, tgId: number, amount: number): Promise<{ ok: boolean; partner_balance: number }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/partner/subtract-balance?${params}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }), credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean; partner_balance: number }>(response)
}

export async function addUserPartnerReferral(config: BotApiConfig, tgId: number, referredTgId: number): Promise<{ ok: boolean }> {
  const baseUrl = getBotApiBase(config)
  const params = getBotParams(config)
  const headers = await getAuthHeaders()
  const response = await fetch(`${baseUrl}/users/${tgId}/partner/add-referral?${params}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ referred_tg_id: referredTgId }), credentials: 'include',
  })
  return handleBotResponse<{ ok: boolean }>(response)
}