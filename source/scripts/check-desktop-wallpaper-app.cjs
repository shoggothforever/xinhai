// Exercise the real application entry, database, preload and React control in
// an isolated profile. This test never reads the installed personal edition.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'dist', 'desktop-wallpaper-test')
if (!process.versions.electron) {
  const {spawnSync} = require('node:child_process')
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], {cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 90000})
  if (result.error) throw result.error
  process.exit(result.status === 0 ? 0 : 1)
}
const {app, BrowserWindow} = require('electron')
app.setAppPath(root)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xinhai-wallpaper-app-test-'))
app.commandLine.appendSwitch('xinhai-profile-root', profile)
app.commandLine.appendSwitch('xinhai-start-hidden')
require(path.join(root, 'out/main/index.js'))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await wait(100) } throw new Error('Timed out waiting for application UI') }
app.whenReady().then(async () => {
  let main
  try {
    await until(() => BrowserWindow.getAllWindows().length > 0)
    main = BrowserWindow.getAllWindows()[0]
    await until(() => main.webContents.executeJavaScript('Boolean(document.querySelector(".window-bar"))'))
    main.showInactive()
    await until(() => main.webContents.executeJavaScript('Boolean(document.querySelector(".startup-announcement")?.open)'))
    await main.webContents.executeJavaScript('document.querySelector(".announcement-primary").click()')
    await until(() => main.webContents.executeJavaScript('!document.querySelector(".startup-announcement").open'))
    const personalCatalogPath = path.join(root, 'src/renderer/public/personal-media/catalog.json')
    const personalMediaAvailable = fs.existsSync(personalCatalogPath)
    if (personalMediaAvailable) {
      await until(() => main.webContents.executeJavaScript('Boolean(document.querySelector(".scene-media img")?.naturalWidth && document.querySelector(".character-layer img")?.naturalWidth && document.querySelector(".portable-body")?.naturalWidth && document.querySelector(".p3r-clock"))'))
      await main.webContents.executeJavaScript('document.fonts.ready')
      await wait(600)
      fs.mkdirSync(output, {recursive: true})
      fs.writeFileSync(path.join(output, 'p3r-app.png'), (await main.webContents.capturePage()).toPNG())
    }
    await main.webContents.executeJavaScript('document.querySelector(".desktop-wallpaper-open").click()')
    await until(() => main.webContents.executeJavaScript('Boolean(document.querySelector("#customize-desktop-wallpaper .btn:not(:disabled)"))'))
    await until(() => main.webContents.executeJavaScript('document.activeElement?.id === "customize-desktop-wallpaper"'))
    const arrival = await main.webContents.executeJavaScript('(()=>{const e=document.getElementById("customize-desktop-wallpaper");const r=e.getBoundingClientRect();const nav=document.querySelector(".customization-index").getBoundingClientRect();return {visible:r.top>=0&&r.top<innerHeight-100,beforeIndex:r.top<nav.top}})()')
    assert.equal(arrival.visible, true, 'titlebar entry must reveal the desktop wallpaper controls')
    assert.equal(arrival.beforeIndex, true, 'desktop controls must precede the long settings index')
    assert.equal(await main.webContents.executeJavaScript('window.api.desktopWallpaperStatus().then(s=>s.enabled)'), false, 'opening settings must not implicitly enable wallpaper')
    fs.mkdirSync(output, {recursive: true})
    await wait(400)
    fs.writeFileSync(path.join(output, 'desktop-wallpaper-entry.png'), (await main.webContents.capturePage()).toPNG())
    if (personalMediaAvailable) {
      assert.equal(await main.webContents.executeJavaScript('document.querySelector(".personal-recommended-appearance").textContent.includes("P3R")'), true)
      await main.webContents.executeJavaScript('document.querySelector(".personal-recommended-appearance").click()')
      await until(() => main.webContents.executeJavaScript('document.querySelector(".personal-appearance-presets [role=status]").textContent.includes("已应用 P3R")'))
      assert.equal(await main.webContents.executeJavaScript('Boolean(document.querySelector("#customize-characters"))'), true)
    }
    await main.webContents.executeJavaScript('document.querySelector("#customize-desktop-wallpaper .btn").click()')
    await until(() => main.webContents.executeJavaScript('window.api.desktopWallpaperStatus().then(status=>status.phase === "running")'))
    const wallpaper = BrowserWindow.getAllWindows().find(w => w !== main)
    assert.ok(wallpaper)
    if (personalMediaAvailable) {
      await until(() => wallpaper.webContents.executeJavaScript('Boolean(document.querySelector(".scene-media img")?.naturalWidth && document.querySelector(".character-layer img")?.naturalWidth && document.querySelector(".p3r-clock"))'))
      await wallpaper.webContents.executeJavaScript('document.fonts.ready')
      await wait(600)
      const image = await wallpaper.webContents.capturePage(), size = image.getSize(), pixels = image.toBitmap(), colors = new Set()
      for (const x of [.1,.3,.5,.7,.9]) for (const y of [.2,.4,.6,.8]) { const offset = (Math.floor(y*size.height)*size.width+Math.floor(x*size.width))*4; colors.add(pixels.subarray(offset,offset+3).toString('hex')) }
      assert.ok(colors.size >= 5, 'P3R wallpaper must render the background and portrait, not only a flat fallback')
      fs.writeFileSync(path.join(output, 'p3r-wallpaper.png'), image.toPNG())
    }
    const stateBefore = await main.webContents.executeJavaScript('window.api.getState()')
    const sessionsBefore = await main.webContents.executeJavaScript('window.api.listFocus()')
    await main.webContents.executeJavaScript('window.api.updateSettings({background:"original-orbital-night",sceneTransition:"none"})')
    await until(() => wallpaper.webContents.executeJavaScript('document.querySelector(".desktop-wallpaper")?.dataset.scene === "original-orbital-night"'))
    fs.mkdirSync(output, {recursive: true})
    await wait(300)
    fs.writeFileSync(path.join(output, 'controls.png'), (await main.webContents.capturePage()).toPNG())
    main.close()
    assert.equal(main.isDestroyed(), false, 'closing with wallpaper active must keep the learning owner alive')
    assert.equal(main.isVisible(), false)
    const stateAfter = await main.webContents.executeJavaScript('window.api.getState()')
    assert.deepEqual(stateAfter.stats, stateBefore.stats)
    assert.deepEqual(await main.webContents.executeJavaScript('window.api.listFocus()'), sessionsBefore)
    await main.webContents.executeJavaScript('window.api.desktopWallpaperSetEnabled(false)')
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    const report = {ok: true, personalMediaAvailable, checks: [...(personalMediaAvailable ? ['P3R home scene, portrait, clock and player load', 'P3R preset and character gallery', 'P3R desktop portrait and clock render'] : []), 'titlebar opens visible desktop controls above settings index', 'opening controls does not implicitly enable wallpaper', 'real customize enable button', 'SQLite-backed appearance synchronization', 'close keeps learning window in tray', 'wallpaper does not add learning sessions or points', 'stop removes wallpaper window']}
    fs.writeFileSync(path.join(output, 'app-result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    app.quit()
  } catch (error) { console.error(error); app.exit(1) }
})
