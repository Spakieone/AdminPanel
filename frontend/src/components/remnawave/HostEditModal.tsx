import { useEffect, useMemo, useState } from 'react'
import * as Flags from 'country-flag-icons/react/3x2'

import ModalShell, { modalPrimaryButtonClass, modalSecondaryButtonClass } from '../common/ModalShell'
import NeoToggle from '../common/NeoToggle'
import DarkSelect, { type DarkSelectGroup } from '../common/DarkSelect'

import {
  createRemnawaveHost,
  getBotProfiles,
  getRemnawaveHost,
  updateRemnawaveHost,
} from '../../api/client'

type HostEditModalProps = {
  host: any
  inbounds: any[]
  onClose: () => void
  onSaved: () => void
}

function getFlagComponent(countryCode: string) {
  if (!countryCode || countryCode.length !== 2) return null
  const flagName = countryCode.toUpperCase() as keyof typeof Flags
  return (Flags[flagName] as React.ComponentType<{ className?: string; style?: React.CSSProperties }> | undefined) ?? null
}

function normalizeHostResponse(data: any): any {
  if (!data) return data
  // Remnawave иногда возвращает {response: {...}}
  if (data.response && typeof data.response === 'object') return data.response
  if (data.data && typeof data.data === 'object') return data.data
  return data
}

function getInboundKey(inbound: any) {
  const inboundId = String(inbound?.uuid || inbound?.id || '').trim()
  const profileId = String(inbound?.profileUuid || inbound?.profile_id || inbound?.configProfileUuid || '').trim()
  if (!inboundId) return ''
  return profileId ? `${profileId}|${inboundId}` : inboundId
}

function parseInboundKey(key: string) {
  const trimmed = (key || '').trim()
  const parts = trimmed ? trimmed.split('|') : []
  if (parts.length === 2) {
    return { profileUuid: parts[0], inboundUuid: parts[1] }
  }
  return { profileUuid: '', inboundUuid: trimmed }
}

