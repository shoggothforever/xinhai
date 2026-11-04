import { useState } from 'react'
import { useApp } from '../store/app'
import { PERSONAL_EDITION } from '../../../shared/edition'
import { personalAppearancePatch } from '../../../shared/personalAppearance'
import { personalMedia } from '../../../shared/personalMedia'
import '../styles/personal-appearance.css'

export default function PersonalAppearancePresets() {
  const setSettings = useApp(state => state.setSettings)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function apply(recommended: boolean) {
    if (busy) return
    setBusy(true); setMessage('')
    try {
      await setSettings(recommended ? personalAppearancePatch(useApp.getState().settings) : {
        background: 'original-deep-sea', themeMode: 'wallpaper', clockStyle: 'minimal', playerStyle: 'card',
        pageBackgrounds: false, showCharacter: false, characterStyle: 'auto', ambientEffect: 'none',
        wallpaperMotion: false, sceneTransition: 'arc'
      })
      setMessage(recommended ? personalMedia.available ? '已应用 P3R 共学外观。' : '已应用源码版默认外观。' : '已应用 简洁主题组合。')
    } catch {
      setMessage('外观未能保存，请重试。')
    } finally { setBusy(false) }
  }
  return <div className="personal-appearance-presets">
    <div className="personal-appearance-actions" role="group" aria-label="一键外观组合">
      {PERSONAL_EDITION && <button className="btn primary personal-recommended-appearance" disabled={busy} onClick={() => void apply(true)}>{personalMedia.available ? '应用 P3R 共学外观 ↗' : '应用源码版默认外观 ↗'}</button>}
      <button className="btn" disabled={busy} onClick={() => void apply(false)}>应用 简洁主题组合 ↗</button>
    </div>
      {PERSONAL_EDITION && <small>{personalMedia.available ? 'P3R 场景与人物 · 月相时钟 · 随身听 · 使用本机个人版素材' : '中性 SVG 示例壁纸 · 极简时钟 · 简洁播放器 · 不附带第三方素材'}</small>}
    <p role="status">{message || (PERSONAL_EDITION ? '只调整外观，保留声音、减少动态偏好与学习记录。' : '')}</p>
  </div>
}
