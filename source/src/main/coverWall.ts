import { app, BrowserWindow, dialog, screen, shell, type MenuItemConstructorOptions } from 'electron'
import { lstatSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { COVER_FILE_EXTENSIONS, coverAllowed, coverTarget, type CoverState } from '../shared/coverWall'
import { CoverWallStore } from './coverWallStore'
import { CoverWallDesktop } from './coverWallDesktop'
import { trustedIpc } from './windowSecurity'

export class CoverWall {
  private readonly store: CoverWallStore
  private readonly desktop: CoverWallDesktop
  constructor(ipc: ReturnType<typeof trustedIpc>, private readonly main: () => BrowserWindow, reducedMotion: () => boolean, private readonly trayChanged: () => void, devUrl?: string) {
    this.store = new CoverWallStore(app.getPath('userData'))
    this.desktop = new CoverWallDesktop({read: () => ({entries: this.store.list(), config: this.store.config()}), open: id => this.open(id), reducedMotion, devUrl,
      changed: () => {this.main().webContents.send('cover-wall:changed'); this.trayChanged()} })
    ipc.handle('cover-wall:state', () => this.state())
    ipc.handle('cover-wall:save', async (_event, id: unknown, content: unknown) => {this.store.save(id, content); return this.changed()})
    ipc.handle('cover-wall:remove', async (_event, id: unknown) => {this.store.remove(id); return this.changed()})
    ipc.handle('cover-wall:configure', async (_event, config: unknown) => {this.store.configure(config); return this.changed()})
    ipc.handle('cover-wall:enable', async (_event, enabled: boolean) => {await this.desktop.setEnabled(enabled); return this.state()})
    ipc.handle('cover-wall:fullscreen', () => this.desktop.showFullscreen())
    ipc.handle('cover-wall:open', (_event, id: unknown) => this.open(id, false))
    ipc.handle('cover-wall:pick-target', async () => {
      const selected = await dialog.showOpenDialog(this.main(), {title: '选择点击封面后要打开的图片或书籍', properties: ['openFile'], filters: [{name: '图片与书籍', extensions: COVER_FILE_EXTENSIONS}]})
      return selected.canceled ? null : coverTarget(pathToFileURL(selected.filePaths[0]).href)
    })
    ipc.handle('cover-wall:pick-cover', async () => {
      const selected = await dialog.showOpenDialog(this.main(), {title: '选择收藏封面', properties: ['openFile'], filters: [{name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']}]})
      if (selected.canceled) return null
      const file = selected.filePaths[0], stat = lstatSync(file)
      if (!stat.isFile() || stat.size > 30 * 1024 * 1024) throw Error('请选择 30MB 内的图片文件')
      return this.store.importImage(readFileSync(file)).cover
    })
    ipc.handle('cover-wall:import', async () => {
      const selected = await dialog.showOpenDialog(this.main(), {title: '导入收藏 JSON（合并内容）', properties: ['openFile'], filters: [{name: '收藏 JSON', extensions: ['json']}]})
      if (selected.canceled) return null
      const file = selected.filePaths[0], stat = lstatSync(file)
      if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw Error('请选择 128MB 内的收藏 JSON')
      const count = this.store.importJson(JSON.parse(readFileSync(file, 'utf8')))
      return {count, state: await this.changed()}
    })
    ipc.handle('cover-wall:export', async () => {
      const selected = await dialog.showSaveDialog(this.main(), {title: '导出收藏与封面', defaultPath: `心海收藏墙-${new Date().toISOString().slice(0,10)}.json`, filters: [{name: '收藏 JSON', extensions: ['json']}]})
      if (selected.canceled || !selected.filePath) return null
      writeFileSync(selected.filePath, this.store.exportJson(), 'utf8'); return selected.filePath
    })
  }
  state(): CoverState {
    return {entries: this.store.list(), config: this.store.config(), status: this.desktop.getStatus(), displays: screen.getAllDisplays().map(display => ({id: display.id, label: `${display.id === screen.getPrimaryDisplay().id ? '主屏' : '副屏'} · ${display.label || display.id} · ${display.size.width}×${display.size.height}`}))}
  }
  private async changed(): Promise<CoverState> {await this.desktop.sync(); this.main().webContents.send('cover-wall:changed'); return this.state()}
  private async open(id: unknown, displayedOnly = true): Promise<void> {
    if (typeof id !== 'string') throw Error('收藏标识无效')
    const entry = this.store.list().find(row => row.id === id)
    if (!entry || displayedOnly && !coverAllowed(entry.content, this.store.config().rules)) throw Error('这条收藏不在当前展示范围中')
    const target = coverTarget(entry.content.url)
    if (!target) {const main = this.main(); main.show(); main.focus(); main.webContents.send('cover-wall:edit', id); return}
    if (target.startsWith('file:')) {
      const file = fileURLToPath(target)
      try {if (!statSync(file).isFile()) throw Error('not-file')} catch {throw Error('找不到打开目标，请点“编辑”，用“选择本机文件”重新选择图片或书籍')}
      const error = await shell.openPath(file); if (error) throw Error('系统无法打开该文件：' + error)
    }
    else await shell.openExternal(target)
  }
  isEnabled(): boolean {return this.desktop.isEnabled()}
  sync(): void {void this.desktop.sync().catch(() => {this.main().show()})}
  trayItems(): MenuItemConstructorOptions[] {return [
    {label: '管理收藏墙', click: () => {const main = this.main(); main.show(); main.focus(); main.webContents.send('cover-wall:edit', null)}},
    {label: this.isEnabled() ? '停止桌面收藏墙' : '启用桌面收藏墙', click: () => {void this.desktop.setEnabled(!this.isEnabled()).catch(() => this.main().show())}},
    {label: '全屏浏览收藏墙', click: () => {void this.desktop.showFullscreen().catch(() => this.main().show())}}
  ]}
  dispose(): void {this.desktop.dispose(); this.store.close()}
}