export default function HostEditModal({ host, inbounds, onClose, onSaved }: HostEditModalProps) {
  const [formData, setFormData] = useState({
    address: '',
    port: '',
    inbound_key: '',
    remark: '',
    enabled: true,
    securityLayer: 'DEFAULT',
    allowInsecure: false,
  })

  const [originalHost, setOriginalHost] = useState<any>(host)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchingHost, setFetchingHost] = useState(false)
  const [inboundQuery, setInboundQuery] = useState('')

  const securityLayerGroups = [
    {
      options: [
        { value: 'DEFAULT', label: 'DEFAULT' },
        { value: 'TLS', label: 'TLS' },
        { value: 'NONE', label: 'NONE' },
      ],
    },
  ] satisfies DarkSelectGroup[]

  // Загружаем актуальные данные хоста при открытии формы редактирования
  useEffect(() => {
    let cancelled = false

    const hydrateFromHost = (raw: any) => {
      const h = normalizeHostResponse(raw)

      const inbound: any = h?.inbound || h?.inboundConfig || null
      const inboundUuid = inbound?.configProfileInboundUuid || inbound?.uuid || inbound?.id || null
      const profileUuid = inbound?.configProfileUuid || inbound?.profileUuid || null

      setFormData({
        address: String(h?.address || ''),
        port: String(h?.port || ''),
        inbound_key: profileUuid && inboundUuid ? `${profileUuid}|${inboundUuid}` : '',
        remark: String(h?.remark || h?.name || ''),
        enabled: h?.isDisabled !== undefined ? !h.isDisabled : true,
        securityLayer: String(h?.securityLayer || 'DEFAULT'),
        allowInsecure: h?.allowInsecure === true,
      })
    }

    const load = async () => {
      if (!host || !(host.uuid || host.id)) {
        setOriginalHost(host)
        setFormData({
          address: '',
          port: '',
          inbound_key: '',
          remark: '',
          enabled: true,
          securityLayer: 'DEFAULT',
          allowInsecure: false,
        })
        return
      }

      setFetchingHost(true)
      setError('')
      try {
        let activeProfileId: string | null = null
        try {
          const profilesData = await getBotProfiles()
          activeProfileId = profilesData.activeProfileId || null
        } catch {
          // ignore
        }

        const hostId = host.uuid || host.id
        const hostData = await getRemnawaveHost(activeProfileId || undefined, hostId)
        if (cancelled) return
        setOriginalHost(hostData)
        hydrateFromHost(hostData)
      } catch (_err: any) {
        if (cancelled) return
        // fallback на пропсы
        hydrateFromHost(host)
      } finally {
        if (!cancelled) setFetchingHost(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [host])

  const inboundsPrepared = useMemo(() => {
    const q = inboundQuery.trim().toLowerCase()
    const list = Array.isArray(inbounds) ? inbounds : []

    const mapped = list
      .map((ib) => {
        const key = getInboundKey(ib)
        const tag = String(ib?.tag || ib?.name || '').trim()
        const type = String(ib?.type || ib?.protocol || '').trim()
        const network = String(ib?.network || '').trim()
        const security = String(ib?.security || '').trim()
        const port = ib?.port != null ? String(ib.port) : ''
        const display = [
          tag || 'Unnamed',
          type ? type.toUpperCase() : null,
          network || null,
          security || null,
          port ? `:${port}` : null,
        ]
          .filter(Boolean)
          .join(' • ')

        return { key, tag, type, network, security, port, display, raw: ib }
      })
      .filter((x) => x.key)
      .sort((a, b) => a.display.localeCompare(b.display))

    if (!q) return mapped
    return mapped.filter((x) => {
      return (
        x.display.toLowerCase().includes(q) ||
        x.tag.toLowerCase().includes(q) ||
        x.type.toLowerCase().includes(q) ||
        x.network.toLowerCase().includes(q) ||
        x.security.toLowerCase().includes(q) ||
        x.port.toLowerCase().includes(q)
      )
    })
  }, [inbounds, inboundQuery])

  const selectedInbound = useMemo(() => {
    const selectedKey = (formData.inbound_key || '').trim()
    if (!selectedKey) return null

    const { profileUuid, inboundUuid } = parseInboundKey(selectedKey)
    const list = Array.isArray(inbounds) ? inbounds : []

    // Сначала пробуем точное совпадение profile|uuid, затем просто uuid
    const byKey = list.find((ib) => getInboundKey(ib) === selectedKey)
    if (byKey) return byKey
    if (profileUuid && inboundUuid) {
      const byUuid = list.find((ib) => String(ib?.uuid || ib?.id || '') === inboundUuid)
      if (byUuid) return byUuid
    }
    return null
  }, [formData.inbound_key, inbounds])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      let activeProfileId: string | null = null
      try {
        const profilesData = await getBotProfiles()
        activeProfileId = profilesData.activeProfileId || null
      } catch {
        // ignore
      }

      if (!formData.address || !formData.port) {
        setError('Адрес и порт обязательны')
        return
      }

      const portNum = parseInt(formData.port.toString(), 10)
      if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
        setError('Порт должен быть числом от 1 до 65535')
        return
      }

      const { profileUuid: inboundProfileUuid, inboundUuid } = parseInboundKey(formData.inbound_key)

      const basePayload: any = {
        address: formData.address.trim(),
        port: portNum,
        isDisabled: !(formData.enabled !== false),
        securityLayer: formData.securityLayer,
        allowInsecure: formData.allowInsecure === true,
      }

      if (formData.remark !== undefined) {
        const remarkTrim = String(formData.remark || '').trim()
        basePayload.remark = remarkTrim ? remarkTrim : null
      }

      if (inboundProfileUuid && inboundUuid) {
        basePayload.inbound = {
          configProfileUuid: inboundProfileUuid,
          configProfileInboundUuid: inboundUuid,
        }
      }

      const normalizedOriginal = normalizeHostResponse(originalHost)
      const hostUuid = normalizedOriginal?.uuid || normalizedOriginal?.id || normalizedOriginal?._id

      if (hostUuid) {
        await updateRemnawaveHost(activeProfileId || undefined, hostUuid, basePayload)
      } else {
        // при создании inbound обязателен (по текущему поведению UI)
        if (!inboundProfileUuid || !inboundUuid) {
          setError('Инбаунд обязателен для создания хоста')
          return
        }
        await createRemnawaveHost(activeProfileId || undefined, basePayload)
      }

      onSaved()
    } catch (err: any) {
      const msg =
        err?.message ||
        err?.error ||
        (typeof err === 'string' ? err : JSON.stringify(err)) ||
        'Ошибка сохранения хоста'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const remarkCountryCode = (() => {
    const remark = String(formData.remark || '').trim()
    const match = remark.match(/^([A-Z]{2})(\s|$)/)
    return match ? match[1] : null
  })()

  const RemarkFlag = remarkCountryCode ? getFlagComponent(remarkCountryCode) : null

  const formId = useMemo(() => `host-edit-${Math.random().toString(16).slice(2)}`, [])

  return (
    <ModalShell
      title={host ? 'Редактирование хоста' : 'Новый хост'}
      subtitle={host ? 'Измените параметры и сохраните' : 'Заполните параметры и создайте новый хост'}
      onClose={onClose}
      closeButtonTone="danger"
      shellTone="neutral"
      size="md"
      closeOnBackdropClick={false}
      closeOnEsc={false}
      banner={
        fetchingHost || error ? (
          <div className="space-y-2">
            {fetchingHost ? (
              <div className="bg-blue-500/15 border border-blue-500/30 rounded-lg p-2.5 text-blue-200 text-xs flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Загрузка данных хоста...
              </div>
            ) : null}
            {error ? (
              <div className="bg-red-500/15 border border-red-500/30 rounded-lg p-2.5 text-red-200 text-xs">
                {error}
              </div>
            ) : null}
          </div>
        ) : null
      }
      footer={
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onClose} className={modalSecondaryButtonClass}>
            Отмена
          </button>
          <button type="submit" form={formId} disabled={loading} className={modalPrimaryButtonClass}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-5">
            {/* Основное */}
            <div className="bg-black/20 border border-default rounded-xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-orange-400" />
                <div className="text-primary font-semibold">Основное</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-muted mb-1.5">Адрес (IP или домен) *</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500/50 text-primary text-sm"
                    placeholder="example.com или 192.168.1.1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1.5">Порт *</label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                    className="w-full px-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500/50 text-primary text-sm"
                    placeholder="443"
                    min="1"
                    max="65535"
                    required
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 bg-overlay-xs border border-default rounded-lg p-3">
                <div>
                  <div className="text-primary text-sm font-medium">Статус</div>
                  <div className="text-muted text-xs mt-0.5">
                    {formData.enabled !== false ? 'Хост активен и участвует в маршрутизации' : 'Хост отключен (isDisabled=true)'}
                  </div>
                </div>
                <NeoToggle
                  checked={formData.enabled !== false}
                  onChange={(next) => setFormData({ ...formData, enabled: next })}
                  width={60}
                  height={28}
                  showStatus={false}
                />
              </div>
            </div>

            {/* Инбаунд */}
            <div className="bg-black/20 border border-default rounded-xl p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-400" />
                  <div className="text-primary font-semibold">Инбаунд</div>
                </div>
                <div className="text-muted text-xs">для нового хоста обязателен</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1.5">Поиск по инбаундам</label>
                  <input
                    type="text"
                    value={inboundQuery}
                    onChange={(e) => setInboundQuery(e.target.value)}
                    className="w-full px-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40 text-primary text-sm"
                    placeholder="tag, protocol, security, порт..."
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1.5">Выбор инбаунда</label>
                  <DarkSelect
                    value={formData.inbound_key}
                    onChange={(v) => setFormData({ ...formData, inbound_key: v })}
                    groups={[
                      {
                        options: [
                          { value: '', label: 'Не выбран (по умолчанию)' },
                          ...inboundsPrepared.map((ib) => ({ value: ib.key, label: ib.display })),
                        ],
                      },
                    ]}
                    buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary text-sm"
                  />
                </div>
              </div>

              <div className="mt-4">
                {selectedInbound ? (
                  <div className="bg-overlay-xs border border-default rounded-lg p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-primary text-sm font-semibold truncate">
                          {selectedInbound.tag || selectedInbound.name || 'Unnamed inbound'}
                        </div>
                        <div className="text-muted text-xs mt-0.5">
                          {(selectedInbound.type || selectedInbound.protocol || '').toString().toUpperCase() || '—'}
                          {selectedInbound.network ? ` • ${selectedInbound.network}` : ''}
                          {selectedInbound.security ? ` • ${selectedInbound.security}` : ''}
                          {selectedInbound.port ? ` • :${selectedInbound.port}` : ''}
                        </div>
                      </div>
                      <div className="text-muted text-[10px] font-mono text-right flex-shrink-0">
                        uuid: {String(selectedInbound.uuid || selectedInbound.id || '').slice(0, 8)}…
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted text-xs">
                    {formData.inbound_key ? 'Инбаунд не найден в текущем списке' : 'Инбаунд не выбран'}
                  </div>
                )}
              </div>
            </div>

            {/* Security */}
            <div className="bg-black/20 border border-default rounded-xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-purple-400" />
                <div className="text-primary font-semibold">Security</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1.5">HTTPS / Security Layer</label>
                  <DarkSelect
                    value={formData.securityLayer}
                    onChange={(v) => setFormData({ ...formData, securityLayer: v })}
                    groups={securityLayerGroups}
                    buttonClassName="w-full px-3 py-2 rounded-lg border border-default bg-transparent hover:bg-overlay-sm text-primary text-sm"
                  />
                  <div className="text-muted text-xs mt-1">Для домена обычно TLS</div>
                </div>

                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, allowInsecure: !(formData.allowInsecure === true) })}
                  className="w-full text-left bg-overlay-xs border border-default rounded-lg p-3 hover:bg-overlay-xs transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-primary text-sm font-medium">Allow insecure</div>
                      <div className="text-muted text-xs mt-0.5">Разрешить небезопасные TLS-сертификаты</div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center ${
                        formData.allowInsecure === true
                          ? 'bg-orange-500/25 border-orange-500/50 text-orange-300'
                          : 'bg-overlay-xs border-default text-transparent'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Примечание */}
            <div className="bg-black/20 border border-default rounded-xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <div className="text-primary font-semibold">Примечание</div>
              </div>

              <div className="relative">
                {RemarkFlag && (
                  <div
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 pointer-events-none z-10"
                    title={remarkCountryCode || undefined}
                  >
                    <RemarkFlag className="w-5 h-4 rounded-sm" />
                  </div>
                )}
                <input
                  type="text"
                  value={formData.remark}
                  onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                  className={`w-full ${
                    RemarkFlag ? 'pl-11' : 'pl-3'
                  } pr-3 py-2 bg-overlay-xs border border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-green-500/40 focus:border-green-500/40 text-primary text-sm`}
                  placeholder="Например: PL Poland или US USA"
                />
              </div>
              <div className="text-muted text-xs mt-1">Если начать с кода страны (2 буквы), будет показан флаг</div>
            </div>
      </form>
    </ModalShell>
  )
}


