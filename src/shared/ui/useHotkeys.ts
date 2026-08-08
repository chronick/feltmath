import { useEffect, useRef } from 'react'

// Keys are lowercase KeyboardEvent.key values, with ' ' spelled 'space'.
export type HotkeyMap = Record<string, () => void>

/**
 * Global keyboard shortcuts for game surfaces.
 *
 * Guards, in order: modifier chords pass through untouched (browser's);
 * form fields keep their keys; a focused <button> keeps native Enter/Space
 * activation (prevents double-firing when a hotkey aliases the focused
 * control, e.g. the auto-focused "Next hand" button).
 *
 * The map is read through a ref, so callers may rebuild it every render
 * without re-binding the listener.
 */
export function useHotkeys(map: HotkeyMap): void {
  const ref = useRef(map)
  ref.current = map

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
        if (
          (e.key === 'Enter' || e.key === ' ') &&
          (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)
        ) {
          return
        }
      }

      const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
      const handler = ref.current[key]
      if (!handler) return
      e.preventDefault()
      handler()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
