// Hold'em coaching: what to do right now, and — the whole point of the trainer
// — WHY.
//
// Preflop the answer is a chart lookup, exactly like blackjack basic strategy:
// nothing is hard-coded here, every preflop recommendation comes out of
// ./ranges.ts so the hint card and the highlighted square in the range modal
// are always reading the same cell.
//
// Postflop there is no chart. The advice compares a uniformly-random-opponent
// equity reference against the price the pot is laying, plus a read of the made
// hand and draws. It is NOT range-aware solver output: betting ranges, position
// dynamics, and the game tree beyond this street remain human judgment. Every
// postflop explanation says so once.

import type {
  Card,
  ComboKey,
  EquityReport,
  HoldemAdvice,
  HoldemState,
  PokerAction,
  PokerActionContext,
  Position,
  RangeChart,
  Street,
} from '../types'
import { SUIT_SYMBOL } from '../../../shared/cards'
import { equity, monteCarloMargin95, potOdds } from '../odds/equity'
import {
  chartAction,
  comboKeyOf,
  positionLabel,
  positionOf,
  postflopOrder,
  rangePercent,
  rankValue,
  rfiChart,
  vsLimpersChart,
  vsOpenChart,
} from './ranges'

/**
 * Samples for the advice-side equity run. At 1,500 samples the conservative
 * normal-approximation 95% margin is 0.98 / sqrt(1500) ≈ 2.5 percentage points.
 * Recommendations use the lower end of that band for value/price thresholds.
 */
const ADVICE_SAMPLES = 1500

