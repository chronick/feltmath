import {
  PRELOAD_RELOAD_KEY,
  PRELOAD_RETRY_WINDOW_MS,
  installPreloadErrorRecovery,
  shouldReloadForPreloadError,
} from '../src/preloadRecovery'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let failures = 0
function check(label: string, ok: boolean): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}`)
  if (!ok) failures++
}

check('first stale-chunk error reloads', shouldReloadForPreloadError(null, 100_000))
check('invalid stored timestamp reloads', shouldReloadForPreloadError('invalid', 100_000))
check('recent retry does not reload-loop',
  !shouldReloadForPreloadError('100000', 100_000 + PRELOAD_RETRY_WINDOW_MS - 1))
check('expired retry window reloads again',
  shouldReloadForPreloadError('100000', 100_000 + PRELOAD_RETRY_WINDOW_MS))

let listener: ((event: Event) => void) | null = null
let reloads = 0
let prevented = 0
const values = new Map<string, string>()
const environment = {
  addEventListener(type: string, next: (event: Event) => void) {
    if (type === 'vite:preloadError') listener = next
  },
  getSessionStorage() {
    return {
      getItem(key: string) {
        return values.get(key) ?? null
      },
      setItem(key: string, value: string) {
        values.set(key, value)
      },
    }
  },
  location: {
    reload() {
      reloads++
    },
  },
}

installPreloadErrorRecovery(environment, () => 100_000)
const event = { preventDefault: () => prevented++ } as Event
listener?.(event)
listener?.(event)

check('handler records its deployment retry', values.get(PRELOAD_RELOAD_KEY) === '100000')
check('handler prevents and reloads the first failure', reloads === 1 && prevented === 1)
check('handler leaves a repeated failure visible', reloads === 1 && prevented === 1)

let unavailableStorageListener: ((event: Event) => void) | null = null
let unavailableStorageReloads = 0
installPreloadErrorRecovery({
  addEventListener(_type, next) {
    unavailableStorageListener = next
  },
  getSessionStorage() {
    throw new Error('SecurityError')
  },
  location: {
    reload() {
      unavailableStorageReloads++
    },
  },
})
let unavailableStoragePrevented = 0
unavailableStorageListener?.({ preventDefault: () => unavailableStoragePrevented++ } as Event)
check('unavailable storage neither crashes nor reload-loops',
  unavailableStorageReloads === 0 && unavailableStoragePrevented === 0)

const headers = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8')
check('Cloudflare keeps the app shell revalidated',
  /\/\n  Cache-Control: no-cache/.test(headers)
    && /\/index\.html\n  Cache-Control: no-cache/.test(headers))
check('Cloudflare revalidates service-worker metadata',
  /\/sw\.js\n  Cache-Control: no-cache/.test(headers))
check('Cloudflare does not retain stale asset fallbacks',
  /\/assets\/\*\n  Cache-Control: public, max-age=0, must-revalidate/.test(headers))

const notFound = readFileSync(resolve(process.cwd(), 'public/404.html'), 'utf8')
check('top-level 404 prevents Pages SPA fallback for missing chunks',
  /<title>Not found — Feltmath<\/title>/.test(notFound))

console.log(failures === 0 ? '\nALL DEPLOYMENT CHECKS PASSED' : `\n${failures} DEPLOYMENT CHECKS FAILED`)
if (failures > 0) process.exitCode = 1
