import { useEffect, useState } from 'react'
import type { DesktopWallpaperStatus } from '../../../shared/desktopWallpaper'
import '../styles/desktop-wallpaper-controls.css'

export default function DesktopWallpaperControls() {
  const [status, setStatus] = useState<DesktopWallpaperStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = Boolean(window.api.desktopWallpaperStatus)
  useEffect(() => {
    if (!supported) return
    let mounted = true
    void window.api.desktopWallpaperStatus!().then(value => { if (mounted) setStatus(value) }).catch(reason => { if (mounted) setError(String(reason)) })
    const unsubscribe = window.api.onDesktopWallpaperStatus?.(value => { if (mounted) setStatus(value) })
    return () => { mounted = false; unsubscribe?.() }
  }, [supported])
  if (!supported || status?.supported === false) return null
  async function toggle() {
    if (busy) return
    setBusy(true); setError('')
    try { setStatus(await window.api.desktopWallpaperSetEnabled!(!status?.enabled)) }
    catch (reason) { setError(String(reason).replace(/^Error:.*?: /, '')) }
    finally { setBusy(false) }
  }
  return <section className="glass desktop-wallpaper-controls" id="customize-desktop-wallpaper" tabIndex={-1} aria-labelledby="desktop-wallpaper-title">
    <header><div><span className="en-label">DESKTOP / WALLPAPER</span><h2 id="desktop-wallpaper-title">Windows 桌面壁纸</h2>
      <p>把当前场景、人物和时钟留在主屏桌面，保留桌面图标与右键操作。</p></div>
      <div className="desktop-wallpaper-actions"><button className="btn primary" disabled={busy || !status || status.phase === 'starting'} onClick={() => void toggle()}>{busy ? '正在切换…' : status?.enabled ? '停止桌面壁纸' : '启用桌面壁纸'}</button>
      <span role="status">{status?.enabled ? status.phase === 'recovering' ? '桌面正在恢复' : status.paused ? '已暂停动态画面' : '正在显示桌面壁纸' : '已停止'}</span></div>
    </header>
    <p className="desktop-wallpaper-help">在本页调整外观，桌面会同步更新。关闭学习窗口后继续在托盘运行；托盘右键可停止壁纸或退出程序。全屏应用、锁屏与休眠时暂停动态画面。</p>
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
  </section>
}
