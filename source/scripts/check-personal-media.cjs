const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const Module = require('node:module')
const {buildSync} = require('esbuild')
const root = path.resolve(__dirname, '..')
function load(catalog) {
  const options = {__PERSONAL_EDITION__: 'true', __COMMERCIAL_EDITION__: 'false'}
  if (catalog) options.__PERSONAL_MEDIA__ = JSON.stringify(catalog)
  const built = buildSync({stdin: {contents: "export {sceneCatalog} from './src/shared/sceneCatalog';export {visibleCharacterArt,visibleCharacterArtGroups} from './src/shared/characterArt';export {PERSONAL_APPEARANCE_PRESET} from './src/shared/personalAppearance';export {personalAsset} from './src/shared/personalMedia'", resolveDir: root}, bundle: true, platform: 'node', format: 'cjs', write: false, define: options})
  const mod = new Module(__filename, module); mod._compile(built.outputFiles[0].text, __filename)
  return mod.exports
}
const clean = load()
assert.equal(clean.sceneCatalog.length, 3)
assert.equal(clean.visibleCharacterArt.length, 0)
assert.equal(clean.PERSONAL_APPEARANCE_PRESET.clockStyle, 'minimal')
assert.equal(clean.personalAsset('design/p3r/player-body.png', 'fallback.svg'), 'fallback.svg')
const catalogPath = path.join(root, 'src/renderer/public/personal-media/catalog.json')
if (fs.existsSync(catalogPath)) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const local = load(catalog)
  assert.equal(local.sceneCatalog.length, catalog.scenes.length + 3)
  assert.equal(local.visibleCharacterArtGroups.length, 3)
  assert.equal(local.visibleCharacterArt.length, 14)
  assert.equal(local.PERSONAL_APPEARANCE_PRESET.clockStyle, 'p3r')
  assert.equal(local.PERSONAL_APPEARANCE_PRESET.playerStyle, 'mp3')
  assert.equal(local.PERSONAL_APPEARANCE_PRESET.showCharacter, true)
  for (const uri of Object.values(catalog.assets)) {
    assert.ok(uri.startsWith('personal-media/') && !uri.includes('..'))
    assert.ok(fs.existsSync(path.join(root, 'src/renderer/public', decodeURIComponent(uri))))
  }
  console.log('PASS local P3R catalog: ' + catalog.scenes.length + ' scenes, 3 characters/14 variants, clock, skin and all media paths')
}
console.log('PASS clean source remains neutral and builds without optional personal assets')
