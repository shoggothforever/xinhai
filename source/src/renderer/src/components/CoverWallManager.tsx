import { useEffect, useState } from 'react'
import { coverAllowed, type CoverConfig, type CoverContent, type CoverEntry, type CoverState } from '../../../shared/coverWall'
import '../styles/coverwall-manager.css'

const blank = (): CoverContent => ({cover: '', time: new Date().toISOString().slice(0,10), source: '', url: '', description: '', tags: []})
const tags = (text: string) => [...new Set(text.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))]
export default function CoverWallManager() {
  const api = window.api.coverWall
  const [state, setState] = useState<CoverState | null>(null), [config, setConfig] = useState<CoverConfig | null>(null)
  const [only, setOnly] = useState(''), [hide, setHide] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<CoverContent | null>(null), [editing, setEditing] = useState<string | null>(null), [draftTags, setDraftTags] = useState('')
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(60)
  function edit(entry?: CoverEntry) {setEditing(entry?.id || null); setDraft(entry ? {...entry.content} : blank()); setDraftTags(entry?.content.tags.join(', ') || ''); setError('')}
  useEffect(() => {
    if (!api) return
    let alive = true
    const load = () => {void api.state().then(value => {if (alive) {setState(value); setConfig(previous => {if (!previous) {setOnly(value.config.rules.onlyTags.join(', ')); setHide(value.config.rules.hideTags.join(', ')); return value.config} return previous})}}).catch(reason => {if (alive) setError(String(reason))})}
    load(); const off = api.onChanged(load); return () => {alive = false; off()}
  }, [api])
  useEffect(() => {
    if (!state) return
    const requested = () => {const id = sessionStorage.getItem('cover-wall-edit'); if (id !== null) {sessionStorage.removeItem('cover-wall-edit'); if (id) {const entry = state.entries.find(row => row.id === id); if (entry) edit(entry)}}}
    requested(); window.addEventListener('cover-wall-edit', requested); return () => window.removeEventListener('cover-wall-edit', requested)
  }, [state])
  if (!api) return null
  async function run(action: () => Promise<void>) {if (busy) return; setBusy(true); setError(''); setMessage(''); try {await action()} catch (reason) {setError(String(reason).replace(/^Error:.*?: /, ''))} finally {setBusy(false)}}
  async function switchMode(mode: CoverConfig['mode']) {
    if (!api || !state || state.config.mode === mode) return
    await run(async () => {
      const next = await api.configure({...state.config, mode})
      setState(next); setConfig(previous => previous ? {...previous, mode} : next.config)
      setMessage(`已切换为${mode === 'photo' ? '照片墙' : '整齐网格'}${next.status.enabled ? '，桌面已同步更新' : '，可启用桌面收藏墙或全屏浏览'}`)
    })
  }
  const filtered = state?.entries.filter(entry => `${entry.content.description} ${entry.content.source} ${entry.content.tags.join(' ')} ${entry.content.url}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) || []
  const eligible = state?.entries.filter(entry => coverAllowed(entry.content, state.config.rules)).length || 0
  return <section className="glass coverwall-manager" id="customize-cover-wall" tabIndex={-1} aria-labelledby="coverwall-title">
    <header><div><span className="en-label">YOUR COLLECTION / COVER WALL</span><h2 id="coverwall-title">桌面收藏墙</h2><p>只看见喜欢的封面。点一下，回到它原本的地方。</p></div><div className="cw-actions">
      <button className="btn primary" disabled={busy || !state || !state.status.supported} onClick={() => void run(async () => {setState(await api.setEnabled(!state!.status.enabled))})}>{state?.status.enabled ? '停止桌面收藏墙' : '启用桌面收藏墙'}</button>
      <button className="btn" disabled={busy || !state} onClick={() => void run(() => api.fullscreen())}>全屏浏览</button>
    </div></header>
    <p className="cw-help">{state ? `${state.entries.length} 条收藏 · ${eligible} 条参与展示 · ${state.status.phase === 'running' ? '正在桌面显示' : state.status.phase === 'starting' ? '正在连接桌面…' : '桌面展示已停止'}` : '正在读取内容库…'}。悬停暂停，网格可滚轮浏览；关闭学习窗口后在托盘继续运行，退出心海会一起关闭。</p>
    <div className="cw-mode-switch" role="group" aria-label="收藏墙展示方式">{([['grid','整齐网格'],['photo','照片墙']] as const).map(([mode,label]) => <button key={mode} data-cover-mode={mode} className={`btn${state?.config.mode === mode ? ' primary' : ''}`} aria-pressed={state?.config.mode === mode} disabled={busy || !state} onClick={() => void switchMode(mode)}>{label}</button>)}<small>点击立即切换，桌面与全屏浏览同步更新。</small></div>
    {config && <details className="cw-settings"><summary>屏幕、区域与分区规则</summary><div className="cw-settings-grid">
      <label>显示屏幕<select value={config.displayId ?? ''} onChange={event => setConfig({...config, displayId: event.target.value === '' ? null : Number(event.target.value)})}><option value="">跟随主屏</option>{state?.displays.map(display => <option key={display.id} value={display.id}>{display.label}</option>)}</select></label>
      <label>封面大小 · {config.cardSize}px<input aria-label="封面大小" type="range" min={100} max={320} step={10} value={config.cardSize} onChange={event => setConfig({...config, cardSize: Number(event.target.value)})}/></label>
      <label>网格速度 · {config.speed}px/s<input aria-label="网格速度" type="range" min={2} max={30} step={1} value={config.speed} onChange={event => setConfig({...config, speed: Number(event.target.value)})}/></label>
      <label>只显示这些分区 tag<input value={only} placeholder="留空显示全部；多个 tag 用逗号分隔" onChange={event => setOnly(event.target.value)}/></label>
      <label>不显示这些分区 tag<input value={hide} placeholder="排除规则优先；多个 tag 用逗号分隔" onChange={event => setHide(event.target.value)}/></label>
    </div><fieldset className="cw-region"><legend>桌面组件区域 · 占所选屏幕的百分比</legend>{([['x','距左'],['y','距上'],['width','宽度'],['height','高度']] as const).map(([key,label]) => <label key={key}>{label}<input aria-label={`区域${label}`} type="number" min={key === 'x' || key === 'y' ? 0 : 10} max={100} value={Math.round(config.region[key] * 100)} onChange={event => setConfig({...config, region: {...config.region, [key]: Number(event.target.value) / 100}})}/><span>%</span></label>)}</fieldset>
      <div className="cw-actions"><button className="btn" disabled={busy} onClick={() => void run(async () => {const next = await api.configure({...config, rules: {onlyTags: tags(only), hideTags: tags(hide)}}); setState(next); setConfig(next.config); setMessage('展示方式与规则已应用')})}>应用展示设置</button><small>命中任一“只显示”分区即可；“不显示”优先。未设置 tag 的内容只在“只显示”留空时出现。</small></div>
    </details>}
    <div className="cw-library-tools"><button className="btn" disabled={busy} onClick={() => edit()}>＋ 添加内容</button><button className="btn" disabled={busy} onClick={() => void run(async () => {const result = await api.importJson(); if (result) {setState(result.state); setMessage(`已合并 ${result.count} 条内容，重复链接已跳过`)}})}>导入 JSON</button><button className="btn" disabled={busy} onClick={() => void run(async () => {const file = await api.exportJson(); if (file) setMessage('已导出收藏与本机封面')})}>导出 JSON</button><input type="search" aria-label="搜索收藏" value={query} placeholder="搜索描述、来源、tag 或链接" onChange={event => {setQuery(event.target.value); setLimit(60)}}/></div>
    {draft && <form className="cw-editor" onSubmit={event => {event.preventDefault(); void run(async () => {setState(await api.save(editing, {...draft, tags: tags(draftTags)})); setDraft(null); setMessage('收藏已保存')})}}>
      <h3>{editing ? '编辑收藏' : '添加收藏'}</h3><div className="cw-editor-fields">
        <label className="cw-cover-input">封面<input aria-label="封面地址" value={draft.cover} placeholder="https://… 或选择本机图片" onChange={event => setDraft({...draft, cover: event.target.value})}/><button type="button" className="btn" disabled={busy} onClick={() => void run(async () => {const cover = await api.pickCover(); if (cover) setDraft({...draft, cover})})}>选择本机封面</button></label>
        <label>时间<input value={draft.time || ''} placeholder="例如 2026-11-03，可留空" maxLength={80} onChange={event => setDraft({...draft, time: event.target.value || null})}/></label>
        <label>来源<input value={draft.source} placeholder="Steam / bilibili / RSS / 书籍…" maxLength={120} onChange={event => setDraft({...draft, source: event.target.value})}/></label>
        <label className="cw-wide cw-target-input">URL / 打开目标<input aria-label="收藏链接" value={draft.url} placeholder="网页、Steam 链接，或本机图片/书籍路径" maxLength={8192} onChange={event => setDraft({...draft, url: event.target.value})}/><button type="button" className="btn" disabled={busy} onClick={() => void run(async () => {const target = await api.pickTarget(); if (target) setDraft({...draft, url: target})})}>选择本机文件</button></label>
        <label className="cw-wide">描述<textarea value={draft.description} placeholder="只在这里显示，桌面仅显示封面" maxLength={1600} onChange={event => setDraft({...draft, description: event.target.value})}/></label>
        <label className="cw-wide">分区 tag<input value={draftTags} placeholder="游戏, 待玩, 安静…" onChange={event => setDraftTags(event.target.value)}/></label>
      </div><div className="cw-actions"><button type="submit" className="btn primary" disabled={busy}>保存收藏</button><button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>取消</button><small>六项属性中只有封面会出现在桌面。保存后可点下方“打开”，也可点击桌面或全屏中的封面。链接留空时会回到编辑。</small></div>{error && <p role="alert" className="cw-message">{error}</p>}
    </form>}
    {state && !state.entries.length && <div className="cw-library-empty"><strong>把已经挑选过的内容，放回视线里。</strong><p>添加第一张封面与链接，或导入收藏 JSON。这里不会自动拉取推荐流。</p></div>}
    <div className="cw-library">{filtered.slice(0,limit).map(entry => <article key={entry.id} data-cover-entry={entry.id} className={!coverAllowed(entry.content, state!.config.rules) ? 'cw-excluded' : ''}><button className="cw-library-cover" onClick={() => edit(entry)} aria-label={`编辑 ${entry.content.description || entry.content.source || '收藏'}`}><img src={entry.content.cover} alt="" loading="lazy"/></button><div><strong>{entry.content.description || '未填写描述'}</strong><small>{entry.content.source || '未填写来源'}{entry.content.time ? ` · ${entry.content.time}` : ''}</small><small>{entry.content.tags.join(' / ') || '未分区'}{!coverAllowed(entry.content, state!.config.rules) ? ' · 已被规则隐藏' : ''}</small><div className="cw-actions"><button className="btn cw-open-target" disabled={busy || !entry.content.url} title={entry.content.url ? '打开原内容' : '请先编辑并填写打开目标'} onClick={() => void run(() => api.open(entry.id))}>打开</button><button className="btn" disabled={busy} onClick={() => edit(entry)}>编辑</button><button className="btn" disabled={busy} onClick={() => {if (window.confirm('从收藏墙移除这条内容？原网页、游戏或书籍不会删除。')) void run(async () => {setState(await api.remove(entry.id)); if (editing === entry.id) setDraft(null)})}}>移除</button></div></div></article>)}</div>
    {filtered.length > limit && <button className="btn" onClick={() => setLimit(limit + 60)}>继续显示 · 还有 {filtered.length - limit} 条</button>}
    {message && <p role="status" className="cw-message">{message}</p>}{((!draft && error) || state?.status.error) && <p role="alert" className="cw-message">{!draft && error || state?.status.error}</p>}
  </section>
}
