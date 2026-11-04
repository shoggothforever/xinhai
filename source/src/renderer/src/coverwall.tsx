import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { placeCoverPhoto, type CoverTile, type CoverViewSnapshot, type PhotoPlacement } from '../../shared/coverWall'
import './styles/coverwall-view.css'

function Wall({view}: {view: CoverViewSnapshot}) {
  const root = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({width: 800, height: 600}), [row, setRow] = useState(0)
  const [photos, setPhotos] = useState<PhotoPlacement[]>([]), [hover, setHover] = useState(false), [error, setError] = useState('')
  const offset = useRef(0), activeTime = useRef(0), hoverRef = useRef(false), manualUntil = useRef(0)
  const columns = Math.max(1, Math.floor((size.width - 28) / (view.cardSize + 18)))
  const cardWidth = Math.max(1, Math.min(view.cardSize, (size.width - 28 - (columns - 1) * 18) / columns))
  const pitch = cardWidth * 1.5 + 18, totalRows = Math.max(1, Math.ceil(view.covers.length / columns))
  const paused = view.paused || hover
  useEffect(() => { const observer = new ResizeObserver(([entry]) => {const {width,height} = entry.contentRect; if (width > 0 && height > 0) setSize({width,height})}); if (root.current) observer.observe(root.current); return () => observer.disconnect() }, [])
  useEffect(() => { hoverRef.current = hover }, [hover])
  useEffect(() => {offset.current = 0; setRow(0); setPhotos([]); activeTime.current = 0}, [view.mode, view.covers, view.cardSize, size.width, size.height])
  useEffect(() => {
    if (view.mode !== 'grid') return
    let frame = 0, previous = performance.now()
    const animate = (now: number) => {
      const dt = Math.min(80, now - previous); previous = now
      if (!view.paused && !hoverRef.current && now > manualUntil.current) {
        offset.current = (offset.current + dt * view.speed / 1000) % (totalRows * pitch)
      }
      if (view.mode === 'grid') {
        const nextRow = Math.floor(offset.current / pitch); setRow(old => old === nextRow ? old : nextRow)
        if (grid.current) grid.current.style.transform = `translateY(${-offset.current % pitch}px)`
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame)
  }, [view.paused, view.mode, view.speed, totalRows, pitch])
  useEffect(() => {
    if (view.mode !== 'photo') return
    let retryAt = 0
    const fill = (old: PhotoPlacement[]) => {
      const now = activeTime.current
      let next = old.filter(photo => !photo.leaving || now - photo.born < 1400)
      if (!view.paused && !hoverRef.current) next = next.map(photo => !photo.leaving && now - photo.born > 22000 + photo.x * 18 ? {...photo, leaving: true, born: now} : photo)
      const target = Math.min(28, view.covers.length, Math.max(1, Math.floor(size.width * size.height / (view.cardSize ** 2 * 2.5))))
      if (next.length >= target || next.length === old.length && now < retryAt) return next.length === old.length && next.every((photo,index) => photo === old[index]) ? old : next
      retryAt = now + 4000
      const available = view.covers.filter(tile => !next.some(photo => photo.tile.id === tile.id))
      for (let attempt = 0; attempt < 48 && available.length && next.length < target; attempt++) {
        const index = Math.floor(Math.random() * available.length), tile = available.splice(index, 1)[0]
        const placed = placeCoverPhoto(tile, size.width, size.height, next, view.cardSize, now)
        if (placed) next.push(placed)
      }
      return next
    }
    let last = performance.now()
    const tick = () => {const now = performance.now(); if (!view.paused && !hoverRef.current) activeTime.current += Math.min(1000, now - last); last = now; setPhotos(old => fill(old))}
    setPhotos(old => fill(old)); const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [view.mode, view.covers, view.cardSize, view.paused, size.width, size.height])
  useEffect(() => {
    if (view.fullscreen) return
    let last = ''
    const report = () => {if (root.current) {const rects = [...root.current.querySelectorAll<HTMLElement>('.cw-cover')].map(element => {const r = element.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}}), encoded = JSON.stringify(rects); if (encoded !== last) {last = encoded; window.coverWallView.shape(rects)}}}
    report(); const timer = setInterval(report, 100); return () => clearInterval(timer)
  }, [view.fullscreen])
  useEffect(() => {const key = (event: KeyboardEvent) => {if (event.key === 'Escape') window.coverWallView.close()}; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)}, [])
  async function open(tile: CoverTile) {try {setError(''); await window.coverWallView.open(tile.id)} catch {if (view.fullscreen) setError('无法打开这条收藏，请返回心海检查链接。')}}
  const cover = (tile: CoverTile, key: string, style?: React.CSSProperties) => <button key={key} className="cw-cover" data-cover-id={tile.id} style={style} aria-label="打开收藏" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} onClick={() => void open(tile)}><img src={tile.cover} alt="" draggable={false} onError={event => event.currentTarget.classList.add('cw-missing')}/></button>
  return <div ref={root} data-paused={paused} className={`cw-wall ${view.fullscreen ? 'cw-full' : ''} ${view.mode}`} onMouseMove={event => setHover(Boolean((event.target as Element).closest('.cw-cover')))} onMouseLeave={() => setHover(false)} onWheel={event => {if (view.mode !== 'grid') return; offset.current = ((offset.current + event.deltaY) % (totalRows * pitch) + totalRows * pitch) % (totalRows * pitch); setRow(Math.floor(offset.current / pitch)); if (grid.current) grid.current.style.transform = `translateY(${-offset.current % pitch}px)`; manualUntil.current = performance.now() + 2500}}>
    {view.mode === 'grid' && view.covers.length > 0 && <div className="cw-grid" ref={grid} style={{gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`, gridAutoRows: cardWidth * 1.5, paddingLeft: Math.max(14, (size.width - columns * cardWidth - (columns - 1) * 18) / 2)}}>
      {Array.from({length: Math.min(1100, (Math.ceil(size.height / pitch) + 2) * columns)}, (_, index) => {
        const absolute = (row * columns + index) % (totalRows * columns), tile = view.covers[absolute % view.covers.length]
        return cover(tile, String(row * columns + index))
      })}
    </div>}
    {view.mode === 'photo' && photos.map(photo => <div key={photo.tile.id} className={`cw-photo ${photo.leaving ? 'cw-leaving' : ''}`} style={{left: photo.x + (photo.width - photo.cardWidth) / 2, top: photo.y + (photo.height - photo.cardHeight) / 2, width: photo.cardWidth, height: photo.cardHeight, transform: `rotate(${photo.angle}deg)`, animation: view.paused ? 'none' : undefined, animationPlayState: paused ? 'paused' : 'running'}}>{cover(photo.tile, photo.tile.id)}</div>)}
    {view.fullscreen && <nav className="cw-tools"><span>心海 / 收藏墙</span><button onClick={() => window.coverWallView.close()}>返回 · Esc</button></nav>}
    {view.fullscreen && !view.covers.length && <p className="cw-empty">当前没有可展示的封面。请返回心海添加内容，或调整分区 tag 规则。</p>}
    {error && <p className="cw-error" role="alert">{error}</p>}
  </div>
}
function App() {
  const [view, setView] = useState<CoverViewSnapshot | null>(null)
  useEffect(() => {
    let mounted = true
    const accept = (value: CoverViewSnapshot) => {if (mounted) setView(previous => {
      const same = previous && previous.covers.length === value.covers.length && previous.covers.every((tile,index) => tile.id === value.covers[index].id && tile.cover === value.covers[index].cover && tile.aspect === value.covers[index].aspect)
      return same ? {...value, covers: previous.covers} : value
    })}
    const off = window.coverWallView.onChanged(accept); void window.coverWallView.snapshot().then(accept)
    return () => {mounted = false; off()}
  }, [])
  return view ? <Wall view={view}/> : null
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
