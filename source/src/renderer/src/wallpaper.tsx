import React, { useEffect, useState, type CSSProperties } from 'react'
import ReactDOM from 'react-dom/client'
import type { DesktopWallpaperSnapshot } from '../../shared/desktopWallpaper'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { effectiveThemeColor } from '../../shared/theme'
import { useApp } from './store/app'
import BackgroundMedia from './components/BackgroundMedia'
import CharacterLayer from './components/CharacterLayer'
import UnderwaterBackground from './components/UnderwaterBackground'
import Atmosphere from './components/Atmosphere'
import MinimalClock from './components/MinimalClock'
import P3RClock from './components/P3RClock'
import ThemePalette from './components/ThemePalette'
import { personalAsset, personalMedia } from '../../shared/personalMedia'
import { resolveScene } from './lib/scenes'
import './styles/global.css'
import './styles/customize.css'
import './styles/p3r-refresh.css'
import './styles/scene-polish.css'
import './styles/theme-studio.css'
import './styles/theme-palette.css'
import './styles/theme-sweep.css'
import './styles/desktop-wallpaper.css'

// Importing the display components creates a local view store, but we never
// mount App, call refresh/setSettings, install durable storage or start learning
// timers. The preload exposes only a read-only appearance snapshot.
function apply(snapshot: DesktopWallpaperSnapshot) {
  useApp.setState({ settings: { ...DEFAULT_SETTINGS, ...snapshot.settings, pageBackgrounds: false, reduceMotion: snapshot.paused || snapshot.settings.reduceMotion }, page: 'home', characterMood: 'idle' })
  document.body.classList.toggle('wallpaper-paused', snapshot.paused)
}

function Wallpaper() {
  const settings = useApp(state => state.settings)
  const [size, setSize] = useState(() => ({ width: innerWidth, height: innerHeight }))
  useEffect(() => { const resize = () => setSize({ width: innerWidth, height: innerHeight }); addEventListener('resize', resize); return () => removeEventListener('resize', resize) }, [])
  const color = effectiveThemeColor(settings)
  const scene = resolveScene(settings.background, 'home', false, settings.customBackground)
  const scale = Math.max(.1, Math.min(settings.clockScale, (size.width - 32) / 500, (size.height - 32) / 140))
  const width = (settings.clockStyle === 'p3r' ? 500 : 320) * scale, height = 140 * scale
  const position = settings.clockPosition ?? { x: 1, y: 0 }
  const ratio = (n: number) => Math.max(0, Math.min(1, n))
  const style = { '--theme-color': color, '--cyan': color, '--cyan-bright': color, '--cyan-dim': `color-mix(in srgb, ${color} 35%, transparent)`, '--background-fit': settings.backgroundFit, '--wallpaper-dim': settings.wallpaperDim, '--character-opacity': settings.characterOpacity, '--character-scale': settings.characterScale } as CSSProperties
  return <main className="study-shell desktop-wallpaper" data-page="home" data-scene={scene.id} data-clock={settings.clockStyle} style={style}>
    {personalMedia.available && <link rel="stylesheet" href={personalAsset('appearance.css')}/>}
    <ThemePalette color={color}/>
    <BackgroundMedia wallpaper />
    {scene.kind === 'procedural' && <UnderwaterBackground depth={0} seaMode />}
    <Atmosphere />
    <CharacterLayer />
    {settings.clockStyle !== 'hidden' && <div className="desktop-clock" style={{ left: 16 + ratio(position.x) * Math.max(0, size.width - width - 32), top: 16 + ratio(position.y) * Math.max(0, size.height - height - 32) }}>
      {settings.clockStyle === 'p3r' ? <P3RClock scale={scale} /> : <MinimalClock scale={scale} />}
    </div>}
  </main>
}

const unsubscribe = window.desktopWallpaperView.onChanged(apply)
void window.desktopWallpaperView.snapshot().then(snapshot => {
  apply(snapshot)
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Wallpaper /></React.StrictMode>)
}).catch(() => { document.getElementById('root')!.textContent = '壁纸暂时无法加载，请从托盘停止后重新启用。' })
addEventListener('unload', unsubscribe, { once: true })