/** Said once per postflop explanation — short, but explicit about the model. */
function equityModelNote(report: EquityReport): string {
  const sampling = report.method === 'monte-carlo'
    ? `; approx. 95% sampling margin ±${(monteCarloMargin95(report.samples) * 100).toFixed(1)} points`
    : ''
  return `uniform-random-hand reference${sampling}, not a betting-range solver`
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function holdemAdvice(state: HoldemState, ctx: PokerActionContext): HoldemAdvice {
  const heroIndex = state.actingIndex
  const hero = state.seats[heroIndex]

  // Nothing to advise on: not this seat's turn, or no legal action at all.
  if (!hero || hero.hole.length < 2 || !anyAction(ctx)) {
    return {
      action: ctx.canCheck ? { type: 'check' } : { type: 'fold' },
      situation: 'Waiting',
      explanation: `There's no decision in front of you right now.`,
    }
  }

  return state.street === 'preflop'
    ? preflopAdvice(state, ctx, heroIndex)
    : postflopAdvice(state, ctx, heroIndex)
}

// ---------------------------------------------------------------------------
// Preflop
// ---------------------------------------------------------------------------

function preflopAdvice(
  state: HoldemState,
  ctx: PokerActionContext,
  heroIndex: number,
): HoldemAdvice {
  const hero = state.seats[heroIndex]
  const bb = state.config.bigBlind
  const position = positionOf(state, hero.id)
  const combo = comboKeyOf(hero.hole)
  const hand = cardsText(hero.hole)
  const raises = raisesThisStreet(state)
  const limperCount = raises === 0 ? limpers(state, heroIndex, bb) : 0

  if (raises >= 2) return threeBetPotAdvice(state, ctx, position, combo, hand)
  if (limperCount > 0) {
    return limpedPotAdvice(state, ctx, position, combo, hand, heroIndex, bb, limperCount)
  }

  const chart: RangeChart = raises === 0 ? rfiChart(position) : vsOpenChart(position)
  const cell = chartAction(chart, combo)
  const openers = raises === 0 ? [] : raisersThisStreet(state, heroIndex)
  const opener = openers.length > 0 ? openers[0] : -1
  const openerPos = opener >= 0 ? positionOf(state, state.seats[opener].id) : null
  const inPosition = opener >= 0 ? actsAfter(state, heroIndex, opener) : true

  const situation = raises === 0
    ? `${hand} ${seatPhrase(position)} (first in)`
    : `${hand} ${seatPhrase(position)} vs ${openPhrase(openerPos)}`

  const chartRef = { position, combo }
  // The share of hands the chart RAISES — for the big blind's unraised chart
  // nothing folds (checking is free), so counting the call cells would quote a
  // meaningless "100% opening range".
  const openPct = Math.round(rangePercent(chart, ['raise', 'mixed']))

  // --- the chart says raise (or mixes toward it) --------------------------
  if (cell === 'raise' || cell === 'mixed') {
    const to = raises === 0
      ? sizeTo(openSize(state, position, heroIndex, bb), ctx, bb)
      : sizeTo(threeBetSize(state, heroIndex, inPosition), ctx, bb)
    const aggro = aggressive(to, ctx)

    if (!aggro) {
      // Someone is already all-in for more than we can raise, or the seat is
      // too short to make a legal raise — the money goes in either way.
      return {
        action: ctx.canCall ? { type: 'call' } : passive(ctx),
        situation,
        explanation:
          `${hand} is a raising hand here, but there's no legal raise left — ` +
          `${ctx.canCall ? `put the ${chips(ctx.callAmount)} in and play the hand` : 'take the free look'}.`,
        chart: chartRef,
      }
    }

    const mixNote = cell === 'mixed'
      ? ` This one is a genuine mix — ${raises === 0 ? 'raising or folding' : '3-betting or flatting'} ` +
        `are both defensible; we suggest the aggressive line because it wins the pot without a showdown often enough to matter.`
      : ''

    return {
      action: aggro,
      situation,
      explanation: raises === 0
        ? `${openReason(state, position, combo, hand, openPct, heroIndex)} ` +
          `Raise to ${chips(aggro.to ?? 0)}.${mixNote}`
        : `${threeBetReason(hand, combo, openerPos, inPosition)} ` +
          `3-bet to ${chips(aggro.to ?? 0)} — ${inPosition ? 'three times' : 'four times'} their open, ` +
          `${inPosition ? 'the standard price in position' : 'bigger because you have to play the rest of the hand out of position'}.${mixNote}`,
      chart: chartRef,
    }
  }

  // --- the chart says call (or check, when checking is free) ---------------
  if (cell === 'call') {
    if (ctx.canCheck) {
      return {
        action: { type: 'check' },
        situation,
        explanation:
          `${hand} isn't strong enough to raise for value from ${positionLabel(position)}, and you're ` +
          `already in for the big blind — check and see a flop for free. Nothing folds when checking costs nothing.`,
        chart: chartRef,
      }
    }
    return {
      action: ctx.canCall ? { type: 'call' } : passive(ctx),
      situation,
      explanation: callReason(ctx, hand, combo, position, openerPos, inPosition, bb),
      chart: chartRef,
    }
  }

  // --- the chart says fold -------------------------------------------------
  if (ctx.canCheck) {
    return {
      action: { type: 'check' },
      situation,
      explanation:
        `${hand} is below the opening range from ${positionLabel(position)}, but nobody has raised — ` +
        `checking is free, so take the flop and give up cheaply if you miss.`,
      chart: chartRef,
    }
  }

  return {
    action: { type: 'fold' },
    situation,
    explanation: foldReason(ctx, hand, combo, position, openPct, raises, openerPos),
    chart: chartRef,
  }
}

/**
 * A limped pot is its own situation: isolate a value-heavy range, overlimp
 * hands with implied odds, and take the big blind's free check with the rest.
 * Deliberately omits `chart` because the modal has only RFI/vs-open modes.
 */
function limpedPotAdvice(
  state: HoldemState,
  ctx: PokerActionContext,
  position: Position,
  combo: ComboKey,
  hand: string,
  heroIndex: number,
  bb: number,
  limperCount: number,
): HoldemAdvice {
  const cell = chartAction(vsLimpersChart(position), combo)
  const who = limperCount === 1 ? 'one limper' : `${limperCount} limpers`
  const situation = `${hand} ${seatPhrase(position)} vs ${who}`

  if (cell === 'raise' || cell === 'mixed') {
    const to = sizeTo(openSize(state, position, heroIndex, bb), ctx, bb)
    const aggro = aggressive(to, ctx)
    if (aggro) {
      return {
        action: aggro,
        situation,
        explanation:
          `${hand} is in the value-heavy isolation range against ${who}. Raise to ` +
          `${chips(aggro.to ?? 0)} — the extra big blind per limper charges the weak calls and tries ` +
          `to take the betting lead heads-up. This is a 100 bb baseline, not an unopened range.`,
      }
    }
    return {
      action: passive(ctx),
      situation,
      explanation:
        `${hand} would normally isolate ${who}, but no legal raise remains. ` +
        `${ctx.canCheck ? 'Take the free flop.' : `Call the ${chips(ctx.callAmount)} and play the pot.`}`,
    }
  }

  if (cell === 'call') {
    if (ctx.canCheck) {
      return {
        action: { type: 'check' },
        situation,
        explanation:
          `${hand} is not strong enough to isolate, and the big blind has a free option. Check; ` +
          `putting in more would turn a free flop into an unnecessary out-of-position pot.`,
      }
    }
    if (ctx.canCall) {
      return {
        action: { type: 'call' },
        situation,
        explanation:
          `${hand} has enough implied odds to overlimp for ${chips(ctx.callAmount)}, but not enough ` +
          `high-card strength to isolate. Keep the pot small and continue only when the flop connects.`,
      }
    }
  }

  return {
    action: ctx.canCheck ? { type: 'check' } : { type: 'fold' },
    situation,
    explanation: ctx.canCheck
      ? `${hand} is outside the isolation range, but checking costs nothing. Take the free flop.`
      : `${hand} is outside both the isolation and overlimp ranges against ${who}. Fold rather than ` +
        `carry a dominated hand into a multiway pot.`,
  }
}

/** Opening size in chips: 3bb under the gun, 2.5bb elsewhere, +1bb per limper. */
function openSize(state: HoldemState, position: Position, heroIndex: number, bb: number): number {
  const limped = limpers(state, heroIndex, bb)
  // Isolating limpers from the big blind wants to be bigger — everyone behind
  // has already shown weakness and you'll be out of position after the flop.
  const base = position === 'BB' ? 4 : position === 'UTG' || position === 'HJ' ? 3 : 2.5
  return bb * (base + limped)
}

/** 3-bet size: 3x their open in position, 4x out of position, +1 open per caller. */
function threeBetSize(state: HoldemState, heroIndex: number, inPosition: boolean): number {
  const open = state.currentBet
  const callers = coldCallers(state, heroIndex, open)
  return open * ((inPosition ? 3 : 4) + callers)
}

// ---------------------------------------------------------------------------
// Preflop explanations
// ---------------------------------------------------------------------------

function openReason(
  state: HoldemState,
  position: Position,
  combo: ComboKey,
  hand: string,
  openPct: number,
  heroIndex: number,
): string {
  const behind = playersBehind(state, heroIndex)
  const where = positionLabel(position)

  if (position === 'BTN') {
    return `${hand} is a standard button open. The button plays about ${openPct}% of hands first in ` +
      `because only the two blinds are left to get through, and you act last on every street after this one — ` +
      `that positional edge is worth more than the cards.`
  }

  if (position === 'SB') {
    return `${hand} is inside the small blind's ~${openPct}% opening range. Only the big blind is left, ` +
      `so it's raise or fold — limping in gives them a free flop in position, which is the one thing you can't afford.`
  }

  if (position === 'UTG' || position === 'HJ') {
    return `${hand} is strong enough to open from ${where}, which plays only about ${openPct}% of hands: ` +
      `there are ${behind} players still to act behind you, and every one of them can wake up with a real hand.`
  }

  if (isPair(combo)) {
    return `${hand} is already a made hand before the flop and it's ahead of most of what calls you — ` +
      `comfortably inside the ~${openPct}% of hands ${where} opens.`
  }

  return `${hand} is comfortably inside the ~${openPct}% opening range from ${where}: it flops well, it's ` +
    `ahead of what the blinds defend with, and there are only ${behind} players left to get through.`
}

function threeBetReason(
  hand: string,
  combo: ComboKey,
  openerPos: Position | null,
  inPosition: boolean,
): string {
  const from = openerPos ? ` from ${positionLabel(openerPos)}` : ''
  if (isPremium(combo)) {
    return `${hand} is a premium — it's ahead of the entire range that opens${from}, and flat-calling ` +
      `just invites the blinds in behind you. Build the pot now while you're the favorite.`
  }
  if (isWheelAce(combo)) {
    return `${hand} is the classic 3-bet bluff: the ace blocks half the hands that could continue against ` +
      `you, and when you do get called the wheel cards flop straights and flushes that pay off.`
  }
  return `${hand} is strong enough to re-raise rather than call ${openPhrase(openerPos)} — 3-betting takes ` +
    `the betting lead and folds out the hands that would otherwise flop well against you` +
    `${inPosition ? ', and you have position for the rest of the hand' : ''}.`
}

function callReason(
  ctx: PokerActionContext,
  hand: string,
  combo: ComboKey,
  position: Position,
  openerPos: Position | null,
  inPosition: boolean,
  bb: number,
): string {
  const price = ctx.callAmount
  const open = openPhrase(openerPos)

  if (position === 'BB') {
    const required = potOdds(price, ctx.potSize)
    return `You already have ${chips(bb)} in the pot and you close the action, so you're getting the best ` +
      `price at the table — ${chips(price)} to win ${chips(ctx.potSize)}, about ${pct(required.requiredEquity)} ` +
      `equity needed. ${hand} clears that against ${open}, so defend. Wide defense here loses less; it doesn't win.`
  }

  if (isPair(combo)) {
    return `${hand} is worth calling ${open} but not re-raising: re-raise and only better hands continue. ` +
      `Call ${chips(price)}, flop a set about one time in eight, and fold the rest cheaply` +
      `${inPosition ? ' — position makes that easy to do' : ''}.`
  }

  return `${hand} plays well against an opening range but isn't ahead of one, so calling ${chips(price)} ` +
    `keeps their weak hands in the pot instead of blowing them out` +
    `${inPosition ? '. Position after the flop is what makes this profitable' : ''}.`
}

function foldReason(
  ctx: PokerActionContext,
  hand: string,
  combo: ComboKey,
  position: Position,
  openPct: number,
  raises: number,
  openerPos: Position | null,
): string {
  const where = positionLabel(position)

  if (raises === 0) {
    return `${hand} is outside the ~${openPct}% opening range from ${where}. Hands like this make second-best ` +
      `pairs and dominated top pairs — the pots you win are small and the ones you lose are big. Fold and wait.`
  }

  const open = openPhrase(openerPos)
  const required = potOdds(ctx.callAmount, ctx.potSize)
  if (isOffsuitBroadway(combo)) {
    return `${hand} looks like a hand and plays like a trap against ${open}: when you flop top pair ` +
      `you're often out-kicked by exactly the hands that raised. ${chips(ctx.callAmount)} to call needs ` +
      `${pct(required.requiredEquity)} of a pot you'll frequently be second-best in. Fold.`
  }
  return `${hand} isn't in the defending range against ${open}. Calling ${chips(ctx.callAmount)} needs ` +
    `about ${pct(required.requiredEquity)} and you'd be playing a guessing game after the flop — the ` +
    `cheapest good decision is the fold.`
}

// ---------------------------------------------------------------------------
// 3-bet+ pots — off the charts, premium only
// ---------------------------------------------------------------------------

function threeBetPotAdvice(
  state: HoldemState,
  ctx: PokerActionContext,
  position: Position,
  combo: ComboKey,
  hand: string,
): HoldemAdvice {
  const bb = state.config.bigBlind
  const situation = `${hand} ${seatPhrase(position)} vs a re-raise`
  const bbs = Math.round(state.currentBet / bb)

  if (isPremium(combo)) {
    const to = sizeTo(state.currentBet * 2.3, ctx, bb)
    const aggro = aggressive(to, ctx)
    if (aggro) {
      return {
        action: aggro,
        situation,
        explanation:
          `${hand} is at the very top of your range and the pot is already ${bbs} big blinds — this is where ` +
          `the stack goes in. 4-bet to ${chips(aggro.to ?? 0)}: you're ahead of every hand that 3-bet you, ` +
          `and giving them a cheap card is worth more to them than the fold equity you'd gain by flatting.`,
      }
    }
    return {
      action: ctx.canCall ? { type: 'call' } : passive(ctx),
      situation,
      explanation: `${hand} calls off happily here — there's no raise left to make, so put the ` +
        `${chips(ctx.callAmount)} in with the best hand.`,
    }
  }

  if (isStrongContinue(combo)) {
    return {
      action: ctx.canCall ? { type: 'call' } : passive(ctx),
      situation,
      explanation:
        `Re-raised pots are narrow: almost nobody puts in a third raise without a real hand. ${hand} is ` +
        `strong enough to see a flop for ${chips(ctx.callAmount)} but not strong enough to raise again — ` +
        `call, and be ready to fold if the flop doesn't help you.`,
    }
  }

  return {
    action: ctx.canCheck ? { type: 'check' } : { type: 'fold' },
    situation,
    explanation:
      `There have been two raises already, and ranges that raise twice are mostly big pairs and big aces. ` +
      `${hand} is behind that — ` +
      `${ctx.canCheck
        ? `take the free card and be done with the hand if the flop misses you`
        : `folding ${chips(ctx.callAmount)} now is much cheaper than finding out on the flop`}.`,
  }
}

// ---------------------------------------------------------------------------
// Postflop
// ---------------------------------------------------------------------------

const STREET_INDEX: Record<Street, number> = { preflop: 0, flop: 1, turn: 2, river: 3 }

function postflopAdvice(
  state: HoldemState,
  ctx: PokerActionContext,
  heroIndex: number,
): HoldemAdvice {
  const hero = state.seats[heroIndex]
  const bb = state.config.bigBlind
  const opponents = liveOpponents(state, heroIndex)
  const draws = readDraws(hero.hole, state.board)

  // The seed depends only on the hand and the street, so the number in the hint
  // card stays put while the betting goes back and forth instead of shivering
  // on every re-render.
  const report = equity(
    hero.hole,
    state.board,
    opponents,
    ADVICE_SAMPLES,
    adviceSeed(state),
  )
  const eq = report.equity
  const margin = report.method === 'monte-carlo' ? monteCarloMargin95(report.samples) : 0
  const conservativeEq = Math.max(0, eq - margin)
  const modelNote = equityModelNote(report)
  const made = report.madeHand || 'your hand'
  const vs = opponents === 1
    ? 'against one uniformly random hand'
    : `against ${opponents} uniformly random hands`
  const streetWord = state.street

  const facing = ctx.callAmount > 0
  const required = facing ? potOdds(ctx.callAmount, ctx.potSize).requiredEquity : 0
  const situation = `${made} on the ${streetWord}${facing ? ' vs a bet' : ' (checked to you)'}`

  // --- facing a bet --------------------------------------------------------
  if (facing) {
    const cushion = eq - required

    if (conservativeEq - required >= 0.15 && conservativeEq >= raiseBar(opponents) && ctx.canRaise) {
      const to = sizeTo(state.currentBet + 0.7 * (ctx.potSize + ctx.callAmount), ctx, bb)
      const aggro = aggressive(to, ctx)
      if (aggro) {
        const why = state.street === 'river'
          ? `just calling leaves money on the table when you're this far in front`
          : `flat-calling lets a scare card on the ${nextStreet(state.street)} talk them out of paying you`
        return {
          action: aggro,
          situation,
          explanation:
            `${capitalize(made)} is estimated at ${pct(eq)} ${vs} and calling needs ${pct(required)}. ` +
            `Even the conservative reference is well above that price. Raise to ` +
            `${chips(aggro.to ?? 0)}: ${why}. (${capitalize(modelNote)}.)`,
          equity: eq,
          requiredEquity: required,
        }
      }
    }

    if (cushion >= Math.max(0.02, margin)) {
      return {
        action: { type: 'call' },
        situation,
        explanation:
          `${chips(ctx.callAmount)} to call into a ${chips(ctx.potSize)} pot needs about ` +
          `${pct(required)} equity. ${capitalize(made)}${draws.label ? ` with ${draws.label}` : ''} is ` +
          `estimated at ${pct(eq)} ${vs}; the conservative reference still clears the price. ` +
          `Call, while remembering the bettor's real range can move that number. (${capitalize(modelNote)}.)`,
        equity: eq,
        requiredEquity: required,
      }
    }

    if (draws.live && cushion >= -0.06 && state.street !== 'river') {
      return {
        action: { type: 'call' },
        situation,
        explanation:
          `The estimate is ${pct(eq)} ${vs} with ${draws.label}, while the price asks for ` +
          `${pct(required)}. That is close enough to continue only on the implied-odds assumption that ` +
          `a made draw earns more chips on the ${nextStreet(state.street)}. Call cautiously. ` +
          `(${capitalize(modelNote)}.)`,
        equity: eq,
        requiredEquity: required,
      }
    }

    return {
      action: { type: 'fold' },
      situation,
      explanation:
        `${capitalize(made)} is estimated at ${pct(eq)} ${vs}, and ${chips(ctx.callAmount)} into a ` +
        `${chips(ctx.potSize)} pot needs ${pct(required)}. The random-hand reference does not clear the ` +
        `price${draws.label ? ` — ${draws.label} isn't enough on its own here` : ' and there\'s nothing to draw to'}. ` +
        `Fold; a value-heavy betting range only strengthens that case. (${capitalize(modelNote)}.)`,
      equity: eq,
      requiredEquity: required,
    }
  }

  // --- checked to you ------------------------------------------------------
  if (conservativeEq >= valueBar(opponents) && ctx.canBet) {
    const to = sizeTo(state.currentBet + (2 / 3) * ctx.potSize, ctx, bb)
    const aggro = aggressive(to, ctx)
    if (aggro) {
      const why = state.street === 'river'
        ? `worse hands still have to pay you off, and there's no card left to scare either of you`
        : `big enough to charge the draws that beat you on the ${nextStreet(state.street)}, small enough ` +
          `that worse hands still call`
      return {
        action: aggro,
        situation,
        explanation:
          `${capitalize(made)} is estimated at ${pct(eq)} ${vs}, with the conservative reference ` +
          `still above the value threshold. Bet ${chips(aggro.to ?? 0)}, about two thirds of the pot: ` +
          `${why}. (${capitalize(modelNote)}.)`,
        equity: eq,
      }
    }
  }

  if (draws.strong && state.street !== 'river' && ctx.canBet) {
    const to = sizeTo(state.currentBet + 0.5 * ctx.potSize, ctx, bb)
    const aggro = aggressive(to, ctx)
    if (aggro) {
      return {
        action: aggro,
        situation,
        explanation:
          `You don't have a made hand yet, but ${draws.label} is estimated at ${pct(eq)} ${vs}. Betting ` +
          `can win when they fold now or when the draw lands later. Bet ${chips(aggro.to ?? 0)}, about half ` +
          `the pot. (${capitalize(modelNote)}.)`,
        equity: eq,
      }
    }
  }

  return {
    action: passive(ctx),
    situation,
    explanation:
      `${capitalize(made)} is estimated at ${pct(eq)} ${vs}${draws.label ? ` with ${draws.label}` : ''}. ` +
      `The conservative reference is not high enough to bet for value. Check and keep the pot controlled; ` +
      `a real calling range can be much stronger than random hands. (${capitalize(modelNote)}.)`,
    equity: eq,
  }
}

