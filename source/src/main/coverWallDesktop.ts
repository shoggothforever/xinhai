import { app, BrowserWindow, ipcMain, powerMonitor, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { coverTiles, type CoverConfig, type CoverEntry, type CoverRect, type CoverStatus, type CoverViewSnapshot } from '../shared/coverWall'
import { sameRendererDocument } from './windowSecurity'

interface Options {
  read: () => {entries: CoverEntry[]; config: CoverConfig}
  open: (id: string) => Promise<void>
  changed: () => void
  reducedMotion: () => boolean
  devUrl?: string
}
export class CoverWallDesktop {
  private window: BrowserWindow | null = null
  private full: BrowserWindow | null = null
  private host: ChildProcessWithoutNullStreams | null = null
  private enabled = false
  private busy = false
  private disposed = false
  private restarts = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private layout = ''
  private lastShape = 0
  private pauseReasons = new Set<string>()
  private status: CoverStatus = {supported: process.platform === 'win32', enabled: false, phase: 'off', error: null}
  private readonly file = join(__dirname, '../renderer/coverwall.html')
  private readonly url: string
  private readonly lock = () => this.pause('session', true)
  private readonly unlock = () => this.pause('session', false)
  private readonly suspend = () => this.pause('suspend', true)
  private readonly resume = () => this.pause('suspend', false)
  private readonly metrics = () => { void this.sync().catch(error => this.fail(error)) }
  private accepts(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow {
    const window = [this.window, this.full].find(win => win && !win.isDestroyed() && win.webContents === event.sender)
    if (!window || event.senderFrame !== window.webContents.mainFrame || !sameRendererDocument(event.senderFrame.url, this.url)) throw Error('拒绝来自非收藏墙页面的请求')
    return window
  }
  constructor(private readonly options: Options) {
    this.url = options.devUrl ? new URL('coverwall.html', options.devUrl).href : pathToFileURL(this.file).href
    ipcMain.handle('cover-wall-view:snapshot', event => this.snapshot(this.accepts(event) === this.full))
    ipcMain.handle('cover-wall-view:open', async (event, id: unknown) => {
      this.accepts(event)
      if (typeof id !== 'string' || !this.snapshot(false).covers.some(tile => tile.id === id)) throw Error('这条收藏已被移除或不在展示规则中')
      await options.open(id)
    })
    ipcMain.on('cover-wall-view:shape', this.shape)
    ipcMain.on('cover-wall-view:close', this.closeFull)
    powerMonitor.on('lock-screen', this.lock); powerMonitor.on('unlock-screen', this.unlock)
    powerMonitor.on('suspend', this.suspend); powerMonitor.on('resume', this.resume)
    screen.on('display-added', this.metrics); screen.on('display-removed', this.metrics); screen.on('display-metrics-changed', this.metrics)
  }
  private snapshot(fullscreen: boolean): CoverViewSnapshot {
    const {entries, config} = this.options.read()
    return { covers: coverTiles(entries, config.rules), mode: config.mode, speed: config.speed, cardSize: config.cardSize,
      paused: this.options.reducedMotion() || [...this.pauseReasons].some(reason => !fullscreen || reason !== 'fullscreen'), fullscreen }
  }
  getStatus(): CoverStatus { return {...this.status} }
  isEnabled(): boolean { return this.enabled }
  private update(value: Partial<CoverStatus>): void { this.status = {...this.status, ...value, enabled: this.enabled}; this.options.changed() }
  private pause(reason: string, value: boolean): void {
    const before = this.pauseReasons.size
    if (value) this.pauseReasons.add(reason); else this.pauseReasons.delete(reason)
    if (before !== this.pauseReasons.size) this.notify()
  }
  private display() { const id = this.options.read().config.displayId; return screen.getAllDisplays().find(display => display.id === id) || screen.getPrimaryDisplay() }
  private layoutKey(): string { return JSON.stringify({config: this.options.read().config.region, display: this.display()}) }
  private makeWindow(fullscreen: boolean): BrowserWindow {
    const display = this.display(), region = this.options.read().config.region, bounds = display.bounds
    const win = new BrowserWindow({
      x: Math.round(bounds.x + bounds.width * region.x), y: Math.round(bounds.y + bounds.height * region.y),
      width: Math.max(160, Math.round(bounds.width * region.width)), height: Math.max(160, Math.round(bounds.height * region.height)),
      show: false, frame: false, transparent: !fullscreen, backgroundColor: fullscreen ? '#11191f' : '#00000000',
      // Chromium returns MA_NOACTIVATEANDEAT for non-focusable widgets, dropping
      // real desktop clicks. The native host keeps this child non-activating.
      focusable: true, skipTaskbar: !fullscreen, resizable: fullscreen, hasShadow: false,
      title: fullscreen ? '心海共学 · 收藏墙浏览' : '心海共学 · 桌面收藏墙',
      webPreferences: {preload: join(__dirname, '../preload/coverwall.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}
    })
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    win.on('page-title-updated', event => event.preventDefault())
    win.webContents.on('will-navigate', (event, url) => {if (!sameRendererDocument(url, this.url)) event.preventDefault()})
    win.webContents.on('will-redirect', (event, url) => {if (!sameRendererDocument(url, this.url)) event.preventDefault()})
    win.webContents.on('will-attach-webview', event => event.preventDefault())
    return win
  }
  private async load(win: BrowserWindow): Promise<void> { if (this.options.devUrl) await win.loadURL(this.url); else await win.loadFile(this.file) }
  private notify(): void {
    for (const win of [this.window, this.full]) if (win && !win.isDestroyed() && !win.webContents.isLoadingMainFrame()) win.webContents.send('cover-wall-view:changed', this.snapshot(win === this.full))
  }
  async sync(): Promise<void> {
    if (this.enabled && !this.busy && this.layoutKey() !== this.layout) {
      this.busy = true
      try { this.closeDesktop(); await this.startDesktop() } catch (error) {this.fail(error); throw error} finally { this.busy = false }
    }
    this.notify()
  }
  async setEnabled(enabled: boolean): Promise<CoverStatus> {
    if (typeof enabled !== 'boolean') throw Error('收藏墙开关无效')
    if (this.disposed || this.busy) throw Error('收藏墙正在切换，请稍后再试')
    if (!enabled) { this.enabled = false; this.closeDesktop(); this.pauseReasons.delete('fullscreen'); this.update({phase: 'off', error: null}); return this.getStatus() }
    if (!this.status.supported) throw Error('桌面收藏墙目前仅支持 Windows')
    if (this.enabled) return this.getStatus()
    this.enabled = true; this.busy = true; this.restarts = 0; this.update({phase: 'starting', error: null})
    try { await this.startDesktop(); return this.getStatus() }
    catch (error) { this.fail(error); throw error }
    finally { this.busy = false }
  }
  private async startDesktop(): Promise<void> {
    const win = this.makeWindow(false); this.window = win; this.lastShape = 0
    win.setIgnoreMouseEvents(true)
    win.on('closed', () => {
      if (this.window !== win) return
      this.window = null; this.host?.kill(); this.host = null
      if (!this.enabled || this.disposed) return
      if (++this.restarts > 3) {this.fail(Error('收藏墙窗口多次失效，请重新启用')); return}
      this.restartTimer = setTimeout(() => {this.restartTimer = null; void this.startDesktop().catch(error => this.fail(error))}, this.restarts * 1000)
    })
    win.webContents.on('render-process-gone', () => {if (this.window === win) this.fail(Error('收藏墙显示进程已退出'))})
    const hostFile = app.isPackaged ? join(process.resourcesPath, 'desktop-host/DesktopWallpaperHost.exe') : join(app.getAppPath(), 'build/desktop-host/DesktopWallpaperHost.exe')
    const display = this.display(), region = this.options.read().config.region
    const point = screen.dipToScreenPoint({x: Math.round(display.bounds.x + display.bounds.width / 2), y: Math.round(display.bounds.y + display.bounds.height / 2)})
    const handle = win.getNativeWindowHandle(), hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE())
    const args = [hwnd, '--interactive', String(point.x), String(point.y), ...[region.x, region.y, region.width, region.height].map(n => String(Math.round(n * 10000)))]
    const host = spawn(hostFile, args, {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']}); this.host = host
    await new Promise<void>((resolve, reject) => {
      let attached = false
      const timer = setTimeout(() => reject(Error('连接收藏墙桌面层超时')), 15000)
      const lines = createInterface({input: host.stdout})
      const fail = (error: Error) => {clearTimeout(timer); if (attached) this.fail(error); else reject(error)}
      lines.on('line', line => {
        if (this.host !== host) return
        try {
          const message = JSON.parse(line)
          if (message.event === 'attached') {attached = true; clearTimeout(timer); resolve()}
          else if (message.event === 'pause') this.pause('fullscreen', message.paused === true)
          else if (message.event === 'window-lost') {if (!win.isDestroyed()) win.destroy()}
          else if (message.event === 'error') fail(Error('收藏墙挂载失败：' + String(message.message)))
        } catch { /* Native diagnostics are data only. */ }
      })
      host.once('error', fail)
      host.once('exit', code => {lines.close(); if (this.host === host && this.enabled) fail(Error('收藏墙桌面组件已退出：' + String(code)))})
      host.stderr.on('data', () => {})
    })
    await this.load(win)
    this.layout = this.layoutKey(); this.update({phase: 'running', error: null}); this.notify()
  }
  private readonly shape = (event: IpcMainEvent, value: unknown) => {
    let win: BrowserWindow
    try {win = this.accepts(event)} catch {return}
    if (win !== this.window || Date.now() - this.lastShape < 60 || !Array.isArray(value) || value.length > 1200) return
    this.lastShape = Date.now()
    const [width, height] = win.getContentSize()
    const rects: CoverRect[] = []
    for (const row of value) {
      if (!row || ![row.x, row.y, row.width, row.height].every(n => typeof n === 'number' && Number.isFinite(n))) return
      const x = Math.max(0, Math.floor(row.x)), y = Math.max(0, Math.floor(row.y))
      const right = Math.min(width, Math.ceil(row.x + row.width)), bottom = Math.min(height, Math.ceil(row.y + row.height))
      if (right > x && bottom > y) rects.push({x, y, width: right - x, height: bottom - y})
    }
    if (!rects.length) {win.setIgnoreMouseEvents(true); win.hide(); return}
    win.setShape(rects); win.setIgnoreMouseEvents(false); if (!win.isVisible()) win.showInactive()
  }
  async showFullscreen(): Promise<void> {
    if (this.full && !this.full.isDestroyed()) {this.full.show(); this.full.focus(); return}
    const win = this.makeWindow(true); this.full = win
    win.on('closed', () => {if (this.full === win) this.full = null})
    try {await this.load(win); win.setFullScreen(true); win.show(); win.focus(); this.notify()}
    catch (error) {win.destroy(); throw error}
  }
  private readonly closeFull = (event: IpcMainEvent) => {
    try {const win = this.accepts(event); if (win === this.full) win.close()} catch { /* Other windows cannot control the viewer. */ }
  }
  private closeDesktop(): void {
    if (this.restartTimer) {clearTimeout(this.restartTimer); this.restartTimer = null}
    const win = this.window, host = this.host; this.window = null; this.host = null
    host?.stdin.end(); host?.kill(); if (win && !win.isDestroyed()) win.destroy()
  }
  private fail(error: unknown): void {
    this.enabled = false; this.closeDesktop(); this.update({phase: 'error', error: error instanceof Error ? error.message : '收藏墙启动失败'})
  }
  dispose(): void {
    this.disposed = true; this.enabled = false; this.closeDesktop(); this.full?.destroy(); this.full = null
    ipcMain.removeHandler('cover-wall-view:snapshot'); ipcMain.removeHandler('cover-wall-view:open')
    ipcMain.removeListener('cover-wall-view:shape', this.shape); ipcMain.removeListener('cover-wall-view:close', this.closeFull)
    powerMonitor.removeListener('lock-screen', this.lock); powerMonitor.removeListener('unlock-screen', this.unlock)
    powerMonitor.removeListener('suspend', this.suspend); powerMonitor.removeListener('resume', this.resume)
    screen.removeListener('display-added', this.metrics); screen.removeListener('display-removed', this.metrics); screen.removeListener('display-metrics-changed', this.metrics)
  }
}
