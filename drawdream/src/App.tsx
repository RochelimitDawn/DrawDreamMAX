import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { PlazaPage } from './pages/Plaza'
import { CardsPage } from './pages/Cards'
import { CardDetailPage } from './pages/CardDetail'
import { ChatPage } from './pages/Chat'
import { SettingsPage } from './pages/Settings'
import { WorldInfoPage } from './pages/WorldInfo'
import { PersonaPage } from './pages/Persona'
import { PresetsPage } from './pages/Presets'
import { NovelForgePage } from './pages/NovelForge'
import { LibraryPage } from './pages/Library'
import { AuthProvider } from './auth/AuthContext'
import { AuthGate } from './auth/AuthGate'
import { MotionRoot } from './motion'
import { clearToasts } from './utils/toast'
import './motion/motion.css'

function RouteToastGuard() {
  const { pathname } = useLocation()
  useEffect(() => {
    clearToasts()
  }, [pathname])
  return null
}

function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <RouteToastGuard />
        <MotionRoot>
          <Routes>
            <Route path="/" element={<CardsPage />} />
            <Route path="/plaza" element={<PlazaPage />} />
            <Route path="/cards" element={<CardsPage />} />
            <Route path="/cards/:id" element={<CardDetailPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/world-info" element={<WorldInfoPage />} />
            <Route path="/persona" element={<PersonaPage />} />
            <Route path="/presets" element={<PresetsPage />} />
            <Route path="/novel-forge" element={<NovelForgePage />} />
            <Route path="/profile" element={<Navigate to="/settings" replace />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/register" element={<Navigate to="/" replace />} />
            <Route path="/admin" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MotionRoot>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <AppShell />
      </AuthGate>
    </AuthProvider>
  )
}
