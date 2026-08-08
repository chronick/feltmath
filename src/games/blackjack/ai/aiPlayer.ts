// Companion players at the table. They play textbook basic strategy (so the
// human can watch correct play happen next to them) and bet a deterministic,
// pseudo-random-feeling spread of chips so the table has some texture without
// any hidden state or Math.random.

import type { Action, ActionContext, Card, Rank, RulesConfig } from '../types'
import { MIN_BET } from '../types'
import { mulberry32 } from '../../../shared/rng'
import { basicStrategy } from '../strategy/basicStrategy'

/**
 * Basic strategy, constrained to what this hand may legally do.
 *
 * AI seats never take insurance — insurance is a separate side bet handled by
 * the engine, and it's a losing proposition, so companions always decline.
 */
export function aiDecide(
  cards: Card[],
  dealerUp: Rank,
  rules: RulesConfig,
  ctx: ActionContext,
): Action {
  const { action } = basicStrategy(cards, dealerUp, rules, ctx)
  if (isAllowed(action, ctx)) return action
  // basicStrategy already falls back inside ctx; this only fires if a caller
  // hands us an inconsistent context. Never return an illegal action.
  if (ctx.canStand) return 'stand'
  if (ctx.canHit) return 'hit'
  return 'stand'
}

function isAllowed(action: Action, ctx: ActionContext): boolean {
  switch (action) {
    case 'hit': return ctx.canHit
    case 'stand': return ctx.canStand
    case 'double': return ctx.canDouble
    case 'split': return ctx.canSplit
    case 'surrender': return ctx.canSurrender
  }
}

// ---------------------------------------------------------------------------
// Betting
// ---------------------------------------------------------------------------

/** The chip denominations companions bet in. */
const CHIP_SPREAD: readonly number[] = [10, 15, 25, 50]

/** Fixed salt so a seat's "personality" is stable across every round. */
const PERSONALITY_SALT = 0x5eed

/** Bias toward the smaller chips so a 50 feels like an event, not a habit. */
const BIG_BET_SKEW = 1.5

/**
 * Deterministic bet for an AI seat: same (seatId, round) always produces the
 * same chips, so the reducer stays pure and replays identically.
 *
 * Each seat gets a stable eagerness (some companions are nits, some are
 * whales) blended with a per-round mood. Never returns more than the seat can
 * cover, and never less than the table minimum — the engine rebuys a seat that
 * can't make the minimum.
 */
export function aiBet(seatId: number, round: number, bankroll: number): number {
  const eagerness = unitRandom(seatId, PERSONALITY_SALT)
  const mood = unitRandom(seatId, round)
  const pick = Math.pow(0.35 * eagerness + 0.65 * mood, BIG_BET_SKEW)

  let idx = Math.min(CHIP_SPREAD.length - 1, Math.floor(pick * CHIP_SPREAD.length))
  while (idx > 0 && CHIP_SPREAD[idx] > bankroll) idx--

  const bet = CHIP_SPREAD[idx]
  return bet <= bankroll ? bet : MIN_BET
}

/** Stable 32-bit mix of two integers. */
function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae3d) >>> 0
  return (h ^ (h >>> 13)) >>> 0
}

/** Deterministic value in [0, 1) for a pair of integers. */
function unitRandom(a: number, b: number): number {
  return mulberry32(hash2(a, b))()
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Short enough to fit under a seat, distinct enough to root for. */
export const AI_NAMES: readonly string[] = [
  'Lucky Pete',
  'Vegas Val',
  'Snake Eyes',
  'Cool Hand Cal',
  'Miss Fortune',
  'The Whale',
  'Doc Split',
  'Hard Eight',
  'Nickel Nina',
  'Tap-Out Ty',
]
