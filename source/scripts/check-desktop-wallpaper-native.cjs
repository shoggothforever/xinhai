const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const {spawnSync} = require('node:child_process')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'dist', 'desktop-wallpaper-test')

if (!process.versions.electron) {
  if (process.platform !== 'win32') { console.log('SKIP Windows desktop integration'); process.exit(0) }
  fs.mkdirSync(output, {recursive: true})
  const {buildSync} = require('esbuild')
  const options = {bundle: true, platform: 'node', format: 'cjs', external: ['electron'], define: {__COMMERCIAL_EDITION__: 'false', __PERSONAL_EDITION__: 'true'}}
  buildSync({...options, entryPoints: [path.join(root, 'src/main/desktopWallpaper.ts')], outfile: path.join(output, 'controller.cjs')})
  buildSync({...options, entryPoints: [path.join(root, 'src/shared/types.ts')], outfile: path.join(output, 'fixtures.cjs')})
  // The controller's compiled __dirname must have the same layout as production.
  fs.copyFileSync(path.join(output, 'controller.cjs'), path.join(root, 'out/main/desktop-wallpaper-test.cjs'))
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], {cwd: root, env, stdio: 'inherit', timeout: 90000, windowsHide: true})
  if (result.error) throw result.error
  process.exit(result.status === 0 ? 0 : 1)
}

