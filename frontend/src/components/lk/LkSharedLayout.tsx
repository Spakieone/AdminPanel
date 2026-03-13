import { Outlet } from 'react-router-dom'
import { LkNavProvider } from './LkNavContext'

export default function LkSharedLayout() {
  return (
    <LkNavProvider>
      <Outlet />
    </LkNavProvider>
  )
}
