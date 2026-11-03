const fs = require('node:fs')
const path = require('node:path')
module.exports = function personalMediaDefine() {
  const file = path.resolve(__dirname, '../src/renderer/public/personal-media/catalog.json')
  if (!fs.existsSync(file)) return JSON.stringify({available: false, scenes: [], characterArtIds: [], assets: {}})
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (catalog.available !== true || !Array.isArray(catalog.scenes) || !Array.isArray(catalog.characterArtIds) || !catalog.assets || typeof catalog.assets !== 'object') throw Error('Invalid local personal media catalog')
  return JSON.stringify(catalog)
}