const {app, BrowserWindow, powerMonitor, screen} = require('electron')
app.setAppPath(root)
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'xinhai-wallpaper-test-')))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async predicate => { for (let i = 0; i < 60; i++) { if (await predicate()) return; await wait(100) } throw new Error('Timed out waiting for wallpaper state') }
let controller, main
app.whenReady().then(async () => {
  try {
    const {DesktopWallpaper} = require(path.join(root, 'out/main/desktop-wallpaper-test.cjs'))
    const {DEFAULT_SETTINGS} = require(path.join(output, 'fixtures.cjs'))
    let settings = {...DEFAULT_SETTINGS, background: 'original-deep-sea', clockStyle: 'minimal', sceneTransition: 'none', showCharacter: false}
    const statuses = []
    main = new BrowserWindow({show: false})
    await main.loadURL('about:blank')
    controller = new DesktopWallpaper({readSettings: () => settings, showMain: () => {}, icon: path.join(root, 'src/renderer/public/design/app-icon.png'), onStatus: status => statuses.push(status)})
    await assert.rejects(controller.setEnabled('yes'), /无效/)
    const status = await controller.setEnabled(true)
    assert.equal(status.phase, 'running')
    const getWallpaper = () => BrowserWindow.getAllWindows().find(window => window.getTitle() === '心海共学 · 桌面壁纸')
    let wallpaper = getWallpaper()
    assert.ok(wallpaper)
    await until(() => wallpaper.webContents.executeJavaScript('Boolean(document.querySelector(".desktop-clock"))'))
    const handle = wallpaper.getNativeWindowHandle()
    const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE())
    const hostFile = path.join(root, 'build/desktop-host/DesktopWallpaperHost.exe')
    const inspect = spawnSync(hostFile, ['--inspect', hwnd], {encoding: 'utf8', windowsHide: true})
    assert.equal(inspect.status, 0)
    const native = JSON.parse(inspect.stdout)
    assert.equal(native.exists, true)
    assert.match(native.parentClass, /^(WorkerW|Progman)$/)
    const primary = screen.getPrimaryDisplay()
    assert.ok(Math.abs(native.width - primary.bounds.width * primary.scaleFactor) < 3)
    assert.ok(Math.abs(native.height - primary.bounds.height * primary.scaleFactor) < 3)
    const boundary = await wallpaper.webContents.executeJavaScript('({api:typeof window.api,view:typeof window.desktopWallpaperView,mainPage:!!document.querySelector(".window-bar")})')
    assert.deepEqual(boundary, {api: 'undefined', view: 'object', mainPage: false})
    assert.throws(() => controller.snapshotHandler({sender: main.webContents, senderFrame: main.webContents.mainFrame}), /拒绝/)
    const snapshot = await wallpaper.webContents.executeJavaScript('window.desktopWallpaperView.snapshot()')
    assert.equal(Object.hasOwn(snapshot.settings, 'llmKey'), false)
    await controller.setEnabled(true)
    assert.equal(getWallpaper().id, wallpaper.id, 'enabling twice must not duplicate renderers')
    settings = {...settings, background: 'original-forest-dawn'}
    controller.syncSettings()
    await until(() => wallpaper.webContents.executeJavaScript('document.querySelector(".scene-media")?.dataset.scene === "original-forest-dawn"'))
    powerMonitor.emit('lock-screen')
    await until(() => wallpaper.webContents.executeJavaScript('document.body.classList.contains("wallpaper-paused")'))
    powerMonitor.emit('unlock-screen')
    // A fullscreen foreground application can independently keep playback paused.
    assert.equal(controller.pauseReasons.has('session'), false)
    await until(() => wallpaper.webContents.executeJavaScript('Boolean(document.querySelector(".scene-media img")?.naturalWidth)'))
    await wait(400)
    const image = await wallpaper.webContents.capturePage()
    fs.writeFileSync(path.join(output, 'wallpaper.png'), image.toPNG())
    const pixels = image.toBitmap(), imageSize = image.getSize(), colors = new Set()
    for (const x of [.1, .3, .5, .7, .9]) for (const y of [.2, .4, .6, .8]) {
      const offset = (Math.floor(y * imageSize.height) * imageSize.width + Math.floor(x * imageSize.width)) * 4
      colors.add(pixels.subarray(offset, offset + 3).toString('hex'))
    }
    if (colors.size < 5) console.error(await wallpaper.webContents.executeJavaScript('JSON.stringify([...document.querySelectorAll(".scene-media, .scene-media img, .background-stack, .background-plane")].map(e=>({tag:e.tagName,cls:e.className,src:e.src,loaded:e.naturalWidth,rect:e.getBoundingClientRect().toJSON(),style:getComputedStyle(e).cssText,position:getComputedStyle(e).position})))'))
    assert.ok(colors.size >= 5, 'wallpaper must show scene pixels, not only a flat fallback color')
    // Optional caller-owned media exercises real decoding without adding any
    // third-party videos to the source tree or depending on network in tests.
    let videoChecked = false
    if (process.env.XINHAI_TEST_VIDEO) {
      // Ensure a fullscreen app in the user's foreground does not intentionally
      // suppress the playback we are about to test.
      main.show(); main.focus()
      await until(() => !controller.getStatus().paused)
      const videoPath = path.resolve(process.env.XINHAI_TEST_VIDEO)
      assert.ok(fs.statSync(videoPath).size > 200, 'video fixture must contain media data')
      settings = {...settings, background: 'custom', customBackground: {name: 'Playback check', kind: 'video', src: require('node:url').pathToFileURL(videoPath).href, poster: 'backgrounds/originals/forest-dawn.svg'}}
      controller.syncSettings()
      await wallpaper.webContents.executeJavaScript('window.__mediaErrors=[]; document.addEventListener("error",e=>{if(e.target instanceof HTMLVideoElement)window.__mediaErrors.push(e.target.error?.message)},true)')
      await until(() => wallpaper.webContents.executeJavaScript('Boolean(document.querySelector("video")?.currentTime > .05 && !document.querySelector("video").paused)')).catch(async error => {
        console.error('Playback diagnostics', controller.getStatus(), await wallpaper.webContents.executeJavaScript('JSON.stringify({hidden:document.hidden,errors:window.__mediaErrors,videos:[...document.querySelectorAll("video")].map(v=>({ready:v.readyState,time:v.currentTime,paused:v.paused,error:v.error?.message})),scene:document.querySelector(".scene-media")?.dataset})'))
        throw error
      })
      powerMonitor.emit('lock-screen')
      await until(() => wallpaper.webContents.executeJavaScript('!document.querySelector("video")'))
      powerMonitor.emit('unlock-screen')
      await until(() => wallpaper.webContents.executeJavaScript('Boolean(document.querySelector("video")?.currentTime > .05 && !document.querySelector("video").paused)'))
      videoChecked = true
    }
    // Simulate losing the child window without restarting the user's Explorer.
    const previousId = wallpaper.id
    wallpaper.destroy()
    await until(() => controller.getStatus().phase === 'running' && getWallpaper()?.id !== previousId)
    wallpaper = getWallpaper()
    assert.ok(wallpaper)
    controller.stop()
    assert.equal(controller.getStatus().phase, 'off')
    assert.equal(getWallpaper(), undefined)
    const stopped = spawnSync(hostFile, ['--inspect', hwnd], {encoding: 'utf8', windowsHide: true})
    assert.equal(JSON.parse(stopped.stdout).exists, false)
    await controller.setEnabled(true)
    controller.stop()
    const invalid = spawnSync(hostFile, ['0'], {encoding: 'utf8', windowsHide: true})
    assert.equal(invalid.status, 1)
    assert.equal(JSON.parse(invalid.stdout).event, 'error')
    const report = {ok: true, native, boundary, videoChecked, checks: ['native desktop parent and physical display bounds', 'read-only renderer and sender guard', 'idempotent enable', 'live appearance updates and rendered scene pixels', 'session pause', ...(videoChecked ? ['actual video playback and pause/resume'] : []), 'lost-window recovery', 'stop and re-enable', 'invalid native handle rejection'], states: statuses.map(s => s.phase)}
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    controller.dispose(); main.destroy(); app.quit()
  } catch (error) {
    console.error(error)
    controller?.dispose(); main?.destroy(); app.exit(1)
  }
})
