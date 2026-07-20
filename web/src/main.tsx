import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import { SaveShortcutProvider } from './components/save-shortcut/save-shortcut-provider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="theme">
      <SaveShortcutProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SaveShortcutProvider>
      <Toaster />
    </ThemeProvider>
  </StrictMode>,
)
