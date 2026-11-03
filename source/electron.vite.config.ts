import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
const personalMediaDefine = createRequire(resolve('package.json'))('./scripts/personal-media-config.cjs') as () => string

// This published snapshot has one personal source build. Commercial targets
// and their private build resources are deliberately absent.
const define = { __COMMERCIAL_EDITION__: 'false', __PERSONAL_EDITION__: 'true', __PERSONAL_MEDIA__: personalMediaDefine() }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define },
  preload: {
    plugins: [externalizeDepsPlugin()], define,
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), wallpaper: resolve('src/preload/wallpaper.ts') } } }
  },
  renderer: {
    plugins: [react(), {name:'source-notices',resolveId(id:string){if(id==='virtual:xinhai-notices')return '\0source-notices'},load(id:string){if(id==='\0source-notices')return 'export default '+JSON.stringify('{}')}}],
    define,
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html'), wallpaper: resolve('src/renderer/wallpaper.html') } } },
    resolve: { alias: { '@': resolve('src/renderer/src') } }
  }
})
