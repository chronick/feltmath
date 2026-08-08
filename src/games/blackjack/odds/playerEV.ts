// Player expected values, in units of the INITIAL bet.
//
// Draw model and its approximation are documented at the top of dealerOdds.ts:
// every draw here is with replacement from the current unseen composition.
//
// Post-peek assumption: `computeOdds` builds the dealer distribution with the
// natural already ruled out for ace/ten upcards, so these EVs are conditional
// on "the dealer does not have blackjack" exactly when the engine's peek has
// established that. A non-zero `dealer.pBlackjack` is still handled correctly
// (it counts as a loss for the player) so the functions stay honest if they are
// ever called pre-peek.
//
// The player's own natural pays nothing extra here — odds are only shown
// mid-decision, never on a natural.

import type { Card, Composition, DealerDistribution, Rank, RulesConfig } from '../types'
import { addValue, clamp01, rankValue, startingHand, valueProbabilities } from './dealerOdds'
import type { HandValue, ValueProbs } from './dealerOdds'

/** Per-call state: draw probabilities, the dealer distribution, and memos. */
export interface EVContext {
  probs: ValueProbs
  dealer: DealerDistribution
  rules: RulesConfig
  /** memo for `hitEV`, keyed by (total, soft) — valid for this call only */
  hitMemo: Map<number, number>
}

export function createEVContext(
  comp: Composition,
  dealer: DealerDistribution,
  rules: RulesConfig,
): EVContext {
  return {
    probs: valueProbabilities(comp),
    dealer,
    rules,
    hitMemo: new Map<number, number>(),
  }
}

/**
 * (total, soft) of a dealt hand. Mirrors `handTotal` in engine/hand.ts; kept
 * local so the odds module has no engine dependency.
 */
export function handValueOf(cards: Card[]): HandValue {
  let hand: HandValue = { total: 0, soft: false }
  for (const card of cards) {
    hand = addValue(hand.total, hand.soft, rankValue(card.rank))
  }
  return hand
}

/** May a two-card `total` double under this rule set? (`doubleOn` is hard-only.) */
export function canDoubleTotal(total: number, soft: boolean, rules: RulesConfig): boolean {
  if (rules.doubleOn === 'any2') return true
  if (soft) return false
  if (rules.doubleOn === '9to11') return total >= 9 && total <= 11
  return total >= 10 && total <= 11
}

export interface StandOutcomes {
  win: number
  push: number
  lose: number
}

/** P(win / push / lose) if the player stands on `total` right now. */
export function standOutcomes(total: number, dealer: DealerDistribution): StandOutcomes {
  if (total > 21) return { win: 0, push: 0, lose: 1 }

  // A dealer natural beats every non-natural player hand.
  let win = dealer.pBust
  let push = 0
  let lose = dealer.pBlackjack

  const finals: readonly number[] = [
    dealer.p17, dealer.p18, dealer.p19, dealer.p20, dealer.p21,
  ]
  for (let i = 0; i < finals.length; i++) {
    const p = finals[i]
    if (p <= 0) continue
    const dealerTotal = 17 + i
    if (total > dealerTotal) win += p
    else if (total === dealerTotal) push += p
    else lose += p
  }

  return { win: clamp01(win), push: clamp01(push), lose: clamp01(lose) }
}

/** EV of standing on `total`: P(win) − P(lose). Bust → −1. */
export function standEV(total: number, dealer: DealerDistribution): number {
  const { win, lose } = standOutcomes(total, dealer)
  return win - lose
}

/**
 * EV of taking one more card and then playing optimally (hit/stand only — you
 * cannot double or surrender after hitting). Bust → −1.
 *
 * Memoized on (total, soft). Terminates because the hard total (aces as 1)
 * strictly increases with every card, so the state graph is a DAG.
 */
export function hitEV(total: number, soft: boolean, ctx: EVContext): number {
  const key = total * 2 + (soft ? 1 : 0)
  const cached = ctx.hitMemo.get(key)
  if (cached !== undefined) return cached

  let ev = 0
  for (let v = 1; v <= 10; v++) {
    const p = ctx.probs[v]
    if (p <= 0) continue
    const next = addValue(total, soft, v)
    if (next.total > 21) {
      ev += p * -1
    } else {
      const stand = standEV(next.total, ctx.dealer)
      const hit = hitEV(next.total, next.soft, ctx)
      ev += p * Math.max(stand, hit)
    }
  }

  ctx.hitMemo.set(key, ev)
  return ev
}

/** EV of doubling: exactly one card, then stand, at 2× stakes. */
export function doubleEV(total: number, soft: boolean, ctx: EVContext): number {
  let ev = 0
  for (let v = 1; v <= 10; v++) {
    const p = ctx.probs[v]
    if (p <= 0) continue
    const next = addValue(total, soft, v)
    ev += p * (next.total > 21 ? -1 : standEV(next.total, ctx.dealer))
  }
  return 2 * ev
}

/**
 * EV of splitting — an APPROXIMATION.
 *
 * Modelled as 2 × the EV of a single post-split hand that starts with one card
 * of the pair rank, draws exactly one card, and is then played optimally
 * (hit/stand, plus double when `doubleAfterSplit` allows it — itself an
 * approximation: it takes the double whenever it beats hit/stand rather than
 * following the book's DAS table).
 *
 * Deliberately NOT modelled:
 *   - resplits (`maxSplitHands`, `resplitAces`) — the true value of a pair of
 *     8s is slightly higher than this because you may split again;
 *   - removal of the two pair cards from the draw distribution (see the
 *     with-replacement note in dealerOdds.ts);
 *   - the 1:1 payout on a post-split 21 is handled correctly (it is scored as
 *     a plain 21, never as a natural).
 *
 * Split aces with `hitSplitAces` false get exactly one card and stand.
 */
export function splitEV(pairRank: Rank, ctx: EVContext): number {
  const rules = ctx.rules
  const isAces = rankValue(pairRank) === 1
  const oneCardOnly = isAces && !rules.hitSplitAces
  const start = startingHand(pairRank)

  let ev = 0
  for (let v = 1; v <= 10; v++) {
    const p = ctx.probs[v]
    if (p <= 0) continue
    const next = addValue(start.total, start.soft, v)

    let best: number
    if (next.total > 21) {
      // Unreachable from a one-card hand; guarded for safety.
      best = -1
    } else if (oneCardOnly) {
      best = standEV(next.total, ctx.dealer)
    } else {
      best = Math.max(
        standEV(next.total, ctx.dealer),
        hitEV(next.total, next.soft, ctx),
      )
      if (rules.doubleAfterSplit && canDoubleTotal(next.total, next.soft, rules)) {
        best = Math.max(best, doubleEV(next.total, next.soft, ctx))
      }
    }
    ev += p * best
  }

  return 2 * ev
}

/** Late surrender: forfeit half the bet. */
export const SURRENDER_EV = -0.5
