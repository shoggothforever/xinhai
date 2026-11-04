export interface CoverContent {
  cover: string
  time: string | null
  source: string
  url: string
  description: string
  tags: string[]
}
export interface CoverEntry { id: string; content: CoverContent; aspect: number }
export interface SteamLibraryGame {
  appId: number
  name: string
  minutes: number | null
  cover: string
  url: string
}
export interface CoverRules { onlyTags: string[]; hideTags: string[] }
export interface CoverConfig {
  mode: 'grid' | 'photo'
  speed: number
  cardSize: number
  displayId: number | null
  region: { x: number; y: number; width: number; height: number }
  rules: CoverRules
}
export interface CoverStatus { supported: boolean; enabled: boolean; phase: 'off' | 'starting' | 'running' | 'error'; error: string | null }
export interface CoverState { entries: CoverEntry[]; config: CoverConfig; status: CoverStatus; displays: {id: number; label: string}[] }
export interface CoverTile { id: string; cover: string; aspect: number }
export interface CoverViewSnapshot {
  covers: CoverTile[]
  mode: CoverConfig['mode']
  speed: number
  cardSize: number
  paused: boolean
  fullscreen: boolean
}
export interface CoverRect { x: number; y: number; width: number; height: number }
export const DEFAULT_COVER_CONFIG: CoverConfig = {
  mode: 'grid', speed: 9, cardSize: 160, displayId: null,
  region: { x: .25, y: .19, width: .70, height: .74 }, rules: { onlyTags: [], hideTags: [] }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('收藏数据格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw Error('收藏属性格式或长度无效')
  return value.trim()
}
export function coverTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) throw Error('每条内容最多设置 30 个分区 tag')
  return [...new Set(value.map(tag => text(tag, 80)).filter(Boolean))]
}
export const COVER_FILE_EXTENSIONS = ['png','jpg','jpeg','webp','gif','bmp','avif','pdf','epub','mobi','azw3','cbz','cbr','txt']
export function coverTarget(value: unknown): string {
  let raw = text(value, 8192)
  if (!raw) return ''
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1,-1)
  if (/^[a-z]:[\\/]/i.test(raw)) {
    const path = raw.replace(/\\/g, '/')
    if (path.slice(2).includes(':') || /[\u0000-\u001f]/.test(path)) throw Error('本机文件路径无效')
    raw = 'file:///' + path.split('/').map((part,index) => index === 0 ? part : encodeURIComponent(part)).join('/')
  }
  let url: URL
  try { url = new URL(raw) } catch { throw Error('请填写完整的网页、Steam 链接或本机图片、书籍路径') }
  if (url.username || url.password) throw Error('链接不能包含账号或密码')
  if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  if (url.protocol === 'steam:' && (/^steam:\/\/nav\/games\/details\/\d+\/?$/i.test(raw) || /^steam:\/\/rungameid\/\d+\/?$/i.test(raw))) return url.href
  if (url.protocol === 'file:' && !url.hostname) {
    const path = decodeURIComponent(url.pathname), rest = /^\/[a-z]:\//i.test(path) ? path.slice(3) : path
    if (!path.startsWith('//') && !/[\\\u0000-\u001f]/.test(path) && !rest.includes(':') && COVER_FILE_EXTENSIONS.includes(path.split('.').pop()!.toLowerCase())) return url.href
  }
  throw Error('支持网页、Steam 链接，以及本机图片、PDF、EPUB 等书籍')
}
export function parseCoverContent(value: unknown): CoverContent {
  const row = object(value)
  let cover = text(row.cover, 48 * 1024 * 1024)
  if (!cover) throw Error('请先选择封面')
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(cover)) {
    let image: URL
    try { image = new URL(cover) } catch { throw Error('请使用图片 URL 或选择本机封面') }
    if (!['https:', 'http:', 'file:'].includes(image.protocol) || image.username || image.password) throw Error('封面地址无效')
    cover = image.href
  } else cover = 'data:' + cover.slice(5)
  // Internal IDs and geometry are not content attributes.
  return { cover, time: row.time === null || row.time === undefined || row.time === '' ? null : text(row.time, 80),
    source: text(row.source ?? '', 120), url: coverTarget(row.url ?? ''),
    description: text(row.description ?? '', 1600), tags: coverTags(row.tags ?? []) }
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error('收藏墙显示参数超出范围')
  return value
}
export function parseCoverConfig(value: unknown): CoverConfig {
  const row = object(value), region = object(row.region), rules = object(row.rules)
  if (row.mode !== 'grid' && row.mode !== 'photo') throw Error('展示模式无效')
  const rect = { x: number(region.x, 0, .95), y: number(region.y, 0, .95), width: number(region.width, .10, 1), height: number(region.height, .10, 1) }
  if (rect.x + rect.width > 1.00001 || rect.y + rect.height > 1.00001) throw Error('收藏墙区域不能超出所选屏幕')
  return { mode: row.mode, speed: number(row.speed, 2, 30), cardSize: number(row.cardSize, 100, 320),
    displayId: row.displayId === null ? null : number(row.displayId, 0, Number.MAX_SAFE_INTEGER), region: rect,
    rules: { onlyTags: coverTags(rules.onlyTags), hideTags: coverTags(rules.hideTags) } }
}
export function coverAllowed(content: CoverContent, rules: CoverRules): boolean {
  return !content.tags.some(tag => rules.hideTags.includes(tag)) && (!rules.onlyTags.length || content.tags.some(tag => rules.onlyTags.includes(tag)))
}
export function coverTiles(entries: CoverEntry[], rules: CoverRules): CoverTile[] {
  return entries.filter(entry => coverAllowed(entry.content, rules)).map(entry => ({ id: entry.id, cover: entry.content.cover, aspect: entry.aspect }))
}
export interface PhotoPlacement extends CoverRect { tile: CoverTile; angle: number; cardWidth: number; cardHeight: number; born: number; leaving: boolean }
export function photosOverlap(a: CoverRect, b: CoverRect, gap = 16): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}
export function placeCoverPhoto(tile: CoverTile, width: number, height: number, existing: CoverRect[], size: number, born: number, random = Math.random): PhotoPlacement | null {
  for (let attempt = 0; attempt < 350; attempt++) {
    const cardWidth = Math.min(width * .45, size * (.72 + random() * .36))
    const cardHeight = Math.min(height - 36, cardWidth / Math.max(.4, Math.min(2.5, tile.aspect)) + 16)
    const angle = (random() - .5) * 12, radians = Math.abs(angle) * Math.PI / 180
    const bw = Math.cos(radians) * cardWidth + Math.sin(radians) * cardHeight
    const bh = Math.sin(radians) * cardWidth + Math.cos(radians) * cardHeight
    if (bw > width - 28 || bh > height - 28 || cardHeight < 40) continue
    const rect = { x: 14 + random() * (width - bw - 28), y: 14 + random() * (height - bh - 28), width: bw, height: bh }
    if (existing.every(other => !photosOverlap(rect, other))) return { ...rect, tile, angle, cardWidth, cardHeight, born, leaving: false }
  }
  return null
}
