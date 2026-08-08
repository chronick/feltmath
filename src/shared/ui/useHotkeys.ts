import { useEffect, useRef } from 'react'

// Keys are lowercase KeyboardEvent.key values, with ' ' spelled 'space'.
export type HotkeyMap = Record<string, () => void>

/**
 * App-wide guard: drop focus from any button after a real pointer click
 * (keyboard-driven clicks have detail === 0 and keep focus for
 * accessibility). Without this, a mouse-clicked button — an action, a chip,
 * even the game switcher — stays focused, and the browser's native
 * Enter/Space activation replays *that* button instead of the mapped hotkey.
 *
 * Runs on document, which React's root-attached handlers bubble to first, so
 * deliberate post-click focus moves (e.g. the sizing tray refocusing its
 * slider) land before the blur and survive it.
 */
export function useBlurButtonsAfterPointerClick(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0 || !(e.target instanceof Element)) return
      const button = e.target.closest('button')
      if (button && document.activeElement === button) button.blur()
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}

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
