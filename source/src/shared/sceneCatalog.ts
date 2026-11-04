import { originalThemes } from './originalThemes'
import { personalMedia } from './personalMedia'

export interface SceneDefinition {
  id: string
  label: string
  description: string
  kind: 'image' | 'video' | 'procedural'
  src: string
  poster: string
  hasCharacter: boolean
  themeColor?: string
  collection?: string
  intro?: string
}
// A clean source checkout ships only SVG examples. Local imports activate
// verified media paths without distributing the files through source control.
export const DEFAULT_SCENE_ID = 'original-deep-sea'
export const FALLBACK_POSTER = originalThemes[0].poster
export const sceneCatalog: SceneDefinition[] = [...personalMedia.scenes, ...originalThemes]
