import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

interface ManifestEntry {
  file: string
  css?: string[]
  assets?: string[]
}

/** Stamp the worker with this build's lazy chunks so updates also work offline. */
function serviceWorkerManifest(): Plugin {
  const root = fileURLToPath(new URL('.', import.meta.url))
  return {
    name: 'feltmath-service-worker-manifest',
    apply: 'build',
    closeBundle() {
      const dist = resolve(root, 'dist')
      const manifestSource = readFileSync(resolve(dist, 'manifest.json'), 'utf8')
      const manifest = JSON.parse(manifestSource) as Record<string, ManifestEntry>
      const assets = new Set<string>(['./manifest.json'])
      for (const entry of Object.values(manifest)) {
        assets.add(`./${entry.file}`)
        for (const file of entry.css ?? []) assets.add(`./${file}`)
        for (const file of entry.assets ?? []) assets.add(`./${file}`)
      }

      const version = createHash('sha256').update(manifestSource).digest('hex').slice(0, 12)
      const template = readFileSync(resolve(root, 'public/sw.js'), 'utf8')
      const worker = template
        .replace('__FELTMATH_BUILD_VERSION__', version)
        .replace('/*__FELTMATH_BUILD_ASSETS__*/ []', JSON.stringify([...assets].sort()))
      writeFileSync(resolve(dist, 'sw.js'), worker)
    },
  }
}

// base './' keeps the build relocatable (works at chronick.github.io/blackjack-trainer)
export default defineConfig({
  plugins: [react(), serviceWorkerManifest()],
  base: './',
  build: {
    // The service worker consumes this to precache hashed entry and lazy chunks.
    manifest: 'manifest.json',
  },
})
