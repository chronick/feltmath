// Odds entry point: one call in, a full OddsReport out.
//
// The draw model and its approximation are documented at the top of
// dealerOdds.ts (with replacement from the current unseen composition).
// Split/resplit caveats are documented on `splitEV` in playerEV.ts.

import type {
  ActionContext,
  ActionEV,
  Card,
  Composition,
  OddsReport,
  Rank,
  RulesConfig,
} from '../types'
import { clamp01, dealerDistribution, rankValue } from './dealerOdds'
import {
  createEVContext,
  doubleEV,
  handValueOf,
  hitEV,
  splitEV,
  standOutcomes,
  SURRENDER_EV,
} from './playerEV'

export { dealerDistribution } from './dealerOdds'

/**
 * Full odds report for the hand that is currently deciding.
 *
 * The dealer distribution is built once, conditioned on "no blackjack" for an
 * ace or ten upcard — the engine only shows odds after the peek, so a natural
 * has already been ruled out for those upcards.
 *
 * `evs` contains ONLY the actions `ctx` currently allows, sorted best-first;
 * `best` is the argmax. A hand that is bust or already at 21 (or that has no
 * legal action at all) gets a stand-only report.
 */
export function computeOdds(
  playerCards: Card[],
  dealerUp: Rank,
  comp: Composition,
  rules: RulesConfig,
  ctx: ActionContext,
): OddsReport {
  const upValue = rankValue(dealerUp)
  const conditionNoBlackjack = upValue === 1 || upValue === 10
  const dealer = dealerDistribution(dealerUp, comp, rules, conditionNoBlackjack)

  const hand = handValueOf(playerCards)
  const outcomes = standOutcomes(hand.total, dealer)
  const standValue = outcomes.win - outcomes.lose

  const hasAnyAction =
    ctx.canHit || ctx.canStand || ctx.canDouble || ctx.canSplit || ctx.canSurrender
  const standOnly = hand.total >= 21 || !hasAnyAction

  const evs: ActionEV[] = []
  if (standOnly) {
    // Bust (EV −1), a made 21, or nothing legal to do: only standing is real.
    evs.push({ action: 'stand', ev: standValue, available: true })
  } else {
    const evCtx = createEVContext(comp, dealer, rules)
    if (ctx.canStand) {
      evs.push({ action: 'stand', ev: standValue, available: true })
    }
    if (ctx.canHit) {
      evs.push({ action: 'hit', ev: hitEV(hand.total, hand.soft, evCtx), available: true })
    }
    if (ctx.canDouble) {
      evs.push({ action: 'double', ev: doubleEV(hand.total, hand.soft, evCtx), available: true })
    }
    if (ctx.canSplit && playerCards.length > 0) {
      evs.push({ action: 'split', ev: splitEV(playerCards[0].rank, evCtx), available: true })
    }
    if (ctx.canSurrender) {
      evs.push({ action: 'surrender', ev: SURRENDER_EV, available: true })
    }
    // Only reachable if `ctx` claimed a split on an empty hand; never leave the
    // report without a best action.
    if (evs.length === 0) {
      evs.push({ action: 'stand', ev: standValue, available: true })
    }
  }

  // Stable sort: ties keep stand > hit > double > split > surrender order.
  evs.sort((a, b) => b.ev - a.ev)

  return {
    dealer,
    standWin: outcomes.win,
    standPush: outcomes.push,
    standLose: outcomes.lose,
    evs,
    best: evs[0].action,
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers for the UI (pure, no locale dependence)
// ---------------------------------------------------------------------------

/** Probability as a whole percent: 0.4237 → "42%". */
export function formatPct(p: number): string {
  return `${Math.round(clamp01(p) * 100)}%`
}

/** EV in units of the initial bet: 0.18 → "+0.18", −0.54 → "−0.54", 0 → "0.00". */
export function formatEV(ev: number): string {
  if (!Number.isFinite(ev)) return '0.00'
  const rounded = Math.round(ev * 100) / 100
  if (rounded === 0) return '0.00'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(2)}`
}
