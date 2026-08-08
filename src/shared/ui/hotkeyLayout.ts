import { useSyncExternalStore } from 'react'

/**
 * App-wide hotkey layout preference, shared by every game.
 *
 * 'classic'   — mnemonic letters matching the action names (H hit, R raise…).
 * 'ergonomic' — everything under a resting left hand: A/S/D/F plus Space for
 *   the most frequent action, so play never needs a reach across the board.
 *
 * Module-level store + useSyncExternalStore so a change made in one game's
 * settings modal re-renders every mounted surface immediately.
 */
export type HotkeyLayout = 'classic' | 'ergonomic'

const STORAGE_KEY = 'feltmath-hotkey-layout'

function load(): HotkeyLayout {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ergonomic' ? 'ergonomic' : 'classic'
  } catch {
    return 'classic'
  }
}

let current: HotkeyLayout = load()
const listeners = new Set<() => void>()

export function setHotkeyLayout(next: HotkeyLayout): void {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // private mode etc. — the in-memory value still wins for this session
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useHotkeyLayout(): HotkeyLayout {
  return useSyncExternalStore(subscribe, () => current)
}

/** A bindable key: the useHotkeys map code plus the label shown on buttons. */
export interface KeyBind {
  code: string
  label: string
}
