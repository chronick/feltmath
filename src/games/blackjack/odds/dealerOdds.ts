// Dealer outcome distribution — the foundation every player EV is measured
// against.
//
// ---------------------------------------------------------------------------
// MODEL / APPROXIMATION (applies to this whole odds module: dealerOdds.ts,
// playerEV.ts, index.ts)
// ---------------------------------------------------------------------------
// `comp` is the CURRENT unseen composition (shoe + the still-hidden hole card).
// Dealer draws are exact draws WITHOUT replacement from that composition. The
// player's prospective hit/double/split trees still use the per-value
// probabilities exported below as a documented infinite-deck approximation;
// the dealer panel itself always reflects the actual remaining shoe.
//
// Aces need no special draw handling: a hand is carried as (total, soft) where
// `total` already counts one ace as 11 whenever that fits and `soft` means that
// ace can still be demoted. `addValue` does the promotion/demotion.
//
// Not modelled anywhere in this module (documented at each site as well):
// resplits, and the natural-blackjack payout (odds are only ever shown
// mid-decision, never on a natural).

import { RANKS } from '../types'
import type { Composition, DealerDistribution, Rank, RulesConfig } from '../types'

// ---------------------------------------------------------------------------
// Small numeric / hand primitives, shared with playerEV.ts
// ---------------------------------------------------------------------------

/** Clamp into [0,1]; non-finite input (empty comp, 0/0) collapses to 0. */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

/**
 * Blackjack value of a rank; ace = 1 here (the soft logic in `addValue` adds
 * the extra 10 when it fits). Mirrors `cardValue` in engine/hand.ts — kept
 * local so the odds module stays pure math with no engine dependency.
 */
export function rankValue(rank: Rank): number {
  if (rank === 'A') return 1
  if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 10
  return Number(rank)
}

/** A hand summarised as its display total plus whether an ace still counts 11. */
export interface HandValue {
  total: number
  soft: boolean
}

/**
 * Add one card of blackjack value `value` to a (total, soft) hand.
 *
 * The "hard total" (every ace as 1) = total − (soft ? 10 : 0) strictly
 * increases with every card, which is what makes the recursions below finite
 * and safe to memoize on (total, soft).
 */
export function addValue(total: number, soft: boolean, value: number): HandValue {
  let next: number
  let nextSoft = soft
  if (value === 1 && total + 11 <= 21) {
    next = total + 11
    nextSoft = true
  } else {
    next = total + value
  }
  if (next > 21 && nextSoft) {
    next -= 10
    nextSoft = false
  }
  return { total: next, soft: nextSoft }
}

/** The (total, soft) of a one-card hand, e.g. after a split. */
export function startingHand(rank: Rank): HandValue {
  const value = rankValue(rank)
  return value === 1 ? { total: 11, soft: true } : { total: value, soft: false }
}

// ---------------------------------------------------------------------------
// Draw distribution
// ---------------------------------------------------------------------------

/** P(draw a card of each blackjack value); index 1..10, index 0 unused. */
export type ValueProbs = readonly number[]

const ONE_RANK = 1 / 13

/** Fallback when the unseen composition is empty or degenerate. */
const FULL_DECK_PROBS: ValueProbs = [
  0,
  ONE_RANK, ONE_RANK, ONE_RANK, ONE_RANK, ONE_RANK,
  ONE_RANK, ONE_RANK, ONE_RANK, ONE_RANK,
  4 * ONE_RANK,
]

const FULL_DECK_COUNTS: readonly number[] = [
  0,
  4, 4, 4, 4, 4,
  4, 4, 4, 4,
  16,
]

/**
 * Collapse an unseen composition into per-value draw probabilities.
 * A zero-card (or garbage) composition falls back to full-deck frequencies so
 * nothing downstream ever sees a NaN.
 */
export function valueProbabilities(comp: Composition): ValueProbs {
  const counts = new Array<number>(11).fill(0)
  let total = 0
  for (const rank of RANKS) {
    const n = comp[rank]
    if (!Number.isFinite(n) || n <= 0) continue
    counts[rankValue(rank)] += n
    total += n
  }
  if (total <= 0) return FULL_DECK_PROBS
  const probs = new Array<number>(11).fill(0)
  for (let v = 1; v <= 10; v++) probs[v] = clamp01(counts[v] / total)
  return probs
}

/** Current counts collapsed by blackjack value; ten/J/Q/K share one bucket. */
function valueCounts(comp: Composition): number[] {
  const counts = new Array<number>(11).fill(0)
  let total = 0
  for (const rank of RANKS) {
    const raw = comp[rank]
    if (!Number.isFinite(raw) || raw <= 0) continue
    const n = Math.floor(raw)
    counts[rankValue(rank)] += n
    total += n
  }
  return total > 0 ? counts : [...FULL_DECK_COUNTS]
}

// ---------------------------------------------------------------------------
// Dealer recursion
// ---------------------------------------------------------------------------

