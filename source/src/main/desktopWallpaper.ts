import { app, BrowserWindow, ipcMain, Menu, powerMonitor, screen, Tray, type IpcMainInvokeEvent } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { sameRendererDocument } from './windowSecurity'
import { wallpaperSettings, type DesktopWallpaperSnapshot, type DesktopWallpaperStatus } from '../shared/desktopWallpaper'
import type { Settings } from '../shared/types'

interface Options {
  readSettings: () => Settings
  showMain: () => void
  icon: string
  devUrl?: string
  onStatus?: (status: DesktopWallpaperStatus) => void
}

/** Owns a display-only window and its native desktop host. The learning window
 * remains the single owner of focus sessions, sound and client-state writes. */
export class DesktopWallpaper {
  private window: BrowserWindow | null = null
  private host: ChildProcessWithoutNullStreams | null = null
  private tray: Tray | null = null
  private busy = false
  private disposed = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restarts = 0
  private pauseReasons = new Set<string>()
  private status: DesktopWallpaperStatus = { supported: process.platform === 'win32', enabled: false, phase: 'off', paused: false, error: null }
  private readonly rendererFile = join(__dirname, '../renderer/wallpaper.html')
  private readonly rendererUrl: string
  private readonly lock = () => this.pause('session', true)
  private readonly unlock = () => this.pause('session', false)
  private readonly suspend = () => this.pause('suspend', true)
  private readonly resume = () => this.pause('suspend', false)
  private readonly snapshotHandler = (event: IpcMainInvokeEvent) => {
    const window = this.window
    if (!window || window.isDestroyed() || event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame || !sameRendererDocument(event.senderFrame.url, this.rendererUrl)) {
      throw new Error('拒绝来自非壁纸页面的请求')
    }
    return this.snapshot()
  }

  constructor(private readonly options: Options) {
    this.rendererUrl = options.devUrl ? new URL('wallpaper.html', options.devUrl).href : pathToFileURL(this.rendererFile).href
    ipcMain.handle('desktop-wallpaper:snapshot', this.snapshotHandler)
    powerMonitor.on('lock-screen', this.lock)
    powerMonitor.on('unlock-screen', this.unlock)
    powerMonitor.on('suspend', this.suspend)
    powerMonitor.on('resume', this.resume)
  }

