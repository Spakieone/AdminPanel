import { useEffect, useState, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import { checkAuth } from '../api/client'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [isAuth, setIsAuth] = useState<boolean | null>(null)
  const retryCountRef = useRef(0)

  useEffect(() => {
    const checkAuthWithRetry = async () => {
      // Небольшая задержка перед первой проверкой (cookie может еще устанавливаться после перезагрузки)
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Первая проверка
      let authResult = await checkAuth()
      
      // Если не авторизован, пробуем еще раз через 500мс и 1000мс (cookie может еще устанавливаться)
      if (!authResult && retryCountRef.current < 3) {
        await new Promise(resolve => setTimeout(resolve, 500))
        authResult = await checkAuth()
        
        if (!authResult && retryCountRef.current < 2) {
          await new Promise(resolve => setTimeout(resolve, 500))
          authResult = await checkAuth()
        }
        
        retryCountRef.current += 1
      }
      
      setIsAuth(authResult)
    }
    
    checkAuthWithRetry()
  }, [])

  if (isAuth === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-overlay-sm">
        <div className="text-xl">Загрузка...</div>
      </div>
    )
  }

  if (!isAuth) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
