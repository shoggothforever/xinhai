// Read only media from an existing local personal installation. Never load its
// executable code, profile, database, model settings or private user files.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')
const root = path.resolve(__dirname, '..')
const archive = path.resolve(process.argv[2] || path.join(process.env.LOCALAPPDATA || '', 'Programs/xinhai/resources/app.asar'))
if (!fs.existsSync(archive) || path.basename(archive) !== 'app.asar') throw Error('Pass the existing personal installation resources/app.asar path')
const destination = path.join(root, 'src/renderer/public/personal-media')
if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw Error('Local media directory cannot be a symlink')
fs.mkdirSync(destination, {recursive: true})
const assets = {}, hashes = {}
const entries = asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, ''))
const prefix = 'out/renderer/'
const uri = relative => 'personal-media/' + relative.split('/').map(encodeURIComponent).join('/')
const safe = relative => !relative.split('/').some(part => !part || part === '.' || part === '..' || /[:\\]/.test(part))
let bytes = 0
function copy(entry, relative) {
  if (!safe(relative)) throw Error('Invalid media path')
  const output = path.join(destination, ...relative.split('/'))
  // Do not traverse a pre-existing symlink inside the optional media tree.
  for (let current = path.dirname(output); current !== destination; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Media path traverses a symlink')
  }
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw Error('Media output cannot be a symlink')
  const buffer = asar.extractFile(archive, path.normalize(entry))
  fs.mkdirSync(path.dirname(output), {recursive: true})
  fs.writeFileSync(output, buffer)
  assets[relative] = uri(relative)
  hashes[relative] = crypto.createHash('sha256').update(buffer).digest('hex')
  bytes += buffer.length
}
for (const entry of entries) {
  if (!entry.startsWith(prefix)) continue
  const relative = entry.slice(prefix.length)
  if (!/^(backgrounds\/|characters\/|design\/p3r\/|music\/|voices\/|fonts\/)/.test(relative) && !/^design\/(?:BebasNeue|Outfit)[^/]*\.(?:ttf|txt)$/.test(relative)) continue
  if (!/\.(?:png|jpe?g|webp|svg|mp4|webm|ogg|mp3|wav|flac|m4a|ttf|woff2?|txt|json)$/i.test(relative)) continue
  copy(entry, relative)
}
for (const name of ['char-idle', 'char-focus', 'char-summon']) {
  const entry = entries.find(file => file.startsWith(prefix + 'assets/' + name + '-') && file.endsWith('.png'))
  if (entry) copy(entry, 'optional/' + name + '.png')
}
const catalogScenes = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/scenes.json'), 'utf8'))
const scenes = catalogScenes.filter(scene => scene.kind === 'procedural' || [scene.src, scene.poster, scene.intro].filter(Boolean).every(file => assets[file]))
  .map(scene => ({...scene, src: assets[scene.src] || scene.src, poster: assets[scene.poster] || scene.poster, ...(scene.intro ? {intro: assets[scene.intro]} : {})}))
const art = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/personalCharacterArt.json'), 'utf8'))
const characterArtIds = art.filter(item => assets[item.src] && hashes[item.src] === item.sha256).map(item => item.id)
if (!scenes.length || !assets['optional/char-idle.png']) throw Error('The selected package does not contain the expected personal media')
const css = '@font-face{font-family:"Bebas Neue";src:url("./design/BebasNeue-Regular.ttf");font-display:swap}\n@font-face{font-family:"Outfit";src:url("./design/Outfit-VariableFont_wght.ttf");font-display:swap}\n:root{--font-num:"Bebas Neue","Bahnschrift",sans-serif;--font-en:"Outfit","Bahnschrift",sans-serif}\n'
fs.writeFileSync(path.join(destination, 'appearance.css'), css)
assets['appearance.css'] = uri('appearance.css')
const catalog = {available: true, scenes, characterArtIds, assets}
fs.writeFileSync(path.join(destination, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
console.log(JSON.stringify({ok: true, scenes: scenes.length, characterArt: characterArtIds.length, mediaFiles: Object.keys(assets).length, bytes, destination: 'src/renderer/public/personal-media (Git ignored)'}))
