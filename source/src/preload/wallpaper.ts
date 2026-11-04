import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopWallpaperSnapshot } from '../shared/desktopWallpaper'

const view = {
  snapshot: (): Promise<DesktopWallpaperSnapshot> => ipcRenderer.invoke('desktop-wallpaper:snapshot'),
  onChanged: (callback: (snapshot: DesktopWallpaperSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: DesktopWallpaperSnapshot) => callback(snapshot)
    ipcRenderer.on('desktop-wallpaper:changed', listener)
    return () => ipcRenderer.removeListener('desktop-wallpaper:changed', listener)
  }
}
contextBridge.exposeInMainWorld('desktopWallpaperView', view)
declare global { interface Window { desktopWallpaperView: typeof view } }
