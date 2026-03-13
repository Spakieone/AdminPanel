import { useState, useEffect } from 'react'
import { getBotProfiles } from '../api/client'

let cachedProfileId: string | null | undefined = undefined

export function useRwProfile() {
  const [profileId, setProfileId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (cachedProfileId !== undefined) {
      setProfileId(cachedProfileId)
      setLoading(false)
      return
    }
    getBotProfiles()
      .then(data => {
        const id = data.activeProfileId || null
        cachedProfileId = id
        setProfileId(id)
      })
      .catch(() => {
        cachedProfileId = null
        setProfileId(null)
      })
      .finally(() => setLoading(false))
  }, [])

  return { profileId, loading }
}
