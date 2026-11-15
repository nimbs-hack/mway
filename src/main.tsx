import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
// styles.css is the console's base, tokens included. planner.css adds what the
// mission pages need on top: stage tabs, form rows, the plan bar.
import './styles.css'
// The map's panel styles also dress the mission pages, which load before the map does.
import './components/plan-panel.css'
import './planner.css'
import App from './App'
import { Tips } from './components/Tips'
import { registerMapCache } from './cache/map-cache'

registerMapCache()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Tips />
  </StrictMode>,
)