/** Equity that justifies betting for value, loosened as the pot gets multiway. */
function valueBar(opponents: number): number {
  return 1 / (opponents + 1) + 0.16
}

/** Equity that justifies raising rather than calling. */
function raiseBar(opponents: number): number {
  return valueBar(opponents) + 0.1
}

function nextStreet(street: Street): string {
  if (street === 'flop') return 'turn'
  if (street === 'turn') return 'river'
  return 'next card'
}

// ---------------------------------------------------------------------------
// Draw reading
//
// Lives here (rather than in the evaluator) because it exists to be TALKED
// about: "you have a flush draw" is a sentence, not a hand rank. The AI reads
// draws with the same helper so the coach and the opponents see the same board.
// ---------------------------------------------------------------------------

export interface DrawRead {
  flushDraw: boolean
  openEnded: boolean
  gutshot: boolean
  /** flush draw or open-ender — the draws worth semi-bluffing */
  strong: boolean
  /** anything at all, including a gutshot */
  live: boolean
  /** "a flush draw", "an open-ended straight draw", '' when drawing dead */
  label: string
}

const NO_DRAWS: DrawRead = {
  flushDraw: false, openEnded: false, gutshot: false, strong: false, live: false, label: '',
}

/**
 * Flush draws and straight draws that USE a hole card. A four-flush sitting on
 * the board belongs to everyone, so it isn't a draw — counting it would tell
 * the player they have something they don't.
 */
