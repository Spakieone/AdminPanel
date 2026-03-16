import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { ThemeProvider } from './context/ThemeContext'
import Login from './pages/Login'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './layout/AppLayout'

// Lazy loading для оптимизации загрузки
const Dashboard = lazy(() => import('./pages/Dashboard.tsx'))
const UsersPage = lazy(() => import('./pages/Users.tsx'))
const Tariffs = lazy(() => import('./pages/Tariffs.tsx'))
const Payments = lazy(() => import('./pages/Payments.tsx'))
// "Подключение" как было (профили AdminID/Token)
const Settings = lazy(() => import('./pages/Settings.tsx'))
const Updates = lazy(() => import('./pages/Updates.tsx'))
const Panel = lazy(() => import('./pages/Panel.tsx'))
const Bot = lazy(() => import('./pages/BotControl.tsx'))
// "Настройки бота" (как в Telegram админке)
const BotSettings = lazy(() => import('./pages/BotSettings.tsx'))
const NotificationsPage = lazy(() => import('./pages/Notifications.tsx'))
const PanelUsers = lazy(() => import('./pages/PanelUsers.tsx'))
const Profile = lazy(() => import('./pages/Profile.tsx'))
const Fleet = lazy(() => import('./pages/Fleet.tsx'))
const Violations = lazy(() => import('./pages/Violations.tsx'))
const RwUsers = lazy(() => import('./pages/RwUsers.tsx'))
const RwNodes = lazy(() => import('./pages/RwNodes.tsx'))
const RwHosts = lazy(() => import('./pages/RwHosts.tsx'))
const SupportChat = lazy(() => import('./pages/SupportChat.tsx'))
const LkLogin = lazy(() => import('./pages/LkLogin.tsx'))
const LkMe = lazy(() => import('./pages/LkMe.tsx'))
const LkSupport = lazy(() => import('./pages/LkSupport.tsx'))
const LkTariffs = lazy(() => import('./pages/LkTariffs.tsx'))
const LkCheckout = lazy(() => import('./pages/LkCheckout.tsx'))
const LkProfile = lazy(() => import('./pages/LkProfile.tsx'))
const LkPartner = lazy(() => import('./pages/LkPartner.tsx'))

// Marketing sub-pages (each is a standalone page)
const Utm = lazy(() => import('./pages/Utm.tsx'))
const Referrals = lazy(() => import('./pages/Referrals.tsx'))
const Partners = lazy(() => import('./pages/Partners.tsx'))
const Sender = lazy(() => import('./pages/Sender.tsx'))
const Gifts = lazy(() => import('./pages/Gifts.tsx'))
const CouponsOnly = lazy(() => import('./pages/CouponsOnly.tsx'))

// Компонент загрузки
import CapybaraLoader from './components/common/CapybaraLoader'
import LkSharedLayout from './components/lk/LkSharedLayout'

const LoadingSpinner = () => <CapybaraLoader fullScreen />

const S = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>
)

function App() {
  const variant = String(import.meta.env.VITE_APP_VARIANT || 'admin').toLowerCase()

  if (variant === 'lk') {
    return (
      <ThemeProvider>
      <BrowserRouter
        basename="/"
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <LkLogin />
              </Suspense>
            }
          />
          <Route element={<LkSharedLayout />}>
            <Route path="/tariffs" element={<S><LkTariffs /></S>} />
            <Route path="/checkout" element={<S><LkCheckout /></S>} />
            <Route path="/me" element={<S><LkMe /></S>} />
            <Route path="/profile" element={<S><LkProfile /></S>} />
            <Route path="/support" element={<S><LkSupport /></S>} />
            <Route path="/partner" element={<S><LkPartner /></S>} />
            <Route path="/subscriptions" element={<Navigate to="/me" replace />} />
            <Route path="/payments" element={<Navigate to="/profile" replace />} />
            <Route path="*" element={<Navigate to="/me" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
    <BrowserRouter
      basename="/webpanel"
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<S><Dashboard /></S>} />

          {/* Users — separate pages for users and subscriptions */}
          <Route path="/users" element={<S><UsersPage initialViewMode="users" showTabs={false} /></S>} />
          <Route path="/subscriptions" element={<S><UsersPage initialViewMode="keys" showTabs={false} /></S>} />

          <Route path="/support-chat" element={<S><SupportChat /></S>} />
          <Route path="/notifications" element={<S><NotificationsPage /></S>} />
          <Route path="/payments" element={<S><Payments /></S>} />
          <Route path="/tariffs" element={<S><Tariffs /></S>} />

          {/* Marketing — each sub-page is a separate route */}
          <Route path="/utm" element={<S><Utm /></S>} />
          <Route path="/coupons" element={<S><CouponsOnly /></S>} />
          <Route path="/referrals" element={<S><Referrals /></S>} />
          <Route path="/partners" element={<S><Partners /></S>} />
          <Route path="/gifts" element={<S><Gifts /></S>} />
          <Route path="/sender" element={<S><Sender /></S>} />
          {/* Legacy: /marketing -> /utm */}
          <Route path="/marketing" element={<Navigate to="/utm" replace />} />

          {/* Bot */}
          <Route path="/bot" element={<S><Bot /></S>} />

          {/* Panel settings */}
          <Route path="/panel" element={<S><Panel /></S>} />
          <Route path="/panel/general" element={<Navigate to="/panel?tab=main" replace />} />
          <Route path="/panel/integrations" element={<Navigate to="/panel?tab=main" replace />} />
          <Route path="/panel/monitoring" element={<Navigate to="/panel?tab=monitoring" replace />} />
          <Route path="/panel/notifications" element={<Navigate to="/panel?tab=notifications" replace />} />
          <Route path="/panel/access" element={<Navigate to="/panel?tab=access" replace />} />

          {/* Remnawave */}
          <Route path="/remnawave" element={<Navigate to="/remnawave/nodes" replace />} />
          <Route path="/remnawave/nodes" element={<S><RwNodes /></S>} />
          <Route path="/remnawave/hosts" element={<S><RwHosts /></S>} />
          <Route path="/remnawave/users" element={<S><RwUsers /></S>} />

          <Route path="/settings" element={<S><Settings /></S>} />
          <Route path="/updates" element={<S><Updates /></S>} />
          <Route path="/panel-users" element={<S><PanelUsers /></S>} />
          <Route path="/bot-settings" element={<S><BotSettings /></S>} />
          <Route path="/fleet" element={<S><Fleet /></S>} />
          <Route path="/violations" element={<S><Violations /></S>} />
          <Route path="/profile" element={<S><Profile /></S>} />

          {/* Legacy redirects */}
          <Route path="/management" element={<Navigate to="/bot" replace />} />
          <Route path="/control" element={<Navigate to="/bot" replace />} />
          <Route path="/people" element={<Navigate to="/users" replace />} />
          <Route path="/finance" element={<Navigate to="/payments" replace />} />
          <Route path="/servers" element={<Navigate to="/bot-settings?tab=servers" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
