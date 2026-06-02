import fs from 'node:fs'
import path from 'node:path'

const inputRoot = process.argv[2]

if (!inputRoot) {
  console.error('Usage: node scripts/patch-next-react-loadable-manifests.mjs <next-root>')
  process.exit(1)
}

const nextRoot = path.resolve(inputRoot)
const manifestRoots = [
  path.join(nextRoot, 'server'),
  path.join(nextRoot, 'standalone', '.next', 'server'),
].filter(dir => fs.existsSync(dir))
const staticRoot = fs.existsSync(path.join(nextRoot, 'static'))
  ? path.join(nextRoot, 'static')
  : path.join(nextRoot, 'standalone', '.next', 'static')

if (manifestRoots.length === 0 || !fs.existsSync(staticRoot)) {
  console.error(`Next build output is incomplete: ${nextRoot}`)
  process.exit(1)
}

const manifestFiles = []
let patchedFiles = 0
let removedRefs = 0

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(filePath, onFile)
    } else {
      onFile(filePath)
    }
  }
}

for (const root of manifestRoots) {
  walk(root, filePath => {
    if (filePath.endsWith('react-loadable-manifest.json')) {
      manifestFiles.push(filePath)
    }
  })
}

for (const filePath of manifestFiles) {
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  let changed = false

  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.files)) continue
    const nextFiles = entry.files.filter(file => {
      if (typeof file !== 'string' || !file.startsWith('static/')) return true
      const normalizedAsset = file.replace(/^static\//, '')
      const exists = fs.existsSync(path.join(staticRoot, normalizedAsset))
      if (!exists) removedRefs += 1
      return exists
    })

    if (nextFiles.length !== entry.files.length) {
      entry.files = nextFiles
      changed = true
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`)
    patchedFiles += 1
  }
}

console.log(`Patched ${patchedFiles} react-loadable manifest(s); removed ${removedRefs} missing static reference(s).`)