// Final buckets, in order: 17, 18, 19, 20, 21, bust.
const BUCKETS = 6
const BUST = 5

function zeroBuckets(): number[] {
  return [0, 0, 0, 0, 0, 0]
}

/**
 * Exact distribution over the dealer's final result from a (total, soft) hand,
 * drawing per house rules. Memoized on (total, soft) for this call only — the
 * memo is invalid the moment the composition changes.
 */
function playDealer(
  total: number,
  soft: boolean,
  counts: number[],
  remaining: number,
  hitsSoft17: boolean,
  memo: Map<string, number[]>,
): number[] {
  if (total > 21) {
    const busted = zeroBuckets()
    busted[BUST] = 1
    return busted
  }

  const mustHit = total < 17 || (total === 17 && soft && hitsSoft17)
  if (!mustHit) {
    const stood = zeroBuckets()
    stood[total - 17] = 1
    return stood
  }

  // The same total with a different remaining shoe is a different state.
  const key = `${total}|${soft ? 1 : 0}|${counts.slice(1).join(',')}`
  const cached = memo.get(key)
  if (cached) return cached

  const out = zeroBuckets()
  if (remaining <= 0) {
    // Impossible in a valid live round, but callers can supply a synthetic or
    // exhausted composition. Fall back to a fresh one-deck shape so the public
    // distribution remains finite and normalized instead of returning zeros.
    const fallback = [...FULL_DECK_COUNTS]
    return playDealer(
      total,
      soft,
      fallback,
      fallback.reduce((sum, n) => sum + n, 0),
      hitsSoft17,
      new Map<string, number[]>(),
    )
  }
  for (let v = 1; v <= 10; v++) {
    const n = counts[v]
    if (n <= 0) continue
    const p = n / remaining
    counts[v]--
    const next = addValue(total, soft, v)
    const sub = playDealer(next.total, next.soft, counts, remaining - 1, hitsSoft17, memo)
    counts[v]++
    for (let i = 0; i < BUCKETS; i++) out[i] += p * sub[i]
  }
  memo.set(key, out)
  return out
}

/**
 * Distribution over the dealer's final hand given the upcard and the unseen
 * composition.
 *
 * `pBlackjack` counts ONLY a natural two-card 21 (ace up + ten hole, or ten up
 * + ace hole); every other 21 lands in `p21`. When `conditionNoBlackjack` is
 * true (post-peek — only meaningful for an ace or ten upcard) the hole-card
 * draw excludes the natural-completing value and is renormalised, so
 * `pBlackjack` comes back 0.
 *
 * The seven fields sum to 1 by construction (each branch's sub-distribution
 * sums to 1 and the hole-card weights sum to 1).
 */
export function dealerDistribution(
  dealerUp: Rank,
  comp: Composition,
  rules: RulesConfig,
  conditionNoBlackjack: boolean,
): DealerDistribution {
  const upValue = rankValue(dealerUp)

  // Hole-card value that would complete a natural (0 = impossible upcard).
  const naturalValue = upValue === 1 ? 10 : upValue === 10 ? 1 : 0
  const conditioned = conditionNoBlackjack && naturalValue !== 0
  let counts = valueCounts(comp)
  let unseen = counts.reduce((sum, n) => sum + n, 0)
  let holeChoices = conditioned ? unseen - counts[naturalValue] : unseen

  // A degenerate supplied composition (all unseen cards would make the ruled-
  // out natural) cannot describe a live post-peek shoe. Preserve a finite,
  // normalized answer by falling back to one deck's shape.
  if (holeChoices <= 0) {
    counts = [...FULL_DECK_COUNTS]
    unseen = 13
    holeChoices = conditioned ? unseen - counts[naturalValue] : unseen
  }

  const start = startingHand(dealerUp)
  const memo = new Map<string, number[]>()
  const acc = zeroBuckets()
  let pBlackjack = 0

  for (let v = 1; v <= 10; v++) {
    if (conditioned && v === naturalValue) continue
    const n = counts[v]
    if (n <= 0) continue
    const p = n / holeChoices
    if (v === naturalValue) {
      // Two-card 21 with an ace/ten upcard is by definition a natural.
      // (Unreachable when conditioned: that weight is already 0.)
      pBlackjack += p
      continue
    }
    counts[v]--
    const next = addValue(start.total, start.soft, v)
    const sub = playDealer(
      next.total,
      next.soft,
      counts,
      unseen - 1,
      rules.dealerHitsSoft17,
      memo,
    )
    counts[v]++
    for (let i = 0; i < BUCKETS; i++) acc[i] += p * sub[i]
  }

  return {
    p17: clamp01(acc[0]),
    p18: clamp01(acc[1]),
    p19: clamp01(acc[2]),
    p20: clamp01(acc[3]),
    p21: clamp01(acc[4]),
    pBlackjack: clamp01(pBlackjack),
    pBust: clamp01(acc[BUST]),
  }
}
