// Типы для API ответов и запросов

// Auth
export interface LoginResponse {
  authenticated: boolean
  token?: string
  csrf_token?: string
  message?: string
}

export interface AuthCheckResponse {
  authenticated: boolean
  csrf_token?: string
  username?: string
  role?: string
  user_id?: string | null
}

export interface RbacMeResponse {
  ok: boolean
  role: string
  permissions: string[]
}

// Panel Users (WebPanel auth)
export type PanelUserRole = 'owner' | 'super_admin' | 'manager' | 'operator' | 'viewer' | 'admin' | string

export interface PanelUser {
  id: string
  username: string
  role: PanelUserRole
  tg_id?: number | null
  is_active: boolean
  created_at?: number
  last_login_at?: number | null
  totp_enabled?: boolean
}

export interface PanelUsersResponse {
  ok: boolean
  items: PanelUser[]
  roles?: PanelUserRole[]
}

export interface PanelUserCreateRequest {
  username: string
  password: string
  role?: PanelUserRole
  tg_id?: number | null
  is_active?: boolean
}

export interface PanelUserUpdateRequest {
  username?: string
  password?: string
  role?: PanelUserRole
  tg_id?: number | null
  is_active?: boolean
}

// Panel Roles (RBAC)
export type PanelRbacAction = 'view' | 'create' | 'edit' | 'delete' | string

export interface PanelRbacResource {
  key: string
  title: string
}

export interface PanelRole {
  name: string
  title: string
  description?: string | null
  permissions: string[]
  is_system: boolean
  created_at?: number
  updated_at?: number
}

export interface PanelRolesResponse {
  ok: boolean
  roles: PanelRole[]
  resources: PanelRbacResource[]
  actions: PanelRbacAction[]
}

export interface PanelRoleUpdateRequest {
  title?: string | null
  description?: string | null
  permissions?: string[]
}

// Panel Audit Log
export interface PanelAuditLogItem {
  id: string
  ts: number
  actor: string
  action: string
  target_type?: string | null
  target_id?: string | null
  meta?: any
}

export interface PanelAuditLogResponse {
  ok: boolean
  items: PanelAuditLogItem[]
  total: number
}

export interface PanelAuditEventRequest {
  action: string
  target_type?: string | null
  target_id?: string | null
  meta?: Record<string, unknown> | null
}

// GitHub update (self-update)
export interface GitHubUpdateConfig {
  repo_url: string
  branch: string
  public_repo: boolean
}

export interface GitHubUpdateStatus {
  status: 'idle' | 'running' | 'success' | 'failed' | string
  stage?: string
  message?: string
  started_at?: number | null
  finished_at?: number | null
  triggered_by?: string
  running?: boolean
  running_for_sec?: number | null
}

export interface GitHubUpdateStatusResponse {
  ok: boolean
  status: GitHubUpdateStatus
}

export interface GitHubUpdateConfigResponse {
  ok: boolean
  config: GitHubUpdateConfig
}

export interface GitHubUpdateLogResponse {
  ok: boolean
  lines: string[]
}

export interface GitHubCommit {
  sha: string
  short_sha: string
  message: string
  author_name: string
  author_date: string
  html_url: string
}

export interface GitHubCommitsResponse {
  ok: boolean
  commits: GitHubCommit[]
  repo_url: string
  branch: string
}

// Users
export interface User {
  tg_id: number
  username?: string
  email?: string
  [key: string]: unknown
}

// Keys
export interface Key {
  email: string
  tg_id?: number
  [key: string]: unknown
}

// Tariffs
export interface Tariff {
  name: string
  [key: string]: unknown
}

// Payments
export interface Payment {
  tg_id: number
  amount?: number
  [key: string]: unknown
}

// Referrals
export interface Referral {
  referrer_tg_id: number
  referred_tg_id: number
  [key: string]: unknown
}

// Bot Profiles
export interface BotProfile {
  id: string
  name: string
  botApiUrl: string
  adminId: string
  token?: string
}

export interface BotProfilesResponse {
  profiles: BotProfile[]
  activeProfileId?: string | null
}

export interface BotProfileCreateRequest {
  name: string
  botApiUrl: string
  adminId: string
  token: string
}

export interface BotProfileUpdateRequest {
  name?: string
  botApiUrl?: string
  adminId?: string
  token?: string
}

export interface BotProfileCreateResponse {
  profile?: BotProfile
  activeProfileId?: string | null
}

