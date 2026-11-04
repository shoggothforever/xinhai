import { contextBridge, ipcRenderer } from 'electron'
import type { CoverRect, CoverViewSnapshot } from '../shared/coverWall'
const view = {
  snapshot: (): Promise<CoverViewSnapshot> => ipcRenderer.invoke('cover-wall-view:snapshot'),
  open: (id: string): Promise<void> => ipcRenderer.invoke('cover-wall-view:open', id),
  shape: (rects: CoverRect[]): void => ipcRenderer.send('cover-wall-view:shape', rects),
  close: (): void => ipcRenderer.send('cover-wall-view:close'),
  onChanged: (callback: (value: CoverViewSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: CoverViewSnapshot) => callback(value)
    ipcRenderer.on('cover-wall-view:changed', listener)
    return () => ipcRenderer.removeListener('cover-wall-view:changed', listener)
  }
}
contextBridge.exposeInMainWorld('coverWallView', view)
declare global { interface Window { coverWallView: typeof view } }
