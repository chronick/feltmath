// The other players at the table.
//
// Every AI decision is a pure function of the game state: personality comes
// from hashing the seat id, and the one roll of the dice each decision needs
// comes from hashing (rngSeed, seat, hand number, street, events so far)
// through the shared PRNG. Same state in, same action out — which is what lets
// the engine be a React reducer and replay identically under StrictMode.
//
// They are not solvers and they aren't meant to be. Preflop is a Chen-style
// hand score against a positional bar; postflop is the real evaluator plus a
// draw check, turned into a rough equity number and compared against the price
// the pot is laying. Personality moves the bars and the bet frequencies, so the
// table has a nit, a maniac, and some people in between.
//
// The one hard rule: aiPokerDecide ALWAYS returns something legal for the
// acting seat. A stalled table is worse than a bad fold.

import type {
  Card,
  HandRank,
  HoldemSeatState,
  HoldemState,
  PokerAction,
  PokerActionContext,
  Position,
  Street,
} from '../types'
import { mulberry32 } from '../../../shared/rng'
import { evaluate } from '../engine/evaluate'
import { positionOf, postflopOrder, rankValue } from '../strategy/ranges'
import { readDraws } from '../strategy/advice'
import type { DrawRead } from '../strategy/advice'

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Poker room regulars — a separate cast from the blackjack companions. */
export const HOLDEM_AI_NAMES: readonly string[] = [
  'Rocket Ron',
  'River Rita',
  'Check-Raise Kay',
  'Gutshot Gus',
  'All-In Ali',
  'Cowboy Cody',
  'Nit Nadia',
  'Slowroll Sal',
  'Bluffy Bo',
  "Limpin' Lou",
]

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function aiPokerDecide(state: HoldemState, seatIndex: number): PokerAction {
  const seat = state.seats[seatIndex]
  if (!seat) return { type: 'fold' }

  const ctx = actionContextFor(state, seatIndex)
  if (!seat.hole || seat.hole.length < 2) return legal(fallback(ctx), ctx)

  const who = personalityOf(seat)
  const roll = decisionRng(state, seatIndex)

  const wanted = state.street === 'preflop'
    ? preflopDecision(state, seat, seatIndex, ctx, who, roll)
    : postflopDecision(state, seat, seatIndex, ctx, who, roll)

  return legal(wanted, ctx)
}

// ---------------------------------------------------------------------------
// Personality
// ---------------------------------------------------------------------------

interface Personality {
  /** 0 = plays anything, 1 = waits for aces. Moves the preflop bars. */
  tightness: number
  /** 0 = calling station, 1 = maniac. Moves bet/bluff frequency and sizing. */
  aggression: number
}

const TIGHT_SALT = 0x7a17
const AGGRO_SALT = 0x4a99

function personalityOf(seat: HoldemSeatState): Personality {
  return {
    tightness: unitRandom(seat.id, TIGHT_SALT),
    aggression: unitRandom(seat.id, AGGRO_SALT),
  }
}

// ---------------------------------------------------------------------------
// Preflop
// ---------------------------------------------------------------------------

/**
 * Chen score a seat needs to open first-in, by position. Calibrated against the
 * charts in strategy/ranges.ts — roughly 15% under the gun up to 43% on the
 * button. Personality shifts each bar by up to ±1.5 points.
 */
const OPEN_BAR: Record<Position, number> = {
  UTG: 9, HJ: 8.2, CO: 6.5, BTN: 4.8, SB: 5.5, BB: 5,
}