// Monitoring Settings
export interface NotificationRecipient {
  id: string
  botProfileIds: string[]
  mode: 'bot' | 'channel'
  botToken?: string
  userId?: string
  channelId?: string
  threadId?: string
}

export interface MonitoringSettings {
  refreshInterval: number
  // What to monitor (affects backend checks + header statuses)
  monitorBotApi?: boolean
  monitorRemnawaveApi?: boolean
  monitorRemnawaveNodes?: boolean
  // Telegram notifications (backward compatible with older `notificationsEnabled`)
  telegramNotificationsEnabled?: boolean
  // In-panel notifications (bell + panel + toasts). Controls server-side status_notifications and UI visibility.
  panelNotificationsEnabled?: boolean
  // Event toggles (per channel)
  telegramNotifyOnDown?: boolean
  telegramNotifyOnRecovery?: boolean
  panelNotifyOnDown?: boolean
  panelNotifyOnRecovery?: boolean
  panelNotifyPayments?: boolean
  panelNotifyUsers?: boolean
  // Backward compatibility (older name for telegram notifications)
  notificationsEnabled: boolean
  notifyOnDown: boolean
  notifyOnRecovery: boolean
  recipients: NotificationRecipient[]
  notificationTemplate: string
  customDownTemplate?: string
  customRecoveryTemplate?: string
  customWarningTemplate?: string
  customWarningRecoveryTemplate?: string
  warningThreshold?: number
  notifyOnWarning?: boolean
  // System monitor card (Dashboard)
  systemWidget?: {
    enabled?: boolean
    // Polling frequency for /management/metrics (seconds)
    pollSec?: number
    showCpu?: boolean
    showRam?: boolean
    showSwap?: boolean
    showDisk?: boolean
    showNetwork?: boolean
    showBotRam?: boolean
    showBotCpu?: boolean
    showPanelRam?: boolean
    showPanelCpu?: boolean
    showRemnawaveNodes?: boolean
  }
}

// User Preferences
// UI / Branding Settings
export interface UiSettings {
  browserTitle: string
  brandTitle: string
}

export interface NotificationsState {
  read_ids: string[]
  dismissed_before: number
  status_notifications?: Array<{
    id?: string
    type?: string
    title?: string
    message?: string
    date?: string
    data?: any
  }>
  updated_at: number
}

// Remnawave Settings
export interface RemnawaveSettingsResponse {
  profiles?: Array<{
    profileId: string
    settings: { base_url: string; token: string }
  }>
  global?: { base_url: string; token: string }
}

// Remnawave Hosts
export interface RemnawaveHost {
  id: string
  [key: string]: unknown
}

export interface RemnawaveHostCreateRequest {
  [key: string]: unknown
}

export interface RemnawaveHostUpdateRequest {
  [key: string]: unknown
}

// Remnawave Nodes
export interface RemnawaveNode {
  uuid?: string
  id?: string
  name?: string
  address?: string
  port?: number
  country?: string
  country_code?: string
  location?: string
  enabled?: boolean
  cpu_percentage?: number
  status?: 'active' | 'paused' | 'inactive' | 'enabled' | 'disabled'
  due_date?: string
  tags?: string[]
  order?: number
  // Status/message fields from /api/nodes
  lastStatusChange?: string | null
  lastStatusMessage?: string | null
  xrayVersion?: string | null
  nodeVersion?: string | null
  // Realtime traffic usage (from /api/nodes/usage/realtime)
  downloadSpeedBps?: number
  uploadSpeedBps?: number
  totalSpeedBps?: number
  downloadBytes?: number
  uploadBytes?: number
  totalBytes?: number
  [key: string]: unknown
}

// Remnawave Users
export type RemnawaveUserStatus = 'ACTIVE' | 'DISABLED' | 'LIMITED' | 'EXPIRED' | string

export interface RemnawaveUserActiveInbound {
  uuid?: string
  tag?: string
  type?: string
  network?: string | null
  security?: string | null
  [key: string]: unknown
}

