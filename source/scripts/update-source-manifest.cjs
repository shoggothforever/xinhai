// Regenerate the existing source integrity inventory after deliberate edits.
// check:source remains the independent verifier of scope and file hashes.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const manifestPath = path.join(root, 'docs/source-manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const excluded = new Set(manifest.excludedGeneratedDirectories)
const files = []
function visit(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name), relative = path.relative(root, file).replaceAll('\\', '/')
    if (excluded.has(entry.name) || ['build/desktop-host', 'src/renderer/public/personal-media', 'docs/source-manifest.json'].includes(relative)) continue
    if (entry.isSymbolicLink()) throw new Error('Unexpected source symlink: ' + relative)
    if (entry.isDirectory()) visit(file)
    else { const data = fs.readFileSync(file); files.push({path: relative, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex')}) }
  }
}
visit(root)
manifest.files = files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
manifest.fileCount = files.length
manifest.excludedGeneratedPaths = ['build/desktop-host', 'src/renderer/public/personal-media']
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log('Updated source inventory: ' + files.length + ' inputs')