function preflopDecision(
  state: HoldemState,
  seat: HoldemSeatState,
  seatIndex: number,
  ctx: PokerActionContext,
  who: Personality,
  roll: () => number,
): PokerAction {
  const bb = state.config.bigBlind
  const position = positionOf(state, seat.id)
  const score = chenScore(seat.hole)
  const raises = raisesThisStreet(state)
  // Personality sets the bar; a little per-decision mood keeps the same seat
  // from being a lookup table you can memorize.
  const mood = (roll() - 0.5) * 1.2
  const bar = OPEN_BAR[position] + (who.tightness - 0.5) * 3 + mood

  // --- unopened: open or get out --------------------------------------------
  if (raises === 0) {
    const limped = limpers(state, seatIndex, bb)
    // Limpers sweeten the pot, so it's worth raising a little wider to take it.
    if (score >= bar - limped * 0.5) {
      const size = bb * (2.5 + who.aggression + limped)
      return aggressTo(size, ctx, bb)
    }
    if (ctx.canCheck) return { type: 'check' }
    // Raise-or-fold is the book answer, but the loose end of the table talks
    // itself into a cheap limp often enough that the pots should exist.
    if (ctx.canCall && score >= bar - 2 && who.tightness < 0.4) return { type: 'call' }
    return { type: 'fold' }
  }

  // --- someone re-raised: only real hands play ------------------------------
  if (raises >= 2) {
    // 4-bet with the very top (QQ+ / AK for the aggressive seats), continue
    // with the hands that flop well enough to justify a bloated pot.
    if (score >= 14 - who.aggression * 2) return aggressTo(state.currentBet * 2.3, ctx, bb)
    if (score >= 12 - who.aggression * 1.5) return callOrCheck(ctx)
    return giveUp(ctx)
  }

  // --- facing a single raise -------------------------------------------------
  const threeBetBar = 11.5 - who.aggression * 2
  if (score >= threeBetBar) {
    const inPosition = actsAfter(state, seatIndex, currentBettor(state, seatIndex))
    return aggressTo(state.currentBet * (inPosition ? 3 : 4), ctx, bb)
  }

  // Cold-calling a raise wants a better hand than opening does, and the button
  // shouldn't flat 35% of hands just because it opens that many. The big blind
  // is the exception: it already has money in and closes the action.
  let callBar = Math.max(bar + 1, 7)
  if (position === 'BB') callBar -= 2.5
  const price = ctx.callAmount / Math.max(1, ctx.potSize + ctx.callAmount)
  if (price <= 0.2) callBar -= 1

  if (score >= callBar) return callOrCheck(ctx)
  return giveUp(ctx)
}

/**
 * Bill Chen's starting-hand formula: high card value, pairs doubled, a bonus
 * for suited, a penalty for gaps, a nudge back for low connectors. Cheap, and
 * it ranks hands about as well as anything this side of a solver.
 */
function chenScore(hole: Card[]): number {
  const a = rankValue(hole[0].rank)
  const b = rankValue(hole[1].rank)
  const high = Math.max(a, b)
  const low = Math.min(a, b)

  let score = chenHighCard(high)

  if (a === b) {
    score = Math.max(score * 2, 5) // any pair is worth at least 5
  } else {
    if (hole[0].suit === hole[1].suit) score += 2
    const gap = high - low - 1
    if (gap === 1) score -= 1
    else if (gap === 2) score -= 2
    else if (gap === 3) score -= 4
    else if (gap >= 4) score -= 5
    // Connectors and one-gappers below a queen can make straights both ways.
    if (gap <= 1 && high < 12) score += 1
  }

  return Math.ceil(score * 2) / 2 // Chen rounds up to the half point
}

function chenHighCard(value: number): number {
  if (value === 14) return 10
  if (value === 13) return 8
  if (value === 12) return 7
  if (value === 11) return 6
  return value / 2
}

// ---------------------------------------------------------------------------
// Postflop
// ---------------------------------------------------------------------------