export interface RemnawaveUser {
  uuid: string
  id?: number
  subscriptionUuid?: string
  shortUuid?: string
  username?: string
  status?: RemnawaveUserStatus | null
  telegramId?: number | null
  email?: string | null
  tag?: string | null
  description?: string | null
  // Traffic (нормализуется из userTraffic)
  usedTrafficBytes?: number
  lifetimeUsedTrafficBytes?: number
  trafficLimitBytes?: number | null
  trafficLimitStrategy?: string | null
  lastConnectedNodeUuid?: string | null
  // Dates
  expireAt?: string | null
  onlineAt?: string | null
  subRevokedAt?: string | null
  lastTrafficResetAt?: string | null
  firstConnectedAt?: string | null
  createdAt?: string
  updatedAt?: string
  // Thresholds/limits
  lastTriggeredThreshold?: number | null
  hwidDeviceLimit?: number | null
  // Subscription
  subscriptionUrl?: string
  subLastUserAgent?: string | null
  subLastOpenedAt?: string | null
  // Inbounds & Squads
  activeUserInbounds?: RemnawaveUserActiveInbound[]
  activeInternalSquads?: Array<{ uuid?: string; name?: string }>
  externalSquadUuid?: string | null
  lastConnectedNode?: { connectedAt?: string; nodeName?: string } | null
  // Credentials / secrets (may be present in user payload)
  trojanPassword?: string | null
  vlessUuid?: string | null
  ssPassword?: string | null
  // Raw userTraffic object (before normalization)
  userTraffic?: {
    usedTrafficBytes?: number
    lifetimeUsedTrafficBytes?: number
    onlineAt?: string | null
    firstConnectedAt?: string | null
    lastConnectedNodeUuid?: string | null
  }
  [key: string]: unknown
}

export interface RemnawaveUsersResponse {
  users: RemnawaveUser[]
  total: number
}

// Remnawave Inbounds
export interface RemnawaveInbound {
  id: string
  [key: string]: unknown
}

// Error Response
export interface ErrorDetail {
  loc?: (string | number)[]
  msg: string
  type?: string
}

export interface ErrorResponse {
  detail?: string | ErrorDetail[]
  message?: string
  error?: string
}

// Bot API Types
export interface BotUser {
  tg_id: number
  [key: string]: unknown
}

export interface BotUserUpdateRequest {
  [key: string]: unknown
}

export interface BotKey {
  email: string
  [key: string]: unknown
}

export interface BotKeyCreateRequest {
  email: string
  tg_id: number
  [key: string]: unknown
}

export interface BotKeyUpdateRequest {
  email?: string
  tg_id?: number
  [key: string]: unknown
}

export interface BotServer {
  id?: number
  server_name: string
  [key: string]: unknown
}

export interface BotServerCreateRequest {
  server_name: string
  [key: string]: unknown
}

export interface BotServerUpdateRequest {
  server_name?: string
  [key: string]: unknown
}

export interface BotTariff {
  name: string
  tariff_name?: string
  group?: string
  group_code?: string
  subgroup?: string
  subgroup_title?: string
  id?: number
  tariff_id?: number
  [key: string]: unknown
}

export interface BotTariffCreateRequest {
  name: string
  [key: string]: unknown
}

export interface BotTariffUpdateRequest {
  name?: string
  [key: string]: unknown
}

export interface BotPayment {
  tg_id: number
  [key: string]: unknown
}

export interface BotReferral {
  referrer_tg_id: number
  referred_tg_id: number
  [key: string]: unknown
}

export interface BotCoupon {
  id?: number | string
  code?: string
  [key: string]: unknown
}

export interface BotCouponCreateRequest {
  [key: string]: unknown
}

export interface BotCouponUpdateRequest {
  [key: string]: unknown
}

export interface BotGift {
  id?: number | string
  gift_id?: string
  [key: string]: unknown
}

export interface BotGiftCreateRequest {
  sender_tg_id: number
  recipient_tg_id?: number | null
  selected_months?: number | null
  expiry_time?: string | null
  gift_link?: string
  is_used?: boolean
  is_unlimited?: boolean
  max_usages?: number | null
  tariff_id: number
  gift_id?: string
}

export interface BotGiftUpdateRequest {
  sender_tg_id?: number
  recipient_tg_id?: number | null
  selected_months?: number | null
  expiry_time?: string | null
  gift_link?: string
  is_used?: boolean
  is_unlimited?: boolean
  max_usages?: number | null
  tariff_id?: number
}

export interface BotUtmTag {
  id?: number
  name?: string
  code: string
  type?: string
  created_by?: number
  created_at?: string
  registrations?: number
  trials?: number
  payments?: number
  total_amount?: number
  monthly?: Array<{
    month: string
    registrations: number
    trials: number
    new_purchases_count: number
    new_purchases_amount: number
    repeat_purchases_count: number
    repeat_purchases_amount: number
  }>
  [key: string]: unknown
}

export interface BotManualBan {
  tg_id: number
  [key: string]: unknown
}

export interface BotBlockedUser {
  tg_id: number
  [key: string]: unknown
}

