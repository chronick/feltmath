import type { HoldemConfig, PokerAction, Position, Street } from '../types'

const MINUS = '−' // true minus sign — lines up with tabular numerals

/** Chips, never rendered negative (stacks can't go below zero). */
export function formatMoney(amount: number): string {
  return `$${Math.max(0, Math.round(amount)).toLocaleString('en-US')}`
}

/** Signed chips for deltas: "+$120" / "−$45" / "$0". */
export function formatSignedMoney(amount: number): string {
  const rounded = Math.round(amount)
  if (rounded === 0) return '$0'
  const sign = rounded > 0 ? '+' : MINUS
  return `${sign}$${Math.abs(rounded).toLocaleString('en-US')}`
}

/** Probabilities as whole percents by default — "34%". */
export function formatPct(p: number, digits = 0): string {
  if (!Number.isFinite(p)) return '—'
  return `${(p * 100).toFixed(digits)}%`
}

/** Bet sizes in big blinds — "3 bb", "2.5 bb". */
export function formatBB(amount: number, bigBlind: number): string {
  if (bigBlind <= 0) return ''
  const bb = amount / bigBlind
  return `${bb >= 10 ? bb.toFixed(0) : bb.toFixed(1)} bb`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/** "$5/$10" */
export function blindsLabel(config: HoldemConfig): string {
  return `${formatMoney(config.smallBlind)}/${formatMoney(config.bigBlind)}`
}

/** "4-handed · $5/$10 · $1,000 buy-in" — the bar + settings subtitle. */
export function configSummary(config: HoldemConfig): string {
  const parts = [
    `${config.aiPlayers + 1}-handed`,
    blindsLabel(config),
    `${formatMoney(config.buyIn)} buy-in`,
  ]
  if (config.topUp) parts.push('top-up')
  return parts.join(' · ')
}

export function streetLabel(street: Street): string {
  switch (street) {
    case 'preflop':
      return 'Preflop'
    case 'flop':
      return 'Flop'
    case 'turn':
      return 'Turn'
    case 'river':
      return 'River'
  }
}

/** "Raise to $60" / "Check" — used by the hint badge and the log-free copy. */
export function pokerActionLabel(action: PokerAction): string {
  switch (action.type) {
    case 'fold':
      return 'Fold'
    case 'check':
      return 'Check'
    case 'call':
      return action.to ? `Call ${formatMoney(action.to)}` : 'Call'
    case 'bet':
      return action.to ? `Bet ${formatMoney(action.to)}` : 'Bet'
    case 'raise':
      return action.to ? `Raise to ${formatMoney(action.to)}` : 'Raise'
    case 'allin':
      return 'All-in'
  }
}

/** Spoken form for tooltips — "the cutoff", "under the gun". */
export function positionName(position: Position): string {
  switch (position) {
    case 'UTG':
      return 'under the gun'
    case 'HJ':
      return 'the hijack'
    case 'CO':
      return 'the cutoff'
    case 'BTN':
      return 'the button'
    case 'SB':
      return 'the small blind'
    case 'BB':
      return 'the big blind'
  }
}

/** Whole chips inside the legal [min, max] window — the slider's own ladder. */
export function clampChips(amount: number, min: number, max: number): number {
  if (!Number.isFinite(amount)) return min
  return Math.max(min, Math.min(max, Math.round(amount)))
}

/**
 * Snap a raw chip amount to the big-blind ladder, then clamp into the legal
 * [min, max] window. Used by the presets and the typed amount so they land on
 * round numbers; clamping last means an all-in that isn't a BB multiple still
 * lands exactly on the stack.
 */
export function roundToBB(amount: number, bigBlind: number, min: number, max: number): number {
  const step = Math.max(1, Math.round(bigBlind))
  const snapped = Math.round(amount / step) * step
  return clampChips(snapped, min, max)
}
