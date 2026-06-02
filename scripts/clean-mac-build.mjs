import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()

const targets = [
  '.next',
  path.join('dist-desktop', 'mac-arm64'),
  path.join('dist-desktop', 'builder-debug.yml'),
  path.join('dist-desktop', 'builder-effective-config.yaml'),
]

for (const target of targets) {
  await fs.rm(path.join(root, target), { recursive: true, force: true })
}