function postflopDecision(
  state: HoldemState,
  seat: HoldemSeatState,
  seatIndex: number,
  ctx: PokerActionContext,
  who: Personality,
  roll: () => number,
): PokerAction {
  const bb = state.config.bigBlind
  const opponents = liveOpponents(state, seatIndex)
  const rank = evaluate([...seat.hole, ...state.board])
  const draws = readDraws(seat.hole, state.board)
  const eq = estimateEquity(rank, seat.hole, state.board, draws, state.street, opponents)

  const facing = ctx.callAmount > 0
  const required = facing ? ctx.callAmount / (ctx.potSize + ctx.callAmount) : 0
  const dice = roll()

  if (facing) {
    const cushion = eq - required

    // Way ahead: raise, more often the more aggressive the seat.
    if (cushion >= 0.2 && eq >= 0.6 && dice < 0.35 + who.aggression * 0.5) {
      const size = pileOn(state, ctx, sizeFraction(dice, who.aggression))
      return aggressTo(size, ctx, bb)
    }
    // Semi-bluff raise with a big draw — rarely, and only when it can still get there.
    if (draws.strong && state.street !== 'river' && dice < who.aggression * 0.16) {
      return aggressTo(pileOn(state, ctx, 0.5), ctx, bb)
    }
    if (cushion >= 0.02) return callOrCheck(ctx)
    // Draws get a small implied-odds allowance; a passive seat calls anyway.
    if (draws.strong && state.street !== 'river' && cushion >= -0.06) return callOrCheck(ctx)
    if (draws.live && cushion >= -0.04 && who.aggression < 0.35) return callOrCheck(ctx)
    return giveUp(ctx)
  }

  // --- checked to this seat -------------------------------------------------
  const bar = valueBar(opponents)
  if (eq >= bar && dice < 0.55 + who.aggression * 0.45) {
    const size = state.currentBet + sizeFraction(dice, who.aggression) * ctx.potSize
    return aggressTo(size, ctx, bb)
  }
  if (draws.strong && state.street !== 'river' && dice < 0.2 + who.aggression * 0.5) {
    return aggressTo(state.currentBet + 0.5 * ctx.potSize, ctx, bb)
  }
  // A pure bluff at a pot nobody wants — heads-up only, and only from the
  // aggressive end of the table.
  if (opponents === 1 && eq < bar && dice < who.aggression * 0.22) {
    return aggressTo(state.currentBet + 0.5 * ctx.potSize, ctx, bb)
  }
  return callOrCheck(ctx)
}

/** Equity that justifies betting for value, loosened as the pot gets multiway. */
function valueBar(opponents: number): number {
  return 1 / (opponents + 1) + 0.16
}

/** Bet fractions the table uses: half pot, two thirds, pot. */
function sizeFraction(dice: number, aggression: number): number {
  const pick = dice * 0.6 + aggression * 0.4
  if (pick < 0.35) return 0.5
  if (pick < 0.75) return 2 / 3
  return 1
}

/** Raise-to amount for a `fraction`-of-pot raise on top of the current bet. */
function pileOn(state: HoldemState, ctx: PokerActionContext, fraction: number): number {
  return state.currentBet + fraction * (ctx.potSize + ctx.callAmount)
}

/**
 * A rough equity number from the made hand, the draws, and how many players are
 * still in. Deliberately crude — it only has to be good enough to sort "bet",
 * "call" and "fold" apart.
 */
function estimateEquity(
  rank: HandRank,
  hole: Card[],
  board: Card[],
  draws: DrawRead,
  street: Street,
  opponents: number,
): number {
  const base = madeStrength(rank, hole, board)

  // More players means more ways to be beaten, but treating them as fully
  // independent punishes made hands far too hard — soften the exponent.
  const exponent = 1 + 0.6 * (Math.max(1, opponents) - 1)
  let eq = Math.pow(base, exponent)

  const toCome = street === 'flop' ? 2 : street === 'turn' ? 1 : 0
  let bonus = 0
  if (draws.flushDraw) bonus += toCome === 2 ? 0.3 : toCome === 1 ? 0.18 : 0
  if (draws.openEnded) bonus += toCome === 2 ? 0.26 : toCome === 1 ? 0.16 : 0
  if (!draws.flushDraw && !draws.openEnded && draws.gutshot) bonus += toCome === 2 ? 0.14 : toCome * 0.08

  // A set doesn't need its backdoor draw counted twice.
  eq += rank.category <= 1 ? bonus : bonus * 0.25

  return Math.max(0.02, Math.min(0.95, eq))
}

/** Heads-up strength of the made hand alone, before counting opponents. */
function madeStrength(rank: HandRank, hole: Card[], board: Card[]): number {
  switch (rank.category) {
    case 8:
    case 7: return 0.98
    case 6: return 0.94
    case 5: return 0.88
    case 4: return 0.84
    case 3: return 0.8
    case 2: return 0.7
    case 1: return pairStrength(hole, board)
    default: return highCardStrength(hole, board)
  }
}

/**
 * Which pair it is matters far more than that it's a pair: an overpair is a
 * monster, bottom pair is a bluff catcher, and a pair sitting entirely on the
 * board is nothing at all.
 */
