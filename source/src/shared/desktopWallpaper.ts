import type { Settings } from './types'

// Only appearance data crosses into the wallpaper renderer. No diary, model
// configuration, vault paths or database mutation API belongs in that window.
export const wallpaperSettingKeys = [
  'background', 'customBackground', 'backgroundFit', 'wallpaperDim',
  'wallpaperMotion', 'reduceMotion', 'particles', 'ambientEffect',
  'sceneTransition', 'themeMode', 'themeColor', 'wallpaperThemeColors',
  'showCharacter', 'characterStyle', 'characterArtId', 'characterOpacity',
  'characterScale', 'characterPosition', 'clockStyle', 'clockScale', 'clockPosition'
] as const satisfies readonly (keyof Settings)[]

export type WallpaperSettings = Pick<Settings, typeof wallpaperSettingKeys[number]>
export function wallpaperSettings(settings: Settings): WallpaperSettings {
  return Object.fromEntries(wallpaperSettingKeys.map(key => [key, settings[key]])) as WallpaperSettings
}

export interface DesktopWallpaperStatus {
  supported: boolean
  enabled: boolean
  phase: 'off' | 'starting' | 'running' | 'recovering' | 'error'
  paused: boolean
  error: string | null
}
export interface DesktopWallpaperSnapshot {
  settings: WallpaperSettings
  paused: boolean
}