export function readDraws(hole: Card[], board: Card[]): DrawRead {
  if (board.length === 0 || hole.length < 2) return NO_DRAWS

  const cards = [...hole, ...board]

  // --- flush draw ---
  let flushDraw = false
  for (const suit of new Set(cards.map((c) => c.suit))) {
    const total = cards.filter((c) => c.suit === suit).length
    const mine = hole.filter((c) => c.suit === suit).length
    if (total === 4 && mine >= 1) flushDraw = true
  }

  // --- straight draws ---
  // Ace counts as both 14 and 1 so the wheel shows up.
  const present = new Set<number>()
  for (const card of cards) {
    const v = rankValue(card.rank)
    present.add(v)
    if (v === 14) present.add(1)
  }
  const mineValues = new Set<number>()
  for (const card of hole) {
    const v = rankValue(card.rank)
    mineValues.add(v)
    if (v === 14) mineValues.add(1)
  }

  let made = false
  let openEnded = false
  let gutshot = false
  for (let low = 1; low <= 10; low++) {
    let have = 0
    let mine = 0
    for (let v = low; v < low + 5; v++) {
      if (present.has(v)) have++
      if (mineValues.has(v)) mine++
    }
    if (have === 5) made = true
    if (have === 4 && mine >= 1) {
      // Four in a row with room to extend at BOTH ends is open-ended;
      // anything else (a hole in the middle, or a run stuck against the ace)
      // is a gutshot.
      const run = present.has(low) && present.has(low + 1) && present.has(low + 2) && present.has(low + 3)
      if (run && low >= 2 && low + 4 <= 14) openEnded = true
      else gutshot = true
    }
  }
  if (made) {
    openEnded = false
    gutshot = false
  }

  const strong = flushDraw || openEnded
  const live = strong || gutshot
  return { flushDraw, openEnded, gutshot, strong, live, label: drawLabel(flushDraw, openEnded, gutshot) }
}

