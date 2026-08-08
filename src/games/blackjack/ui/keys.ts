import type { HotkeyLayout, KeyBind } from '../../../shared/ui/hotkeyLayout'
import type { Action } from '../types'

export type BlackjackKeys = Record<Action, KeyBind>

/** Mnemonic letters, matching the action names on the buttons. */
const CLASSIC: BlackjackKeys = {
  hit: { code: 'h', label: 'H' },
  stand: { code: 's', label: 'S' },
  double: { code: 'd', label: 'D' },
  split: { code: 'p', label: 'P' },
  surrender: { code: 'r', label: 'R' },
}

/**
 * Home-row cluster: thumb on Space for the most frequent action, the rest on
 * A/S/D/F where the left hand already rests. F reads as poker's "fold".
 * Space stays the advance key in the betting and settlement phases, so the
 * whole loop — deal, hit, next hand — lives on one thumb.
 */
const ERGONOMIC: BlackjackKeys = {
  hit: { code: 'space', label: 'Space' },
  stand: { code: 's', label: 'S' },
  double: { code: 'd', label: 'D' },
  split: { code: 'a', label: 'A' },
  surrender: { code: 'f', label: 'F' },
}

export function blackjackKeys(layout: HotkeyLayout): BlackjackKeys {
  return layout === 'ergonomic' ? ERGONOMIC : CLASSIC
}
