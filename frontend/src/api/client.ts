import type {
  LoginResponse,
  AuthCheckResponse,
  RbacMeResponse,
  BotProfilesResponse,
  BotProfile,
  BotProfileCreateRequest,
  BotProfileUpdateRequest,
  BotProfileCreateResponse,
  MonitoringSettings,
  UiSettings,
  NotificationsState,
  RemnawaveSettingsResponse,
  RemnawaveHost,
  RemnawaveHostCreateRequest,
  RemnawaveHostUpdateRequest,
  RemnawaveNode,
  RemnawaveInbound,
  RemnawaveUser,
  RemnawaveUsersResponse,
  PanelUsersResponse,
  PanelUser,
  PanelUserCreateRequest,
  PanelUserUpdateRequest,
  PanelRolesResponse,
  PanelRoleUpdateRequest,
  PanelRole,
  PanelAuditLogResponse,
  PanelAuditEventRequest,
  GitHubUpdateConfig,
  GitHubUpdateConfigResponse,
  GitHubUpdateStatusResponse,
  GitHubUpdateLogResponse,
  GitHubCommitsResponse,
  ErrorResponse,
  ErrorDetail
} from './types'

const API_BASE = '/webpanel';

// Читаем CSRF токен из non-httpOnly cookie csrf_token
function getCsrfFromCookie(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    const csrf = getCsrfFromCookie();
    if (csrf) {
        headers['X-CSRF-Token'] = csrf;
    }
    return headers;
}

// Обратная совместимость — теперь просто noop (CSRF берётся из cookie)
export async function refreshCsrfToken(): Promise<void> {}

async function getCsrfHeaderOnly(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    const csrf = getCsrfFromCookie();
    if (csrf) {
        headers['X-CSRF-Token'] = csrf;
    }
    return headers;
}

// Флаг чтобы не запускать несколько refresh одновременно
let _refreshPromise: Promise<boolean> | null = null;
let _refreshResetTimer: ReturnType<typeof setTimeout> | null = null;
// Время последнего успешного refresh — если недавно был, не редиректим на логин
let _lastRefreshTime = 0;

async function tryRefreshToken(): Promise<boolean> {
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    }).then(r => { if (r.ok) _lastRefreshTime = Date.now(); return r.ok; }).catch(() => false).finally(() => {
        // Сбрасываем промис через небольшую задержку, чтобы параллельные вызовы
        // не создавали новый refresh пока предыдущий только что завершился
        if (_refreshResetTimer) clearTimeout(_refreshResetTimer);
        _refreshResetTimer = setTimeout(() => { _refreshPromise = null; }, 2000);
    });
    return _refreshPromise;
}

// apiFetch: wrapper с автоматическим refresh при 401
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
    const resp = await fetch(url, { credentials: 'include', ...init });
    if (resp.status === 401) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
            // Повторяем с обновлёнными cookies (новый csrf из cookie)
            const newHeaders = { ...(init?.headers || {}) };
            const csrf = getCsrfFromCookie();
            if (csrf && typeof newHeaders === 'object') {
                (newHeaders as Record<string, string>)['X-CSRF-Token'] = csrf;
            }
            return fetch(url, { credentials: 'include', ...init, headers: newHeaders });
        }
    }
    return resp;
}

async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        if (response.status === 401) {
            // Пробуем обновить токен
            const refreshed = await tryRefreshToken();
            if (refreshed) {
                // Токен обновлён — кидаем ошибку, следующие запросы подхватят новые куки
                // НЕ делаем reload чтобы избежать бесконечного цикла при 401 от бот-API
                throw new Error('Сессия обновлена, повторите действие.');
            }
            // Рефреш не удался — но если недавно рефрешили (<30с), не кидаем на логин
            // (401 может быть от бот-API, а не от панели)
            if (Date.now() - _lastRefreshTime < 30000) {
                throw new Error('Ошибка запроса (401)');
            }
            if (window.location.pathname !== '/webpanel/login') {
                window.location.href = '/webpanel/login';
            }
            throw new Error('Требуется авторизация. Пожалуйста, войдите в систему.');
        }
        
        let errorMessage = 'Произошла ошибка при выполнении запроса';
        try {
            const errorData = await response.json() as ErrorResponse | string;
            if (typeof errorData === 'string') {
                errorMessage = errorData;
            } else if (errorData && typeof errorData === 'object') {
                if (Array.isArray(errorData.detail)) {
                    errorMessage = errorData.detail.map((err: ErrorDetail | string) => {
                        if (typeof err === 'string') return err;
                        if (err.msg) {
                            const location = err.loc?.join('.') || '';
                            return location ? `${location}: ${err.msg}` : err.msg;
                        }
                        return JSON.stringify(err);
                    }).join(', ');
                } else if (errorData.detail) {
                    errorMessage = typeof errorData.detail === 'string' 
                        ? errorData.detail 
                        : JSON.stringify(errorData.detail);
                } else if (errorData.message) {
                    errorMessage = errorData.message;
                } else if (errorData.error) {
                    errorMessage = errorData.error;
                }
            }
        } catch {
            // Если не удалось распарсить JSON, используем понятные сообщения по статусу
            const statusMessages: Record<number, string> = {
                400: 'Неверный запрос. Проверьте введенные данные.',
                401: 'Требуется авторизация. Пожалуйста, войдите в систему.',
                403: 'Доступ запрещен. У вас нет прав для выполнения этого действия.',
                404: 'Ресурс не найден. Возможно, он был удален или перемещен.',
                409: 'Конфликт данных. Возможно, запись уже существует.',
                422: 'Ошибка валидации данных. Проверьте правильность заполнения полей.',
                429: 'Слишком много запросов. Пожалуйста, подождите немного.',
                500: 'Внутренняя ошибка сервера. Попробуйте позже или обратитесь к администратору.',
                502: 'Сервер временно недоступен. Попробуйте позже.',
                503: 'Сервис временно недоступен. Выполняются технические работы.',
                504: 'Превышено время ожидания ответа сервера. Попробуйте позже.'
            };
            
            errorMessage = statusMessages[response.status] || 
                (response.status >= 400 && response.status < 500 
                    ? `Ошибка клиента (${response.status})` 
                    : response.status >= 500 
                        ? `Ошибка сервера (${response.status})` 
                        : 'Неизвестная ошибка');
        }
        throw new Error(errorMessage);
    }
    return await response.json();
}

