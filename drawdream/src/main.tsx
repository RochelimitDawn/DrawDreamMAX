import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import './styles/global.css'
import { initTheme } from './theme'
import { applyDensity, getChatPrefs } from './utils/prefs'
import { applyReadingPrefsToDom, getReadingPrefs } from './utils/reading-prefs'
import App from './App.tsx'

initTheme()
applyDensity(getChatPrefs().density)
applyReadingPrefsToDom(getReadingPrefs())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)