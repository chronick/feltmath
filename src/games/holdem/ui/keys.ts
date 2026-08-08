import type { HotkeyLayout, KeyBind } from '../../../shared/ui/hotkeyLayout'

export interface HoldemKeys {
  fold: KeyBind
  /** one key covers check and call — they're never both legal */
  checkCall: KeyBind
  /** arms the sizing tray (Enter is always the commit) */
  raise: KeyBind
  /** jumps the sizing tray to the shove */
  allin: KeyBind
}

/** Mnemonic letters, matching the action names on the buttons. */
const CLASSIC: HoldemKeys = {
  fold: { code: 'f', label: 'F' },
  checkCall: { code: 'c', label: 'C' },
  raise: { code: 'r', label: 'R' },
  allin: { code: 'a', label: 'A' },
}

/**
 * Home-row cluster: Space takes the frequent, never-costly action
 * (check/call), fold stays on F, sizing on D, shove on A — all under a
 * resting left hand. Space also starts the next hand between hands.
 */
const ERGONOMIC: HoldemKeys = {
  fold: { code: 'f', label: 'F' },
  checkCall: { code: 'space', label: 'Space' },
  raise: { code: 'd', label: 'D' },
  allin: { code: 'a', label: 'A' },
}

export function holdemKeys(layout: HotkeyLayout): HoldemKeys {
  return layout === 'ergonomic' ? ERGONOMIC : CLASSIC
}
