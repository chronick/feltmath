export const PRELOAD_RETRY_WINDOW_MS = 60_000
export const PRELOAD_RELOAD_KEY = 'feltmath-preload-reload-at'

interface PreloadRecoveryEnvironment {
  addEventListener(type: string, listener: (event: Event) => void): void
  getSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | null
  location: Pick<Location, 'reload'>
}

/** Reload at most once per window; a repeated failure should remain visible. */
export function shouldReloadForPreloadError(
  lastReloadAt: string | null,
  now: number,
): boolean {
  if (lastReloadAt === null) return true
  const last = Number(lastReloadAt)
  return !Number.isFinite(last) || now < last || now - last >= PRELOAD_RETRY_WINDOW_MS
}

/**
 * Recover when an older open page asks for a chunk removed by a new deploy.
 * Vite emits this event before surfacing the failed dynamic import.
 */
export function installPreloadErrorRecovery(
  environment: PreloadRecoveryEnvironment = {
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    getSessionStorage: () => {
      try {
        return window.sessionStorage
      } catch {
        return null
      }
    },
    location: window.location,
  },
  now: () => number = Date.now,
): void {
  environment.addEventListener('vite:preloadError', (event) => {
    const timestamp = now()
    let storage: Pick<Storage, 'getItem' | 'setItem'> | null
    try {
      storage = environment.getSessionStorage()
      if (storage === null) return
      const previous = storage.getItem(PRELOAD_RELOAD_KEY)
      if (!shouldReloadForPreloadError(previous, timestamp)) return
      storage.setItem(PRELOAD_RELOAD_KEY, String(timestamp))
    } catch {
      // Without durable per-tab storage, reloading could create a loop.
      return
    }

    event.preventDefault()
    environment.location.reload()
  })
}
