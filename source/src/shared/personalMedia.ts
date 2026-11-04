// Optional local media are supplied at build time; a clean checkout retains
// neutral examples and can still build/test without any third-party assets.
interface LocalScene {
  id: string; label: string; description: string; kind: 'image' | 'video' | 'procedural'
  src: string; poster: string; hasCharacter: boolean; themeColor?: string; collection?: string; intro?: string
}
export interface PersonalMediaCatalog {
  available: boolean
  scenes: LocalScene[]
  characterArtIds: string[]
  assets: Record<string, string>
}
declare const __PERSONAL_MEDIA__: PersonalMediaCatalog | undefined
export const personalMedia: PersonalMediaCatalog = typeof __PERSONAL_MEDIA__ !== 'undefined'
  ? __PERSONAL_MEDIA__ : { available: false, scenes: [], characterArtIds: [], assets: {} }
export function personalAsset(path: string, fallback = path): string {
  return personalMedia.assets[path] ?? fallback
}