  getStatus(): DesktopWallpaperStatus { return { ...this.status } }
  isEnabled(): boolean { return this.status.enabled }
  private update(patch: Partial<DesktopWallpaperStatus>): void {
    this.status = { ...this.status, ...patch, paused: this.pauseReasons.size > 0 }
    this.options.onStatus?.(this.getStatus())
    this.refreshTray()
  }
  private snapshot(): DesktopWallpaperSnapshot {
    return { settings: wallpaperSettings(this.options.readSettings()), paused: this.pauseReasons.size > 0 }
  }
  syncSettings(): void {
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isLoadingMainFrame()) {
      this.window.webContents.send('desktop-wallpaper:changed', this.snapshot())
    }
  }
  private pause(reason: string, paused: boolean): void {
    const before = this.pauseReasons.size
    if (paused) this.pauseReasons.add(reason)
    else this.pauseReasons.delete(reason)
    if (before !== this.pauseReasons.size) { this.update({}); this.syncSettings() }
  }
  private refreshTray(): void {
    if (!this.tray || this.tray.isDestroyed()) return
    this.tray.setToolTip('心海共学 · ' + (this.status.enabled ? '桌面壁纸运行中' : '桌面壁纸已停止'))
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开学习窗口', click: this.options.showMain },
      { label: this.status.enabled ? '停止桌面壁纸' : '启用桌面壁纸', click: () => { void this.setEnabled(!this.status.enabled).catch(() => this.options.showMain()) } },
      { type: 'separator' },
      { label: '退出心海共学', click: () => app.quit() }
    ]))
  }
  async setEnabled(enabled: boolean): Promise<DesktopWallpaperStatus> {
    if (typeof enabled !== 'boolean') throw new Error('桌面壁纸开关无效')
    if (this.disposed) throw new Error('应用正在退出')
    if (this.busy) throw new Error('桌面壁纸正在切换，请稍后再试')
    if (!enabled) { this.stop(); return this.getStatus() }
    if (!this.status.supported) throw new Error('桌面壁纸模式仅支持 Windows')
    if (this.status.enabled) return this.getStatus()
    this.busy = true
    try {
      if (!this.tray) {
        this.tray = new Tray(this.options.icon)
        this.tray.on('double-click', this.options.showMain)
      }
      this.restarts = 0
      this.update({ enabled: true, phase: 'starting', error: null })
      await this.startWindow()
      return this.getStatus()
    } catch (error) {
      this.fail(error)
      throw error
    } finally { this.busy = false }
  }
  private async startWindow(): Promise<void> {
    const hostFile = app.isPackaged ? join(process.resourcesPath, 'desktop-host/DesktopWallpaperHost.exe') : join(app.getAppPath(), 'build/desktop-host/DesktopWallpaperHost.exe')
    if (!existsSync(hostFile)) throw new Error('缺少桌面组件，请先运行 npm run build:desktop-host，再重新启动应用')
    const bounds = screen.getPrimaryDisplay().bounds
    const window = new BrowserWindow({
      ...bounds, show: false, frame: false, skipTaskbar: true, focusable: false,
      resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, hasShadow: false, title: '心海共学 · 桌面壁纸', backgroundColor: '#101a22',
      webPreferences: { preload: join(__dirname, '../preload/wallpaper.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    this.window = window
    window.setIgnoreMouseEvents(true)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const allowed = (url: string) => sameRendererDocument(url, this.rendererUrl)
    window.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
    window.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault() })
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.on('render-process-gone', (_event, details) => this.fail(new Error('壁纸渲染进程已退出：' + details.reason)))
    window.on('closed', () => {
      if (this.window !== window) return
      this.window = null
      this.host?.kill(); this.host = null
      if (!this.status.enabled || this.disposed) return
      // Explorer can destroy the child HWND when it restarts. Recreate the
      // wallpaper rather than leaving a controller with a stale window handle.
      if (++this.restarts > 3) { this.fail(new Error('桌面窗口多次失效，请重新启用桌面壁纸')); return }
      this.update({ phase: 'recovering' })
      this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.startWindow().catch(error => this.fail(error)) }, 1000 * this.restarts)
    })
    try {
      if (this.options.devUrl) await window.loadURL(this.rendererUrl)
      else await window.loadFile(this.rendererFile)
      if (this.window !== window || window.isDestroyed()) throw new Error('壁纸窗口已关闭')
      const handle = window.getNativeWindowHandle()
      const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE())
      const host = spawn(hostFile, [hwnd], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      this.host = host
      await new Promise<void>((resolve, reject) => {
        let attached = false
        const timer = setTimeout(() => reject(new Error('连接 Windows 桌面超时')), 15000)
        const lines = createInterface({ input: host.stdout })
        const finish = (error?: Error) => { clearTimeout(timer); if (error) reject(error); else resolve() }
        lines.on('line', line => {
          if (this.host !== host) return
          try {
            const message = JSON.parse(line)
            if (message.event === 'attached') {
              attached = true
              window.showInactive()
              this.update({ phase: 'running', error: null })
              this.syncSettings(); finish()
            } else if (message.event === 'pause') this.pause('fullscreen', message.paused === true)
            else if (message.event === 'recovering') this.update({ phase: 'recovering' })
            else if (message.event === 'window-lost') {
              if (attached && !window.isDestroyed()) window.destroy()
              else finish(new Error('桌面窗口在挂载时丢失'))
            }
            else if (message.event === 'error') {
              const error = new Error('桌面挂载失败：' + String(message.message))
              if (attached) this.fail(error)
              else finish(error)
            }
          } catch { /* Ignore malformed diagnostics, never execute helper output. */ }
        })
        host.once('error', error => { if (attached) this.fail(error); else finish(error) })
        host.once('exit', code => {
          lines.close()
          if (this.host !== host || !this.status.enabled) return
          const error = new Error('桌面组件已退出，代码 ' + String(code))
          if (attached) this.fail(error)
          else finish(error)
        })
        host.stderr.on('data', () => { /* stdout is the bounded line protocol. */ })
      })
    } catch (error) {
      if (this.window === window) this.closeWindow()
      throw error
    }
  }
  private closeWindow(): void {
    const window = this.window, host = this.host
    this.window = null; this.host = null
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    host?.stdin.end(); host?.kill()
    if (window && !window.isDestroyed()) window.destroy()
  }
  private fail(error: unknown): void {
    this.closeWindow(); this.pauseReasons.clear()
    this.update({ enabled: false, phase: 'error', error: error instanceof Error ? error.message : String(error) })
    this.options.showMain()
  }
  stop(): void {
    this.closeWindow(); this.pauseReasons.clear()
    this.update({ enabled: false, phase: 'off', error: null })
  }
  dispose(): void {
    this.disposed = true
    this.stop()
    ipcMain.removeHandler('desktop-wallpaper:snapshot')
    powerMonitor.removeListener('lock-screen', this.lock); powerMonitor.removeListener('unlock-screen', this.unlock)
    powerMonitor.removeListener('suspend', this.suspend); powerMonitor.removeListener('resume', this.resume)
    this.tray?.destroy(); this.tray = null
  }
}