function drawLabel(flushDraw: boolean, openEnded: boolean, gutshot: boolean): string {
  if (flushDraw && openEnded) return 'a flush draw and an open-ended straight draw'
  if (flushDraw && gutshot) return 'a flush draw with a gutshot'
  if (flushDraw) return 'a flush draw'
  if (openEnded) return 'an open-ended straight draw'
  if (gutshot) return 'a gutshot straight draw'
  return ''
}

// ---------------------------------------------------------------------------
// Reading the betting from state (no engine import — game.ts owns aiPlayer.ts,
// and a cycle back through it would be a nightmare to untangle)
// ---------------------------------------------------------------------------

/**
 * 0 = unopened, 1 = a single raise, 2 = re-raised or worse.
 *
 * `lastRaiseSize` is the size of the last full raise increment, so
 * `currentBet − lastRaiseSize` is what the bet was BEFORE that raise. If that
 * is still the big blind, only one raise has gone in. (An incomplete all-in
 * raise leaves lastRaiseSize alone, which reads as "one raise" here — the
 * conservative answer.)
 */
function raisesThisStreet(state: HoldemState): number {
  const bb = state.config.bigBlind
  if (state.currentBet <= bb) return 0
  return state.currentBet - state.lastRaiseSize <= bb ? 1 : 2
}

