import Database from 'better-sqlite3'
import { nativeImage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeBackgroundImage } from './backgroundImage'
import { DEFAULT_COVER_CONFIG, parseCoverConfig, parseCoverContent, type CoverConfig, type CoverContent, type CoverEntry } from '../shared/coverWall'

export class CoverWallStore {
  private readonly db: Database.Database
  private readonly covers: string
  constructor(directory: string) {
    this.covers = resolve(directory, 'coverwall-covers')
    mkdirSync(this.covers, { recursive: true })
    if (lstatSync(this.covers).isSymbolicLink() || realpathSync(this.covers).toLowerCase() !== this.covers.toLowerCase()) throw Error('收藏封面目录不能是链接')
    this.db = new Database(join(directory, 'coverwall.db'))
    this.db.pragma('journal_mode = WAL')
    this.db.exec('CREATE TABLE IF NOT EXISTS cover_items (id TEXT PRIMARY KEY, content TEXT NOT NULL, aspect REAL NOT NULL); CREATE TABLE IF NOT EXISTS cover_config (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL)')
    this.db.prepare('INSERT OR IGNORE INTO cover_config VALUES(1,?)').run(JSON.stringify(DEFAULT_COVER_CONFIG))
  }
  list(): CoverEntry[] {
    return (this.db.prepare('SELECT id,content,aspect FROM cover_items ORDER BY rowid').all() as {id: string; content: string; aspect: number}[])
      .map(row => ({ id: row.id, content: parseCoverContent(JSON.parse(row.content)), aspect: row.aspect }))
  }
  config(): CoverConfig { return parseCoverConfig(JSON.parse((this.db.prepare('SELECT content FROM cover_config WHERE id=1').get() as {content: string}).content)) }
  configure(value: unknown): void { this.db.prepare('UPDATE cover_config SET content=? WHERE id=1').run(JSON.stringify(parseCoverConfig(value))) }
  private ownedCover(uri: string): string {
    const file = resolve(fileURLToPath(uri))
    if (dirname(file).toLowerCase() !== this.covers.toLowerCase() || !/^[a-f0-9]{64}\.png$/.test(file.split(/[\\/]/).pop() || '') || !existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw Error('请通过“选择本机封面”导入图片')
    return file
  }
  importImage(bytes: Buffer): { cover: string; aspect: number } {
    if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw Error('请选择 30MB 内的封面图片')
    const png = normalizeBackgroundImage(bytes), hash = createHash('sha256').update(png).digest('hex'), file = join(this.covers, hash + '.png')
    if (!existsSync(file)) writeFileSync(file, png, { flag: 'wx' })
    else this.ownedCover(pathToFileURL(file).href)
    const size = nativeImage.createFromBuffer(png).getSize()
    return { cover: pathToFileURL(file).href, aspect: size.width / size.height }
  }
  private prepare(value: unknown): { content: CoverContent; aspect: number } {
    const content = parseCoverContent(value)
    let aspect = 2 / 3
    if (content.cover.startsWith('data:')) {
      const imported = this.importImage(Buffer.from(content.cover.slice(content.cover.indexOf(',') + 1), 'base64'))
      content.cover = imported.cover; aspect = imported.aspect
    } else if (content.cover.startsWith('file:')) {
      const image = nativeImage.createFromPath(this.ownedCover(content.cover))
      if (image.isEmpty()) throw Error('本机封面无法读取')
      const size = image.getSize(); aspect = size.width / size.height
    }
    return { content, aspect }
  }
  save(id: unknown, value: unknown): string {
    if (id !== null && (typeof id !== 'string' || !this.db.prepare('SELECT 1 FROM cover_items WHERE id=?').get(id))) throw Error('收藏内容已不存在')
    if (id === null && (this.db.prepare('SELECT COUNT(*) AS n FROM cover_items').get() as {n: number}).n >= 5000) throw Error('当前内容库上限为 5000 条')
    const prepared = this.prepare(value), key = id === null ? randomUUID() : id as string
    this.db.prepare('INSERT INTO cover_items(id,content,aspect) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,aspect=excluded.aspect').run(key, JSON.stringify(prepared.content), prepared.aspect)
    return key
  }
  remove(id: unknown): void {
    if (typeof id !== 'string' || !this.db.prepare('DELETE FROM cover_items WHERE id=?').run(id).changes) throw Error('收藏内容已不存在')
    // Keep imported cover files for saved exports and other entries sharing them.
  }
  importJson(value: unknown): number {
    let rows: unknown = value
    if (value && typeof value === 'object' && !Array.isArray(value)) rows = (value as {items?: unknown}).items
    if (!Array.isArray(rows) || rows.length > 5000) throw Error('请选择包含 items 数组的收藏 JSON（最多 5000 条）')
    const current = this.list(), seen = new Set(current.map(row => row.content.url || JSON.stringify(row.content)))
    const prepared = rows.map(row => this.prepare(row)), additions = prepared.filter(row => {
      const key = row.content.url || JSON.stringify(row.content)
      if (seen.has(key)) return false
      seen.add(key); return true
    })
    if (current.length + additions.length > 5000) throw Error('导入后内容超过 5000 条，已取消本次导入')
    this.db.transaction(() => {
      const insert = this.db.prepare('INSERT INTO cover_items VALUES(?,?,?)')
      additions.forEach(row => insert.run(randomUUID(), JSON.stringify(row.content), row.aspect))
    })()
    return additions.length
  }
  exportJson(): string {
    let bytes = 0
    const items = this.list().map(row => {
      const content = { ...row.content }
      if (content.cover.startsWith('file:')) {
        const image = readFileSync(this.ownedCover(content.cover)); bytes += image.length
        if (bytes > 90 * 1024 * 1024) throw Error('封面总量超过当前便携 JSON 导出的大小上限')
        content.cover = 'data:image/png;base64,' + image.toString('base64')
      }
      return content
    })
    return JSON.stringify({format: 'xinhai-coverwall', version: 1, items}, null, 2)
  }
  close(): void { this.db.close() }
}
