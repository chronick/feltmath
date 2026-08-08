// Odds entry point for the hold'em module.
//
// The opponent model (random hands), the exact-vs-Monte-Carlo split, and the
// two-way pot odds simplification are all documented at the top of equity.ts
// and on the functions themselves. Import from here, not from equity.ts.

export { describeMade, equity, handStrengthQuick, potOdds } from './equity'

// ---------------------------------------------------------------------------
// Formatting helpers for the UI (pure, no locale surprises)
//
// Deliberately local rather than shared with the blackjack odds module: the two
// games are independent and neither should be able to break the other's UI by
// retuning its own number formatting.
// ---------------------------------------------------------------------------

/** Equity as a whole percent: 0.4237 → "42%". Out-of-range input clamps. */
export function formatEquityPct(p: number): string {
  if (!Number.isFinite(p)) return '0%'
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p
  return `${Math.round(clamped * 100)}%`
}

/** Chips: 1240 → "$1,240". Negative amounts render with a true minus: "−$40". */
export function formatChips(n: number): string {
  if (!Number.isFinite(n)) return '$0'
  const rounded = Math.round(n)
  const sign = rounded < 0 ? '−' : ''
  return `${sign}$${Math.abs(rounded).toLocaleString('en-US')}`
}