/** Seats matching the current bet, earliest to act first — the raiser leads. */
function raisersThisStreet(state: HoldemState, heroIndex: number): number[] {
  const out: number[] = []
  for (const index of preflopOrder(state)) {
    if (index === heroIndex) continue
    const seat = state.seats[index]
    if (seat.folded || seat.out) continue
    if (seat.streetCommit >= state.currentBet && state.currentBet > 0) out.push(index)
  }
  return out
}

/** Everyone matching the open except the opener. */
function coldCallers(state: HoldemState, heroIndex: number, open: number): number {
  let n = 0
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i]
    if (i === heroIndex || seat.folded || seat.out) continue
    if (seat.streetCommit >= open) n++
  }
  return Math.max(0, n - 1)
}

/** Preflop action order: left of the big blind, ending with the big blind. */
function preflopOrder(state: HoldemState): number[] {
  const order = postflopOrder(state)
  if (order.length <= 1) return order
  // Heads-up the button is the small blind and acts FIRST preflop — the exact
  // reverse of the postflop order.
  if (order.length === 2) return [order[1], order[0]]
  return [...order.slice(2), ...order.slice(0, 2)]
}

/** Does hero act after this seat on every street from the flop on? */
function actsAfter(state: HoldemState, heroIndex: number, otherIndex: number): boolean {
  const order = postflopOrder(state)
  const hero = order.indexOf(heroIndex)
  const other = order.indexOf(otherIndex)
  if (hero < 0 || other < 0) return false
  return hero > other
}

