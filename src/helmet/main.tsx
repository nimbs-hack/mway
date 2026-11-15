import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
// The HUD's own sheet, then what the helmet adds around it. Like the HUD
// page, this one loads no map code.
import '../tokens.css'
import '../hud/hud.css'
import './helmet.css'
import { Helmet } from './Helmet'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Helmet />
  </StrictMode>,
)
