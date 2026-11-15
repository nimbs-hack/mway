import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
// The HUD loads the tokens and its own sheet only. It shares no styles and
// no map code with the planner, so it stays small enough for a suit display.
import '../tokens.css'
import './hud.css'
import { Hud } from './Hud'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Hud />
  </StrictMode>,
)