/** Seats that just called the big blind rather than raising it. */
function limpers(state: HoldemState, heroIndex: number, bb: number): number {
  let n = 0
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i]
    if (i === heroIndex || seat.folded || seat.out) continue
    if (seat.streetCommit < bb) continue
    // The big blind posted that money, it didn't limp with it.
    if (positionOf(state, seat.id) === 'BB') continue
    n++
  }
  return n
}

/** How many seats still have to act behind the hero preflop. */
function playersBehind(state: HoldemState, heroIndex: number): number {
  const order = preflopOrder(state)
  const at = order.indexOf(heroIndex)
  if (at < 0) return 0
  let n = 0
  for (let i = at + 1; i < order.length; i++) {
    const seat = state.seats[order[i]]
    if (!seat.folded && !seat.out) n++
  }
  return n
}

function liveOpponents(state: HoldemState, heroIndex: number): number {
  let n = 0
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i]
    if (i === heroIndex || seat.out || seat.folded) continue
    n++
  }
  return Math.max(1, n)
}

/** Stable per-hand, per-street seed so the equity number doesn't jitter. */
function adviceSeed(state: HoldemState): number {
  const a = state.rngSeed | 0
  const b = (state.handNumber * 0x9e37 + STREET_INDEX[state.street]) | 0
  let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae3d) >>> 0
  return (h ^ (h >>> 13)) >>> 0
}

