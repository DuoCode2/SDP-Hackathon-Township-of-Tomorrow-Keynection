import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled locally: no network needed during a demo.
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