function pairStrength(hole: Card[], board: Card[]): number {
  const boardValues = board.map((card) => rankValue(card.rank))
  const holeValues = hole.map((card) => rankValue(card.rank))
  const topBoard = boardValues.length > 0 ? Math.max(...boardValues) : 0

  if (holeValues[0] === holeValues[1]) {
    return holeValues[0] > topBoard ? 0.78 : 0.45
  }

  const matched = holeValues.filter((value) => boardValues.includes(value))
  if (matched.length === 0) return 0.28 // the board paired, this seat missed

  const paired = Math.max(...matched)
  const kicker = holeValues[0] === paired ? holeValues[1] : holeValues[0]

  if (paired === topBoard) {
    if (kicker >= 12) return 0.68 // top pair, big kicker
    if (kicker >= 10) return 0.62
    return 0.55
  }

  const secondBoard = secondHighest(boardValues)
  return paired >= secondBoard ? 0.45 : 0.38
}

function highCardStrength(hole: Card[], board: Card[]): number {
  const topBoard = board.length > 0 ? Math.max(...board.map((card) => rankValue(card.rank))) : 0
  const overcards = hole.filter((card) => rankValue(card.rank) > topBoard).length
  if (overcards === 2) return 0.25
  if (overcards === 1) return 0.18
  return 0.12
}

function secondHighest(values: number[]): number {
  if (values.length < 2) return 0
  const sorted = [...values].sort((a, b) => b - a)
  return sorted[1]
}

// ---------------------------------------------------------------------------
// Sizing and legality
//
// The engine validates AI actions the same way it validates the human's, so
// anything questionable gets sanitized to check-or-fold. Rather than lean on
// that, this seat computes its own context and only ever asks for a raise it
// knows is legal — when in doubt it calls.
// ---------------------------------------------------------------------------

/**
 * Put chips in: a bet when nothing is out there, a raise when something is.
 *
 * A short stack needs no special case — minTo is capped at the stack, so the
 * sizing simply lands on all-in. When raising isn't legal at all (no chips
 * behind the current bet, or the seat is barred from raising this street) it
 * calls, which is what a seat that liked its hand wants anyway.
 */
function aggressTo(target: number, ctx: PokerActionContext, bb: number): PokerAction {
  if (!ctx.canRaise && !ctx.canBet) return callOrCheck(ctx)
  const to = clampSize(target, ctx, bb)
  // Sizing that eats the whole stack IS an all-in; say so, so the engine and
  // the event log agree with each other.
  if (to >= ctx.maxTo) return { type: 'allin' }
  return { type: ctx.canBet ? 'bet' : 'raise', to }
}

/** Round to a whole number of big blinds and clamp to what's legal. */
function clampSize(target: number, ctx: PokerActionContext, bb: number): number {
  const grid = bb > 0 ? bb : 1
  const rounded = Math.round(target / grid) * grid
  if (ctx.maxTo <= ctx.minTo) return ctx.maxTo
  return Math.min(ctx.maxTo, Math.max(ctx.minTo, rounded))
}

function callOrCheck(ctx: PokerActionContext): PokerAction {
  if (ctx.canCheck) return { type: 'check' }
  if (ctx.canCall) return { type: 'call' }
  return { type: 'fold' }
}

function giveUp(ctx: PokerActionContext): PokerAction {
  if (ctx.canCheck) return { type: 'check' }
  return { type: 'fold' }
}

function fallback(ctx: PokerActionContext): PokerAction {
  return ctx.canCheck ? { type: 'check' } : { type: 'fold' }
}

/** Last gate: never hand the engine something it would have to sanitize. */
function legal(action: PokerAction, ctx: PokerActionContext): PokerAction {
  switch (action.type) {
    case 'check':
      return ctx.canCheck ? action : ctx.canCall ? { type: 'call' } : { type: 'fold' }
    case 'call':
      return ctx.canCall ? action : fallback(ctx)
    case 'fold':
      // Folding when checking is free throws away a hand for nothing.
      return ctx.canCheck ? { type: 'check' } : action
    case 'bet':
    case 'raise': {
      const allowed = action.type === 'bet' ? ctx.canBet : ctx.canRaise
      const to = action.to ?? 0
      if (allowed && to >= ctx.minTo && to <= ctx.maxTo) return action
      return ctx.canCall ? { type: 'call' } : fallback(ctx)
    }
    case 'allin':
      return ctx.maxTo > 0 ? action : fallback(ctx)
  }
}