// ---------------------------------------------------------------------------
// Combo families used by the explanations
// ---------------------------------------------------------------------------

const PREMIUM: readonly ComboKey[] = ['AA', 'KK', 'QQ', 'AKs', 'AKo']
const STRONG_CONTINUE: readonly ComboKey[] = ['JJ', 'TT', 'AQs', 'AQo', 'AJs', 'KQs', '99']

function isPremium(combo: ComboKey): boolean {
  return PREMIUM.includes(combo)
}

function isStrongContinue(combo: ComboKey): boolean {
  return STRONG_CONTINUE.includes(combo)
}

function isPair(combo: ComboKey): boolean {
  return combo.length === 2 && combo[0] === combo[1]
}

function isWheelAce(combo: ComboKey): boolean {
  return combo.startsWith('A') && combo.endsWith('s') && '5432'.includes(combo[1])
}

function isOffsuitBroadway(combo: ComboKey): boolean {
  return combo.endsWith('o') && 'AKQJT'.includes(combo[0]) && 'AKQJT'.includes(combo[1])
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

function anyAction(ctx: PokerActionContext): boolean {
  return ctx.canFold || ctx.canCheck || ctx.canCall || ctx.canBet || ctx.canRaise
}

/** Bet if nothing is out there, raise if something is. Null when neither is legal. */
function aggressive(to: number, ctx: PokerActionContext): PokerAction | null {
  if (ctx.canBet) return { type: 'bet', to }
  if (ctx.canRaise) return { type: 'raise', to }
  return null
}

function passive(ctx: PokerActionContext): PokerAction {
  if (ctx.canCheck) return { type: 'check' }
  if (ctx.canCall) return { type: 'call' }
  return { type: 'fold' }
}

/**
 * Round a target size to a real chip amount and clamp it to what's legal.
 *
 * A 2.5bb open can't land on a whole-big-blind grid, so sizes round to the HALF
 * big blind — which in any standard structure is the small blind, i.e. the
 * smallest chip already on the table.
 */
function sizeTo(target: number, ctx: PokerActionContext, bb: number): number {
  const grid = Number.isInteger(bb / 2) && bb >= 2 ? bb / 2 : bb
  const rounded = Math.max(grid, Math.round(target / grid) * grid)
  if (ctx.maxTo <= ctx.minTo) return ctx.maxTo
  return Math.min(ctx.maxTo, Math.max(ctx.minTo, rounded))
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function cardsText(cards: Card[]): string {
  return cards.map((card) => `${card.rank}${SUIT_SYMBOL[card.suit]}`).join('')
}

function chips(amount: number): string {
  return `$${Math.round(amount)}`
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}

/** "on the button", "under the gun", "in the cutoff" — reads after a hand. */
function seatPhrase(position: Position): string {
  if (position === 'UTG') return 'under the gun'
  if (position === 'BTN') return 'on the button'
  return `in ${positionLabel(position)}`
}

/** "a cutoff open", "an under-the-gun open" — the raise we're facing. */
function openPhrase(position: Position | null): string {
  if (!position) return 'an open'
  switch (position) {
    case 'UTG': return 'an under-the-gun open'
    case 'HJ': return 'a hijack open'
    case 'CO': return 'a cutoff open'
    case 'BTN': return 'a button open'
    case 'SB': return 'a small blind open'
    case 'BB': return 'a raise from the big blind'
  }
}