// Auth
export async function login(username: string, password: string): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
    });
    return handleResponse<LoginResponse>(response);
}

export async function login2fa(code: string): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE}/api/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code })
    });
    return handleResponse<LoginResponse>(response);
}

export async function loginTelegram(tgAuthResult: string): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE}/api/auth/telegram/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tgAuthResult })
    });
    return handleResponse<LoginResponse>(response);
}

export async function getTelegramMeta(): Promise<{ ok: boolean; bot_username?: string; bot_id?: number }> {
    const response = await fetch(`${API_BASE}/api/auth/telegram/meta`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return { ok: false };
    return response.json();
}

export async function linkTelegram(tgData: Record<string, string | number>): Promise<{ ok: boolean; tg_id?: number; tg_username?: string }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/api/auth/telegram/link`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(tgData),
    });
    return handleResponse(response);
}

export async function linkTelegramManual(tgId: number): Promise<{ ok: boolean; tg_id?: number }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/api/auth/telegram/link-manual`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tg_id: tgId }),
    });
    return handleResponse(response);
}

export async function unlinkTelegram(): Promise<{ ok: boolean }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/api/auth/telegram/unlink`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
    });
    return handleResponse(response);
}

export async function logout() {
    try {
        const headers = await getAuthHeaders();
        await fetch(`${API_BASE}/api/auth/logout`, {
            method: 'POST',
            headers,
            credentials: 'include',
        });
    } catch (_e) {
        // Игнорируем ошибки выхода
    }
}

export async function get2faStatus(): Promise<{ enabled: boolean; has_backup_codes: boolean }> {
    const response = await apiFetch(`${API_BASE}/api/auth/2fa/status`);
    return handleResponse(response);
}

export async function setup2fa(): Promise<{ secret: string; otpauth_uri: string }> {
    const response = await apiFetch(`${API_BASE}/api/auth/2fa/setup`);
    return handleResponse(response);
}

export async function confirm2fa(code: string): Promise<{ ok: boolean; backup_codes: string[] }> {
    const headers = await getAuthHeaders();
    const response = await apiFetch(`${API_BASE}/api/auth/2fa/setup/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code })
    });
    return handleResponse(response);
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    const headers = await getAuthHeaders();
    const response = await apiFetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });
    return handleResponse(response);
}

export async function disable2fa(password: string): Promise<{ ok: boolean }> {
    const headers = await getAuthHeaders();
    const response = await apiFetch(`${API_BASE}/api/auth/2fa`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ password })
    });
    return handleResponse(response);
}

// -----------------------
// Sender: saved messages + uploads
// -----------------------
export type SenderSavedButton = {
    text: string
    url?: string
    callback?: string
}

export type SenderSavedMessage = {
    id: string
    name: string
    send_to?: string | null
    cluster_name?: string | null
    tg_id?: number | null
    text: string
    photo?: string | null
    buttons?: SenderSavedButton[] | null
    created_at?: string
    updated_at?: string
}

export async function listSenderSavedMessages(): Promise<{ ok: boolean; items: SenderSavedMessage[] }> {
    const response = await fetch(`${API_BASE}/api/sender/saved-messages/`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse(response)
}

export async function saveSenderSavedMessage(payload: Partial<SenderSavedMessage> & { name: string; text: string }): Promise<{ ok: boolean; id: string }> {
    const response = await fetch(`${API_BASE}/api/sender/saved-messages/`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {}),
    })
    return handleResponse(response)
}

export async function deleteSenderSavedMessage(id: string): Promise<{ ok: boolean; deleted: boolean }> {
    const response = await fetch(`${API_BASE}/api/sender/saved-messages/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse(response)
}

export async function uploadSenderPhoto(file: File): Promise<{ ok: boolean; url: string }> {
    const fd = new FormData()
    fd.append('file', file)
    const response = await fetch(`${API_BASE}/api/uploads/photo`, {
        method: 'POST',
        headers: await getCsrfHeaderOnly(),
        credentials: 'include',
        body: fd,
    })
    return handleResponse(response)
}

export async function checkAuth(): Promise<boolean> {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE}/api/auth/check`, {
            headers,
            credentials: 'include',
            cache: 'no-store'
        });
        if (response.ok) {
            const data = await response.json() as AuthCheckResponse & { csrf_token?: string };
            return data.authenticated === true;
        }
        if (response.status === 401) {
            return false;
        }
        return false;
    } catch (_e) {
        return false;
    }
}

