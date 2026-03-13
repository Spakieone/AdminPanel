export interface BotApiConfig {
  tgId: number;
  botApiUrl: string;
}

// Кэш для профилей (в памяти, не в localStorage)
let profilesCache: { profiles: any[], activeProfileId: string | null, timestamp: number } | null = null
const CACHE_TTL = 5000 // 5 секунд

async function fetchProfilesFromServer(): Promise<{ profiles: any[], activeProfileId: string | null }> {
  try {
    // Используем API клиент вместо прямого fetch
    const { getBotProfiles } = await import('../api/client')
    const data = await getBotProfiles()
    if (data && (data.profiles || data.activeProfileId !== undefined)) {
      return {
        profiles: data.profiles || [],
        activeProfileId: data.activeProfileId || null
      }
    }
  } catch {
    // Игнорируем ошибки загрузки профилей
  }
  
  return { profiles: [], activeProfileId: null }
}

// Асинхронная версия для загрузки с сервера
export async function getBotConfigAsync(): Promise<BotApiConfig | null> {
  try {
    // Проверяем кэш в памяти
    const now = Date.now()
    if (profilesCache && (now - profilesCache.timestamp) < CACHE_TTL) {
      const { profiles, activeProfileId } = profilesCache
      if (profiles.length > 0) {
        const profileId = activeProfileId || profiles[0].id
        const profile = profiles.find((p: any) => String(p.id) === String(profileId))
        if (profile && profile.adminId && profile.botApiUrl) {
          return {
            botApiUrl: String(profile.botApiUrl || ''),
            tgId: parseInt(String(profile.adminId), 10)
          }
        }
      }
    }
    
    // Загружаем с сервера
    const { profiles, activeProfileId } = await fetchProfilesFromServer()
    
    // Если получили данные, обновляем кэш
    if (profiles && profiles.length > 0) {
      profilesCache = { profiles, activeProfileId, timestamp: now }
      
      // Используем activeProfileId если есть, иначе первый профиль
      const profileId = activeProfileId || profiles[0].id
      const profile = profiles.find((p: any) => String(p.id) === String(profileId))
      
      if (profile && profile.adminId && profile.botApiUrl) {
        return {
          botApiUrl: String(profile.botApiUrl || ''),
          tgId: parseInt(String(profile.adminId), 10)
        }
      }
    }
  } catch {
    // Игнорируем ошибки загрузки конфигурации
  }
  
  return null
}

// Функция для очистки кэша (вызывать после изменения профилей)
export function clearBotConfigCache() {
  profilesCache = null
}
