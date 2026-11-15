import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { mapTileProxy } from './scripts/api-server.js'

// Cesium loads its web workers, shaders and widget assets at runtime from
// CESIUM_BASE_URL, so they are copied next to the app instead of bundled.
const CESIUM_BUILD = 'node_modules/cesium/Build/Cesium'
const CESIUM_BASE = 'cesium'

export default defineConfig({
  plugins: [
    react(),
    mapTileProxy(),
    viteStaticCopy({
      targets: ['ThirdParty', 'Workers', 'Assets', 'Widgets'].map((dir) => ({
        src: `${CESIUM_BUILD}/${dir}`,
        dest: CESIUM_BASE,
        // Drop node_modules/cesium/Build/Cesium from the copied paths.
        rename: { stripBase: 4 },
      })),
    }),
  ],
  // Four pages: the planner, the read-only EVA HUD, the HUD seen from inside
  // a helmet, and the mission viewer. The last three load no map library.
  build: {
    rolldownOptions: { input: { main: 'index.html', hud: 'hud.html', helmet: 'helmet.html', viewer: 'viewer.html' } },
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${CESIUM_BASE}`),
  },
  // Vite would copy every browser error into this terminal. An error thrown
  // on each mouse move then floods it until the dev server stops answering,
  // so errors stay in the browser console.
  server: { forwardConsole: false },
  // The dev server bundles Cesium into one 12 MB file and leaves it
  // unminified. Minified it is a third of that, which the browser downloads
  // and parses faster each time the planner's map opens.
  optimizeDeps: { rolldownOptions: { output: { minify: true } } },
})