// Panel users (multi-user auth)
export async function getAuthSessionInfo(): Promise<AuthCheckResponse> {
    const headers = await getAuthHeaders()
    const response = await fetch(`${API_BASE}/api/auth/check`, {
        headers,
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<AuthCheckResponse>(response)
}

export async function getRbacMe(): Promise<RbacMeResponse> {
    const response = await fetch(`${API_BASE}/api/rbac/me`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<RbacMeResponse>(response)
}

export async function getPanelUsers(): Promise<PanelUsersResponse> {
    const response = await fetch(`${API_BASE}/api/panel-users`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<PanelUsersResponse>(response)
}

export async function createPanelUser(data: PanelUserCreateRequest): Promise<{ ok: boolean; user: PanelUser }> {
    const response = await fetch(`${API_BASE}/api/panel-users`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data),
    })
    return handleResponse(response)
}

export async function updatePanelUser(userId: string, data: PanelUserUpdateRequest): Promise<{ ok: boolean; user: PanelUser }> {
    const response = await fetch(`${API_BASE}/api/panel-users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data),
    })
    return handleResponse(response)
}

export async function deletePanelUser(userId: string): Promise<{ ok: boolean; deleted: boolean }> {
    const response = await fetch(`${API_BASE}/api/panel-users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse(response)
}

export async function disablePanelUser2FA(userId: string): Promise<{ ok: boolean }> {
    const response = await fetch(`${API_BASE}/api/panel-users/${encodeURIComponent(userId)}/2fa`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse(response)
}

export async function getPanelRoles(): Promise<PanelRolesResponse> {
    const response = await fetch(`${API_BASE}/api/panel-roles`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<PanelRolesResponse>(response)
}

export async function updatePanelRole(roleName: string, data: PanelRoleUpdateRequest): Promise<{ ok: boolean; role: PanelRole }> {
    const response = await fetch(`${API_BASE}/api/panel-roles/${encodeURIComponent(roleName)}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data),
    })
    return handleResponse(response)
}

export async function getPanelAuditLog(params?: {
    limit?: number
    offset?: number
    actor?: string
    action?: string
}): Promise<PanelAuditLogResponse> {
    const qs = new URLSearchParams()
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    if (params?.actor) qs.set('actor', String(params.actor))
    if (params?.action) qs.set('action', String(params.action))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    const response = await fetch(`${API_BASE}/api/panel-audit${suffix}`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<PanelAuditLogResponse>(response)
}

export async function trackPanelAuditEvent(data: PanelAuditEventRequest): Promise<{ ok: boolean }> {
    const response = await fetch(`${API_BASE}/api/panel-audit/event`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data || {}),
    })
    return handleResponse(response)
}

export async function getGitHubUpdateConfig(): Promise<GitHubUpdateConfigResponse> {
    const response = await fetch(`${API_BASE}/api/github-update/config`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<GitHubUpdateConfigResponse>(response)
}

export async function saveGitHubUpdateConfig(data: Partial<GitHubUpdateConfig>): Promise<GitHubUpdateConfigResponse> {
    const response = await fetch(`${API_BASE}/api/github-update/config`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data),
    })
    return handleResponse<GitHubUpdateConfigResponse>(response)
}

export async function checkGitHubUpdate(): Promise<{ ok: boolean; status_code?: number; url?: string; content_type?: string }> {
    const response = await fetch(`${API_BASE}/api/github-update/check`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse(response)
}

export async function runGitHubUpdate(): Promise<{ ok: boolean; started?: boolean }> {
    const response = await fetch(`${API_BASE}/api/github-update/run`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse(response)
}

export async function getGitHubUpdateStatus(): Promise<GitHubUpdateStatusResponse> {
    const response = await fetch(`${API_BASE}/api/github-update/status`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<GitHubUpdateStatusResponse>(response)
}

export async function getGitHubUpdateLog(lines = 200): Promise<GitHubUpdateLogResponse> {
    const response = await fetch(`${API_BASE}/api/github-update/log?lines=${encodeURIComponent(String(lines))}`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<GitHubUpdateLogResponse>(response)
}

export async function getGitHubCommits(): Promise<GitHubCommitsResponse> {
    const response = await fetch(`${API_BASE}/api/github-update/commits`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<GitHubCommitsResponse>(response)
}

// Bot Profiles
export async function getBotProfiles(): Promise<BotProfilesResponse> {
    const response = await fetch(`${API_BASE}/api/bot-profiles/`, {
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
    });
    return handleResponse<BotProfilesResponse>(response);
}

export async function createBotProfile(data: BotProfileCreateRequest): Promise<BotProfileCreateResponse> {
    const response = await fetch(`${API_BASE}/api/bot-profiles/`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data)
    });
    return handleResponse<BotProfileCreateResponse>(response);
}

export async function updateBotProfile(profileId: string, data: BotProfileUpdateRequest): Promise<BotProfile> {
    const response = await fetch(`${API_BASE}/api/bot-profiles/${profileId}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data)
    });
    return handleResponse<BotProfile>(response);
}

export async function deleteBotProfile(profileId: string) {
    const response = await fetch(`${API_BASE}/api/bot-profiles/${profileId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse(response);
}

export async function setActiveBotProfile(profileId: string) {
    const response = await fetch(`${API_BASE}/api/bot-profiles/${profileId}/set-active`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse(response);
}

// LK Profiles (bind LK to bot profile)
export type LkProfile = {
    id: string
    name: string
    botProfileIds: string[]
    settings: {
        brand_title?: string
        domain?: string
        support_url?: string
        news_url?: string
        terms_url?: string
    }
}

export type LkProfilesResponse = {
    profiles: LkProfile[]
    activeProfileId?: string | null
}

export async function getLkProfiles(): Promise<LkProfilesResponse> {
    const response = await fetch(`${API_BASE}/api/lk-profiles/`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<LkProfilesResponse>(response)
}

export async function createLkProfile(data: Partial<LkProfile>): Promise<any> {
    const response = await fetch(`${API_BASE}/api/lk-profiles/`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data),
    })
    return handleResponse<any>(response)
}

export async function updateLkProfile(profileId: string, data: Partial<LkProfile>): Promise<any> {
    const response = await fetch(`${API_BASE}/api/lk-profiles/${profileId}`, {
        method: 'PUT',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data),
    })
    return handleResponse<any>(response)
}

export async function deleteLkProfile(profileId: string) {
    const response = await fetch(`${API_BASE}/api/lk-profiles/${profileId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse<any>(response)
}

export async function setActiveLkProfile(profileId: string) {
    const response = await fetch(`${API_BASE}/api/lk-profiles/${profileId}/set-active`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse<any>(response)
}

// LK Support Chat (AdminPanel-side storage)
export type LkSupportConversation = {
    tg_id: string
    unread_count: number
    last_sender: 'user' | 'admin'
    last_message: string
    last_created_at: string
    last_id?: number
}

export type LkSupportMessage = {
    id: number
    tg_id: string
    sender: 'user' | 'admin'
    message: string
    created_at: string
    is_read?: boolean
    attachments?: string[]
}

export async function getLkSupportConversations(lkProfileId: string): Promise<{ ok: boolean; items: LkSupportConversation[] }> {
    const response = await fetch(`${API_BASE}/api/lk-support/conversations?lk_profile_id=${encodeURIComponent(String(lkProfileId || ''))}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<{ ok: boolean; items: LkSupportConversation[] }>(response)
}

export async function getLkSupportMessages(lkProfileId: string, tgId: string | number): Promise<{ ok: boolean; items: LkSupportMessage[] }> {
    const response = await fetch(
        `${API_BASE}/api/lk-support/messages/${encodeURIComponent(String(tgId))}?lk_profile_id=${encodeURIComponent(String(lkProfileId || ''))}`,
        {
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            cache: 'no-store',
        }
    )
    return handleResponse<{ ok: boolean; items: LkSupportMessage[] }>(response)
}

export async function replyLkSupportMessage(
    lkProfileId: string,
    tgId: string | number,
    message: string,
    attachments?: string[],
): Promise<any> {
    const response = await fetch(
        `${API_BASE}/api/lk-support/reply/${encodeURIComponent(String(tgId))}?lk_profile_id=${encodeURIComponent(String(lkProfileId || ''))}`,
        {
            method: 'POST',
            headers: await getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({ message, attachments: Array.isArray(attachments) ? attachments : [] }),
        }
    )
    return handleResponse<any>(response)
}

export async function uploadLkSupportImage(file: File): Promise<{ ok: boolean; id: string; url: string }> {
    const fd = new FormData()
    fd.append('file', file)
    const response = await fetch(`${API_BASE}/api/lk-support/upload`, {
        method: 'POST',
        headers: await getCsrfHeaderOnly(),
        credentials: 'include',
        body: fd,
    })
    return handleResponse(response)
}

// Readiness check
export async function checkReadiness() {
    const response = await fetch(`${API_BASE}/api/readiness-check`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse(response);
}

// Dashboard Stats (fast, cached, server-side aggregation)
export interface DashboardStats {
    cached_at: string;
    users: {
        total: number;
        day: number;
        yesterday: number;
        week: number;
        month: number;
        prev_month: number;
    };
    finances: {
        total: number;
        day: number;
        yesterday: number;
        week: number;
        month: number;
        prev_month: number;
    };
    subscriptions: {
        total: number;
        active: number;
        paid_active: number;
        trial_active: number;
        expired: number;
    };
    referrals: {
        total_attracted: number;
    };
    banned?: {
        manual: number;
        blocked: number;
        total: number;
    };
    chart_daily: Array<{
        date: string;
        users: number;
        payments: number;
        keys: number;
    }>;
    chart_monthly: Array<{
        month: string;
        users: number;
        payments: number;
    }>;
    subscription_daily?: Array<{
        date: string;
        active: number;
        new: number;
    }>;
    subscription_monthly?: Array<{
        month: string;
        active: number;
        new: number;
    }>;
    tariff_stats?: Array<{
        name: string;
        count: number;
        revenue: number;
    }>;
}

export async function getDashboardStats(force = false): Promise<DashboardStats> {
    const url = force 
        ? `${API_BASE}/api/dashboard-stats?force=true`
        : `${API_BASE}/api/dashboard-stats`;
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    });
    return handleResponse<DashboardStats>(response);
}

export interface PartnerPayoutsStats {
    ok: boolean;
    cached_at: string;
    today: number;
    yesterday: number;
    week: number;
    month: number;
    total: number;
    scanned_items?: number;
    scanned_pages?: number;
    truncated_total?: boolean;
}

export async function getPartnerPayoutsStats(force = false): Promise<PartnerPayoutsStats> {
    const url = force
        ? `${API_BASE}/api/partner-payouts-stats?force=true`
        : `${API_BASE}/api/partner-payouts-stats`;
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    });
    return handleResponse<PartnerPayoutsStats>(response);
}

export interface PartnerAttractedStats {
    ok: boolean;
    cached_at: string;
    today: number;
    yesterday: number;
    week: number;
    month: number;
    total: number;
    scanned_pages?: number;
    truncated?: boolean;
}

export async function getPartnerAttractedStats(force = false): Promise<PartnerAttractedStats> {
    const url = force
        ? `${API_BASE}/api/partner-attracted-stats?force=true`
        : `${API_BASE}/api/partner-attracted-stats`;
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    });
    return handleResponse<PartnerAttractedStats>(response);
}

// Cached Bot API Data with Pagination
export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
}

export interface CachedUsersParams {
    page?: number;
    per_page?: number;
    search?: string;
    source?: string;  // Filter by UTM source_code
    force?: boolean;
}

export async function getCachedUsers(params: CachedUsersParams = {}): Promise<PaginatedResponse<any>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.search) searchParams.set('search', params.search);
    if (params.source) searchParams.set('source', params.source);
    if (params.force) searchParams.set('force', 'true');
    
    const url = `${API_BASE}/api/cached-users?${searchParams.toString()}`;
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    });
    return handleResponse<PaginatedResponse<any>>(response);
}

export interface CachedKeysParams {
    page?: number;
    per_page?: number;
    search?: string;
    status?: 'active' | 'expired' | 'all' | '';
    tariff_id?: number;  // Filter by tariff_id
    force?: boolean;
}

export async function getCachedKeys(params: CachedKeysParams = {}): Promise<PaginatedResponse<any>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.search) searchParams.set('search', params.search);
    if (params.status) searchParams.set('status', params.status);
    if (params.tariff_id !== undefined) searchParams.set('tariff_id', String(params.tariff_id));
    if (params.force) searchParams.set('force', 'true');
    
    const url = `${API_BASE}/api/cached-keys?${searchParams.toString()}`;
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    });
    return handleResponse<PaginatedResponse<any>>(response);
}

export interface CachedPaymentsParams {
    page?: number;
    per_page?: number;
    search?: string;
    status?: 'success' | 'pending' | 'failed' | 'all' | '';
    provider?: string;
    force?: boolean;
}

export async function getCachedPayments(params: CachedPaymentsParams = {}): Promise<PaginatedResponse<any>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.search) searchParams.set('search', params.search);
    if (params.status) searchParams.set('status', params.status);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.force) searchParams.set('force', 'true');
    
    const url = `${API_BASE}/api/cached-payments?${searchParams.toString()}`;
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    });
    return handleResponse<PaginatedResponse<any>>(response);
}

// Check bot connection
// Monitoring Settings
export async function getMonitoringSettings(): Promise<MonitoringSettings> {
    const response = await fetch(`${API_BASE}/api/monitoring/settings/`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<MonitoringSettings>(response);
}

export async function saveMonitoringSettings(settings: MonitoringSettings): Promise<MonitoringSettings> {
    const response = await fetch(`${API_BASE}/api/monitoring/settings/`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(settings)
    });
    return handleResponse<MonitoringSettings>(response);
}

export async function getMonitoringState(): Promise<any> {
    const response = await fetch(`${API_BASE}/api/monitoring/state/`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<any>(response);
}

export async function getPanelMetrics(): Promise<any> {
    const response = await fetch(`${API_BASE}/api/monitoring/panel-metrics/`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<any>(response);
}

// UI Settings / Branding
export async function getUiSettings(): Promise<UiSettings> {
    const response = await fetch(`${API_BASE}/api/ui/settings/`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse<UiSettings>(response)
}

export async function saveUiSettings(settings: UiSettings): Promise<UiSettings> {
    // Обновляем CSRF токен перед state-changing запросом (после перезагрузки страницы кэш пустой)
    await refreshCsrfToken()
    const response = await fetch(`${API_BASE}/api/ui/settings/`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(settings),
    })
    return handleResponse<UiSettings>(response)
}

// Notifications (server-side read/unread state)
export async function getNotificationsState(): Promise<NotificationsState> {
    const response = await fetch(`${API_BASE}/api/notifications/state/`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
    })
    return handleResponse<NotificationsState>(response)
}

type SaveNotificationsStatePayload = {
    mode?: 'merge' | 'replace'
    read_ids?: string[]
    dismissed_before?: number
    status_notifications?: any[]
    append_status_notification?: any
    clear_status_notifications?: boolean
}

export async function saveNotificationsState(
    payload: SaveNotificationsStatePayload
): Promise<NotificationsState & { ok: boolean; count?: number }> {
    const response = await fetch(`${API_BASE}/api/notifications/state/`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload),
    })
    return handleResponse<any>(response)
}

// Remnawave API
export async function getAllRemnawaveSettings(): Promise<RemnawaveSettingsResponse> {
    const response = await fetch(`${API_BASE}/api/remnawave/settings/all/`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<RemnawaveSettingsResponse>(response);
}

export async function deleteRemnawaveSettings(profileId?: string) {
    const url = profileId 
        ? `${API_BASE}/api/remnawave/settings/?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/settings/`
    const response = await fetch(url, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse(response);
}

export async function getRemnawaveNodes(profileId?: string): Promise<RemnawaveNode[]> {
    const url = profileId
        ? `${API_BASE}/api/remnawave/nodes/?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/nodes/`
    const response = await apiFetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<RemnawaveNode[]>(response);
}

export async function enableRemnawaveNode(profileId: string | undefined, nodeId: string): Promise<void> {
    await refreshCsrfToken()
    const url = profileId 
        ? `${API_BASE}/api/remnawave/nodes/${nodeId}/actions/enable?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/nodes/${nodeId}/actions/enable`
    const response = await fetch(url, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<void>(response);
}

export async function disableRemnawaveNode(profileId: string | undefined, nodeId: string): Promise<void> {
    await refreshCsrfToken()
    const url = profileId 
        ? `${API_BASE}/api/remnawave/nodes/${nodeId}/actions/disable?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/nodes/${nodeId}/actions/disable`
    const response = await fetch(url, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<void>(response);
}

// System Stats
export async function getRemnawaveSystemStats(profileId?: string) {
    const url = profileId 
        ? `${API_BASE}/api/remnawave/system/stats?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/system/stats`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse(response);
}

export type RemnawaveOnlineHistoryPoint = { timestamp: number; count: number }

export async function getRemnawaveOnlineHistory(
    period: '24h' | 'week' | '14days' | 'month' | 'year' = '24h',
    profileId?: string,
): Promise<{ history: RemnawaveOnlineHistoryPoint[] }> {
    const qs = new URLSearchParams()
    if (period) qs.set('period', period)
    if (profileId) qs.set('profile_id', profileId)
    const url = `${API_BASE}/api/remnawave/online-history/?${qs.toString()}`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    return handleResponse(response)
}

// Hosts API
export async function getRemnawaveHosts(profileId?: string): Promise<RemnawaveHost[]> {
    const url = profileId 
        ? `${API_BASE}/api/remnawave/hosts/?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/hosts/`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<RemnawaveHost[]>(response);
}

export async function getRemnawaveHost(profileId: string | undefined, hostId: string): Promise<RemnawaveHost> {
    const url = profileId 
        ? `${API_BASE}/api/remnawave/hosts/${hostId}?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/hosts/${hostId}`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<RemnawaveHost>(response);
}

export async function createRemnawaveHost(profileId: string | undefined, hostData: RemnawaveHostCreateRequest): Promise<RemnawaveHost> {
    const url = profileId 
        ? `${API_BASE}/api/remnawave/hosts/?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/hosts/`
    const response = await fetch(url, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(hostData)
    });
    return handleResponse<RemnawaveHost>(response);
}

export async function updateRemnawaveHost(profileId: string | undefined, hostId: string, hostData: RemnawaveHostUpdateRequest): Promise<RemnawaveHost> {
    // Обновляем CSRF токен перед запросом
    await refreshCsrfToken()
    
    // Формируем URL правильно - profile_id должен быть query параметром, а не частью пути
    let url = `${API_BASE}/api/remnawave/hosts/${encodeURIComponent(hostId)}`
    if (profileId) {
        url += `?profile_id=${encodeURIComponent(profileId)}`
    }
    

    // По документации используется PATCH для обновления.
    // Бэкенд-прокси также поддерживает перезапись на /api/hosts (с uuid в body), поэтому PUT не нужен.
    const response = await fetch(url, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(hostData)
    })

    return handleResponse<RemnawaveHost>(response)
}

export async function deleteRemnawaveHost(profileId: string | undefined, hostId: string) {
    const url = profileId 
        ? `${API_BASE}/api/remnawave/hosts/${hostId}?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/hosts/${hostId}`
    const response = await fetch(url, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse(response);
}

// Inbounds API (для получения списка инбаундов при создании хоста)
export async function getRemnawaveInbounds(profileId?: string): Promise<RemnawaveInbound[]> {
    const url = profileId 
        ? `${API_BASE}/api/remnawave/inbounds/?profile_id=${profileId}`
        : `${API_BASE}/api/remnawave/inbounds/`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<RemnawaveInbound[]>(response);
}

// Remnawave Users API
export async function getRemnawaveUsers(profileId?: string, start: number = 0, size: number = 25): Promise<RemnawaveUsersResponse> {
    const params = new URLSearchParams()
    params.set('start', String(Math.max(0, start)))
    params.set('size', String(Math.max(1, size)))
    if (profileId) params.set('profile_id', profileId)

    const response = await fetch(`${API_BASE}/api/remnawave/users/?${params.toString()}`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    const raw = await handleResponse<any>(response)

    // Remnawave часто возвращает данные в разных форматах (например, nodes: { response: [...] }).
    // Нормализуем к { users: [], total: number } для UI.
    const unwrap = (v: any) => (v && typeof v === 'object' ? (v.response ?? v) : v)
    const v = unwrap(raw)

    const usersArr =
        Array.isArray(v?.users) ? v.users
        : Array.isArray(v) ? v
        : Array.isArray(raw?.users) ? raw.users
        : Array.isArray(raw?.response?.users) ? raw.response.users
        : Array.isArray(raw?.response) ? raw.response
        : []

    // Remnawave возвращает трафик внутри вложенного объекта userTraffic — нормализуем на верхний уровень
    const normalizedUsers = usersArr.map((u: any) => {
        const ut = u?.userTraffic || {}
        return {
            ...u,
            usedTrafficBytes: u.usedTrafficBytes ?? ut.usedTrafficBytes ?? 0,
            lifetimeUsedTrafficBytes: u.lifetimeUsedTrafficBytes ?? ut.lifetimeUsedTrafficBytes ?? 0,
            onlineAt: u.onlineAt ?? ut.onlineAt ?? null,
            firstConnectedAt: u.firstConnectedAt ?? ut.firstConnectedAt ?? null,
            lastConnectedNodeUuid: u.lastConnectedNodeUuid ?? ut.lastConnectedNodeUuid ?? null,
        }
    })

    const totalNum =
        Number(v?.total ?? raw?.total ?? raw?.response?.total ?? (Array.isArray(normalizedUsers) ? normalizedUsers.length : 0)) || 0

    return { users: normalizedUsers, total: totalNum } as RemnawaveUsersResponse
}

export async function getRemnawaveUser(profileId: string | undefined, userUuid: string): Promise<RemnawaveUser> {
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}?profile_id=${encodeURIComponent(profileId)}`
        : `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    const raw = await handleResponse<any>(response)

    // Remnawave may wrap single-user response as { response: {...} }
    const v = raw && typeof raw === 'object' ? (raw.response ?? raw) : raw
    
    // Нормализуем userTraffic (как и в списке)
    const ut = v?.userTraffic || {}
    const normalized = {
        ...v,
        usedTrafficBytes: v?.usedTrafficBytes ?? ut.usedTrafficBytes ?? 0,
        lifetimeUsedTrafficBytes: v?.lifetimeUsedTrafficBytes ?? ut.lifetimeUsedTrafficBytes ?? 0,
        onlineAt: v?.onlineAt ?? ut.onlineAt ?? null,
        firstConnectedAt: v?.firstConnectedAt ?? ut.firstConnectedAt ?? null,
        lastConnectedNodeUuid: v?.lastConnectedNodeUuid ?? ut.lastConnectedNodeUuid ?? null,
    }
    return normalized as RemnawaveUser
}

export async function getRemnawaveUserByUsername(profileId: string | undefined, username: string): Promise<RemnawaveUser | null> {
    const u = String(username || '').trim()
    if (!u) return null
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/by-username/${encodeURIComponent(u)}?profile_id=${encodeURIComponent(profileId)}`
        : `${API_BASE}/api/remnawave/users/by-username/${encodeURIComponent(u)}`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    if (response.status === 404) return null
    if (!response.ok) {
        // reuse shared error handling (401 redirect etc)
        await handleResponse<any>(response)
        return null
    }
    const raw = await response.json()

    // Remnawave may wrap single-user response as { response: {...} }
    const v = raw && typeof raw === 'object' ? (raw.response ?? raw) : raw
    
    // Нормализуем userTraffic (как и в списке)
    const ut = v?.userTraffic || {}
    const normalized = {
        ...v,
        usedTrafficBytes: v?.usedTrafficBytes ?? ut.usedTrafficBytes ?? 0,
        lifetimeUsedTrafficBytes: v?.lifetimeUsedTrafficBytes ?? ut.lifetimeUsedTrafficBytes ?? 0,
        onlineAt: v?.onlineAt ?? ut.onlineAt ?? null,
        firstConnectedAt: v?.firstConnectedAt ?? ut.firstConnectedAt ?? null,
        lastConnectedNodeUuid: v?.lastConnectedNodeUuid ?? ut.lastConnectedNodeUuid ?? null,
    }
    return normalized as RemnawaveUser
}

export async function getRemnawaveUserByEmail(profileId: string | undefined, email: string): Promise<RemnawaveUser | null> {
    const e = String(email || '').trim()
    if (!e) return null
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/by-email/${encodeURIComponent(e)}?profile_id=${encodeURIComponent(profileId)}`
        : `${API_BASE}/api/remnawave/users/by-email/${encodeURIComponent(e)}`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    if (response.status === 404) return null
    if (!response.ok) {
        await handleResponse<any>(response)
        return null
    }
    const raw = await response.json()
    const v = raw && typeof raw === 'object' ? (raw.response ?? raw) : raw
    const ut = v?.userTraffic || {}
    const normalized = {
        ...v,
        usedTrafficBytes: v?.usedTrafficBytes ?? ut.usedTrafficBytes ?? 0,
        lifetimeUsedTrafficBytes: v?.lifetimeUsedTrafficBytes ?? ut.lifetimeUsedTrafficBytes ?? 0,
        onlineAt: v?.onlineAt ?? ut.onlineAt ?? null,
        firstConnectedAt: v?.firstConnectedAt ?? ut.firstConnectedAt ?? null,
        lastConnectedNodeUuid: v?.lastConnectedNodeUuid ?? ut.lastConnectedNodeUuid ?? null,
    }
    return normalized as RemnawaveUser
}

export async function getRemnawaveUserByIdentifier(profileId: string | undefined, ident: string): Promise<RemnawaveUser | null> {
    const s = String(ident || '').trim()
    if (!s) return null
    // Bot keys can store either a short-uuid/username-like token or an email (contains '@').
    if (s.includes('@')) return getRemnawaveUserByEmail(profileId, s)
    // Prefer by-short-uuid (common for subscription "Название"), fallback to by-username
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/by-short-uuid/${encodeURIComponent(s)}?profile_id=${encodeURIComponent(profileId)}`
        : `${API_BASE}/api/remnawave/users/by-short-uuid/${encodeURIComponent(s)}`
    const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    })
    if (response.status === 404) {
        return getRemnawaveUserByUsername(profileId, s)
    }
    if (!response.ok) {
        await handleResponse<any>(response)
        return null
    }
    const raw = await response.json()
    const v = raw && typeof raw === 'object' ? (raw.response ?? raw) : raw
    const ut = v?.userTraffic || {}
    const normalized = {
        ...v,
        usedTrafficBytes: v?.usedTrafficBytes ?? ut.usedTrafficBytes ?? 0,
        lifetimeUsedTrafficBytes: v?.lifetimeUsedTrafficBytes ?? ut.lifetimeUsedTrafficBytes ?? 0,
        onlineAt: v?.onlineAt ?? ut.onlineAt ?? null,
        firstConnectedAt: v?.firstConnectedAt ?? ut.firstConnectedAt ?? null,
        lastConnectedNodeUuid: v?.lastConnectedNodeUuid ?? ut.lastConnectedNodeUuid ?? null,
    }
    return normalized as RemnawaveUser
}

export async function getRemnawaveUsersBulkByIdentifier(
    profileId: string | undefined,
    identifiers: string[],
    opts?: { force?: boolean },
): Promise<Record<string, RemnawaveUser | null>> {
    const ids = (identifiers || []).map((x) => String(x || '').trim()).filter(Boolean)
    if (ids.length === 0) return {}
    const force = !!opts?.force
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/bulk-lookup?profile_id=${encodeURIComponent(profileId)}${force ? '&force=1' : ''}`
        : `${API_BASE}/api/remnawave/users/bulk-lookup${force ? '?force=1' : ''}`
    const response = await fetch(url, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ identifiers: ids }),
    })
    // backend returns {items:{ident:user|null}}
    const raw = await handleResponse<any>(response)
    const items = (raw && typeof raw === 'object' ? (raw.items ?? raw.response?.items ?? raw) : {}) as Record<string, any>
    const out: Record<string, RemnawaveUser | null> = {}
    for (const ident of ids) {
        const one = items[ident]
        if (!one) {
            out[ident] = null
            continue
        }
        const v = one && typeof one === 'object' ? (one.response ?? one) : one
        const ut = v?.userTraffic || {}
        out[ident] = {
            ...v,
            usedTrafficBytes: v?.usedTrafficBytes ?? ut.usedTrafficBytes ?? 0,
            lifetimeUsedTrafficBytes: v?.lifetimeUsedTrafficBytes ?? ut.lifetimeUsedTrafficBytes ?? 0,
            onlineAt: v?.onlineAt ?? ut.onlineAt ?? null,
            firstConnectedAt: v?.firstConnectedAt ?? ut.firstConnectedAt ?? null,
            lastConnectedNodeUuid: v?.lastConnectedNodeUuid ?? ut.lastConnectedNodeUuid ?? null,
        } as RemnawaveUser
    }
    return out
}

export async function remnawaveUserEnable(profileId: string | undefined, userUuid: string) {
    await refreshCsrfToken()
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}/actions/enable?profile_id=${encodeURIComponent(profileId)}`
        : `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}/actions/enable`
    const response = await fetch(url, { method: 'POST', headers: await getAuthHeaders(), credentials: 'include' })
    return handleResponse<any>(response)
}

export async function remnawaveUserDisable(profileId: string | undefined, userUuid: string) {
    await refreshCsrfToken()
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}/actions/disable?profile_id=${encodeURIComponent(profileId)}`
        : `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}/actions/disable`
    const response = await fetch(url, { method: 'POST', headers: await getAuthHeaders(), credentials: 'include' })
    return handleResponse<any>(response)
}

export async function remnawaveUserResetTraffic(profileId: string | undefined, userUuid: string) {
    await refreshCsrfToken()
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}/actions/reset-traffic?profile_id=${encodeURIComponent(profileId)}`
        : `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}/actions/reset-traffic`
    const response = await fetch(url, { method: 'POST', headers: await getAuthHeaders(), credentials: 'include' })
    return handleResponse<any>(response)
}

export async function remnawaveUserRevoke(profileId: string | undefined, userUuid: string) {
    await refreshCsrfToken()
    const url = profileId
        ? `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}/actions/revoke?profile_id=${encodeURIComponent(profileId)}`
        : `${API_BASE}/api/remnawave/users/${encodeURIComponent(userUuid)}/actions/revoke`
    const response = await fetch(url, { method: 'POST', headers: await getAuthHeaders(), credentials: 'include' })
    return handleResponse<any>(response)
}

// Независимые профили Remnawave
export interface RemnawaveProfile {
  id: string
  name: string
  settings: {
    base_url: string
    token?: string
  }
  botProfileIds: string[]
}

export async function getRemnawaveProfiles(): Promise<RemnawaveProfile[]> {
    const response = await fetch(`${API_BASE}/api/remnawave/profiles/`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    const data = await handleResponse<{profiles: RemnawaveProfile[]}>(response);
    return data.profiles || [];
}

export async function createRemnawaveProfile(profile: Omit<RemnawaveProfile, 'id'>): Promise<RemnawaveProfile> {
    const response = await fetch(`${API_BASE}/api/remnawave/profiles/`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(profile)
    });
    return handleResponse<RemnawaveProfile>(response);
}

export async function updateRemnawaveProfile(profileId: string, profile: Partial<RemnawaveProfile>): Promise<RemnawaveProfile> {
    const response = await fetch(`${API_BASE}/api/remnawave/profiles/${profileId}`, {
        method: 'PUT',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(profile)
    });
    return handleResponse<RemnawaveProfile>(response);
}

export async function deleteRemnawaveProfile(profileId: string) {
    const response = await fetch(`${API_BASE}/api/remnawave/profiles/${profileId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse(response);
}

// Version API
export interface VersionInfo {
    version: string;
    release_date: string;
    update_url: string;
    channel?: 'release' | 'dev' | string;
}

export interface VersionCheckResult {
    current_version: string;
    latest_version: string | null;
    update_available: boolean;
    update_type: 'major' | 'minor' | null; // 'major' = важное обновление (x.y.z), 'minor' = исправление (x.y.z.w)
    update_url: string;
    error: string | null;
}

export async function getVersion(): Promise<VersionInfo> {
    const response = await fetch(`${API_BASE}/api/version`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<VersionInfo>(response);
}

export async function checkVersionUpdate(): Promise<VersionCheckResult> {
    const response = await fetch(`${API_BASE}/api/version/check`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<VersionCheckResult>(response);
}

// Partner withdrawals (admin)
export interface WithdrawalItem {
    id: number
    tg_id: number
    amount: number
    method: string | null
    destination: string | null
    status: string
    created_at: string | null
}
export interface WithdrawalsResponse {
    ok: boolean
    items: WithdrawalItem[]
    total: number
    pages: number
    no_module?: boolean
}

export async function getPartnerWithdrawals(status: 'pending' | 'completed' | 'all', page = 1, limit = 25): Promise<WithdrawalsResponse> {
    const response = await fetch(`${API_BASE}/api/partner-withdrawals?status=${status}&page=${page}&limit=${limit}`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<WithdrawalsResponse>(response);
}

export async function approveWithdrawal(id: number): Promise<{ ok: boolean }> {
    const response = await fetch(`${API_BASE}/api/partner-withdrawals/${id}/approve`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<{ ok: boolean }>(response);
}

export async function rejectWithdrawal(id: number): Promise<{ ok: boolean; refunded?: number }> {
    const response = await fetch(`${API_BASE}/api/partner-withdrawals/${id}/reject`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<{ ok: boolean; refunded?: number }>(response);
}

export async function resetPartnerMethods(): Promise<{ ok: boolean; reset_count: number }> {
    const response = await fetch(`${API_BASE}/api/partner-reset-methods`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
    });
    return handleResponse<{ ok: boolean; reset_count: number }>(response);
}

