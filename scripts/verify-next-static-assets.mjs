import fs from 'node:fs'
import path from 'node:path'

const inputRoot = process.argv[2]

if (!inputRoot) {
  console.error('Usage: node scripts/verify-next-static-assets.mjs <next-root>')
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
const referencedAssets = new Set()
const missingAssets = new Set()

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
    if (
      filePath.endsWith('react-loadable-manifest.json') ||
      filePath.endsWith('build-manifest.json') ||
      filePath.endsWith('_client-reference-manifest.js')
    ) {
      manifestFiles.push(filePath)
    }
  })
}

for (const filePath of manifestFiles) {
  const content = fs.readFileSync(filePath, 'utf8')
  for (const match of content.matchAll(/static\/[A-Za-z0-9_./[\]-]+?\.(?:js|css)/g)) {
    referencedAssets.add(match[0])
  }
}

for (const asset of referencedAssets) {
  const normalizedAsset = asset.replace(/^static\//, '')
  if (!fs.existsSync(path.join(staticRoot, normalizedAsset))) {
    missingAssets.add(asset)
  }
}

if (missingAssets.size > 0) {
  console.error('Next build references missing static assets:')
  for (const asset of [...missingAssets].sort()) {
    console.error(`- ${asset}`)
  }
  process.exit(1)
}

console.log(`Verified ${referencedAssets.size} Next static asset reference(s).`)