// ---------------------------------------------------------------------------
// This seat's view of the betting, computed from state
//
// engine/game.ts imports THIS file, so importing pokerActionsFor back out of it
// would be a cycle. This mirrors `actionsForSeat` in engine/game.ts exactly —
// same min-raise formula, same stack cap, same raise bar — so a size this file
// picks is a size the engine accepts. Keep the two in step: an action the
// engine rejects gets sanitized to check-or-fold, which silently turns a hand
// the seat wanted to raise into a fold.
// ---------------------------------------------------------------------------

function actionContextFor(state: HoldemState, seatIndex: number): PokerActionContext {
  const seat = state.seats[seatIndex]
  if (!seat || seat.folded || seat.out || seat.stack <= 0) {
    return {
      canFold: false, canCheck: true, canCall: false, callAmount: 0,
      canBet: false, canRaise: false, minTo: 0, maxTo: 0, potSize: potTotal(state),
    }
  }

  const owed = Math.max(0, state.currentBet - seat.streetCommit)
  const maxTo = seat.streetCommit + seat.stack

  // One formula covers bets and raises: postflop currentBet is 0 and
  // lastRaiseSize is the big blind, so the minimum opening bet falls out of the
  // min-raise rule. Capped at the stack, which is what makes a short seat's
  // "minimum raise" its all-in.
  const minTo = Math.min(state.currentBet + state.lastRaiseSize, maxTo)

  // A seat that had already acted when an incomplete all-in raise moved the bet
  // may call or fold but not raise. Miss this and a seat that wants to raise
  // gets its action thrown out and folds a hand it liked.
  const barred = state.raiseBarred.includes(seat.id)

  return {
    canFold: true,
    canCheck: owed === 0,
    canCall: owed > 0,
    callAmount: Math.min(owed, seat.stack),
    canBet: state.currentBet === 0,
    canRaise: state.currentBet > 0 && maxTo > state.currentBet && !barred,
    minTo,
    maxTo,
    potSize: potTotal(state),
  }
}

function potTotal(state: HoldemState): number {
  let total = 0
  for (const seat of state.seats) total += seat.totalCommit
  return total
}

/** 0 = unopened, 1 = one raise, 2 = re-raised. See strategy/advice.ts. */
function raisesThisStreet(state: HoldemState): number {
  const bb = state.config.bigBlind
  if (state.currentBet <= bb) return 0
  return state.currentBet - state.lastRaiseSize <= bb ? 1 : 2
}

/**
 * A seat matching the current bet — with a single raise outstanding that's the
 * raiser (or, with cold-callers, someone sitting in the same place relative to
 * us, which is all this is used for).
 */
function currentBettor(state: HoldemState, seatIndex: number): number {
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i]
    if (i === seatIndex || seat.folded || seat.out) continue
    if (state.currentBet > 0 && seat.streetCommit >= state.currentBet) return i
  }
  return -1
}

function actsAfter(state: HoldemState, seatIndex: number, otherIndex: number): boolean {
  if (otherIndex < 0) return true
  const order = postflopOrder(state)
  const mine = order.indexOf(seatIndex)
  const theirs = order.indexOf(otherIndex)
  if (mine < 0 || theirs < 0) return false
  return mine > theirs
}

function limpers(state: HoldemState, seatIndex: number, bb: number): number {
  let n = 0
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i]
    if (i === seatIndex || seat.folded || seat.out) continue
    if (seat.streetCommit < bb) continue
    if (positionOf(state, seat.id) === 'BB') continue // posted, didn't limp
    n++
  }
  return n
}

function liveOpponents(state: HoldemState, seatIndex: number): number {
  let n = 0
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i]
    if (i === seatIndex || seat.folded || seat.out) continue
    n++
  }
  return Math.max(1, n)
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

const STREET_INDEX: Record<Street, number> = { preflop: 0, flop: 1, turn: 2, river: 3 }

/**
 * One generator per decision, seeded from everything that identifies this exact
 * decision point. Re-running the same step re-rolls the same numbers.
 */
function decisionRng(state: HoldemState, seatIndex: number): () => number {
  let h = mix(state.rngSeed, seatIndex)
  h = mix(h, state.handNumber)
  h = mix(h, STREET_INDEX[state.street])
  h = mix(h, state.events.length)
  return mulberry32(h)
}

/** Stable 32-bit mix of two integers. */
function mix(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae3d) >>> 0
  return (h ^ (h >>> 13)) >>> 0
}

/** Deterministic value in [0, 1) for a pair of integers. */
function unitRandom(a: number, b: number): number {
  return mulberry32(mix(a, b))()
}
