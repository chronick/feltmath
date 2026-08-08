// Basic strategy advice, derived entirely from the charts in ./book.ts.
//
// Nothing here hard-codes a play. Every answer is a lookup into
// `bookTables(rules)` plus a fallback chain for actions the current hand isn't
// allowed to take — so the hint card and the chart modal are always the same
// data. Explanations are written per cell family: the point of the trainer is
// the WHY, not the letter.

import type {
  Action,
  ActionContext,
  BookCode,
  BookTables,
  Card,
  Rank,
  RulesConfig,
  StrategyAdvice,
} from '../types'
import { handTotal } from '../engine/hand'
import { bookCode, bookTables, dealerColumn, hardRow, pairRow, softRow } from './book'

type TableKind = 'hard' | 'soft' | 'pairs'

interface Cell {
  table: TableKind
  row: string
  col: string
  code: BookCode
  /** the hand sits outside the printed chart; we clamped to the nearest row */
  offChart?: boolean
}

/** What the hand may actually do right now (ctx, tightened by card count). */
interface Allowed {
  hit: boolean
  stand: boolean
  double: boolean
  split: boolean
  surrender: boolean
}

// ---------------------------------------------------------------------------
// Code → action
// ---------------------------------------------------------------------------

/** The book's answer with no restrictions at all. */
function primaryAction(code: BookCode): Action {
  switch (code) {
    case 'H': return 'hit'
    case 'S': return 'stand'
    case 'D':
    case 'Ds': return 'double'
    case 'P':
    case 'Ph': return 'split'
    case 'Rh':
    case 'Rs': return 'surrender'
  }
}

/**
 * Book code → the best action that's actually on the table.
 * D→hit, Ds→stand, Rh→hit, Rs→stand, P/Ph→hit (callers re-read a pair they
 * can't split as a plain hard/soft total before falling back this far).
 */
function resolve(code: BookCode, can: Allowed): Action {
  switch (code) {
    case 'H': return can.hit ? 'hit' : 'stand'
    case 'S': return can.stand ? 'stand' : 'hit'
    case 'D': return can.double ? 'double' : can.hit ? 'hit' : 'stand'
    case 'Ds': return can.double ? 'double' : can.stand ? 'stand' : 'hit'
    case 'P':
    case 'Ph': return can.split ? 'split' : can.hit ? 'hit' : 'stand'
    case 'Rh': return can.surrender ? 'surrender' : can.hit ? 'hit' : 'stand'
    case 'Rs': return can.surrender ? 'surrender' : can.stand ? 'stand' : 'hit'
  }
}

// ---------------------------------------------------------------------------
// Chart lookups
// ---------------------------------------------------------------------------

function pairCellOf(tables: BookTables, rank: Rank, col: string): Cell {
  const row = pairRow(rank)
  return { table: 'pairs', row, col, code: bookCode(tables.pairs, row, col) }
}

function totalCellOf(tables: BookTables, total: number, soft: boolean, col: string): Cell {
  if (soft && total >= 13 && total <= 20) {
    const row = softRow(total)
    return { table: 'soft', row, col, code: bookCode(tables.soft, row, col) }
  }
  if (soft && total < 13) {
    // Soft 12 — a pair of aces you aren't allowed to split — sits below the
    // chart's A,2 row. It draws strictly worse than A,2, so the doubles on that
    // row don't carry down: it always just hits. We point at A,2 as the nearest
    // printed row and say so in the explanation.
    return { table: 'soft', row: 'A,2', col, code: 'H', offChart: true }
  }
  const row = hardRow(total)
  const offChart = total < 5
  return { table: 'hard', row, col, code: bookCode(tables.hard, row, col), offChart }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function basicStrategy(
  cards: Card[],
  dealerUp: Rank,
  rules: RulesConfig,
  ctx: ActionContext,
  /** Can this bankroll fund the split plus both possible post-split doubles? */
  canFundDoubleAfterSplit: boolean = rules.doubleAfterSplit,
): StrategyAdvice {
  const effectiveRules = rules.doubleAfterSplit && !canFundDoubleAfterSplit
    ? { ...rules, doubleAfterSplit: false }
    : rules
  const tables = bookTables(effectiveRules)
  const col = dealerColumn(dealerUp)
  const { total, soft } = handTotal(cards)

  const twoCard = cards.length === 2
  const pairRank: Rank | null = twoCard && cards[0].rank === cards[1].rank ? cards[0].rank : null

  // ctx should already encode these, but doubling and surrender are two-card
  // plays and splitting needs a pair — never trust a caller into a bad hint.
  const can: Allowed = {
    hit: ctx.canHit,
    stand: ctx.canStand,
    double: ctx.canDouble && twoCard,
    split: ctx.canSplit && pairRank !== null,
    surrender: ctx.canSurrender && twoCard,
  }

  // --- hands with nothing left to decide ----------------------------------
  if (total >= 21) {
    const busted = total > 21
    return {
      action: 'stand',
      bookAction: 'stand',
      situation: busted ? `Bust (${total}) vs ${col}` : `21 vs ${col}`,
      cell: { table: 'hard', row: '21', col },
      explanation: busted
        ? `Busted with ${total} — the bet is already gone and the hand is done. Nothing left to play.`
        : `Twenty-one. No card can improve it and every card ruins it, so the hand is done — stand.`,
    }
  }

  if (cards.length < 2) {
    // A split hand mid-deal. The engine deals its second card on the next step.
    const nearest = totalCellOf(tables, total, soft, col)
    return {
      action: 'hit',
      bookAction: 'hit',
      situation: `${soft ? 'Soft' : 'Hard'} ${total} vs ${col}`,
      cell: { table: nearest.table, row: nearest.row, col },
      explanation:
        `This split hand only has one card so far — it needs its second card before there's a decision to make.`,
    }
  }

  // --- normal lookup ------------------------------------------------------
  const pairCell = pairRank !== null ? pairCellOf(tables, pairRank, col) : null
  let totalCell = totalCellOf(tables, total, soft, col)

  // Wizard's split-limit exception: if A,A cannot be split again but drawing
  // to split aces is allowed, treat it as soft 12. Double against 6 in shoe
  // games and 5/6 with one or two decks; the D code falls back to hit.
  const unsplittableAcesDouble = col === '6' || (rules.decks <= 2 && col === '5')
  if (pairRank === 'A' && !can.split && rules.hitSplitAces && unsplittableAcesDouble) {
    totalCell = { ...totalCell, code: 'D' }
  }

  // The unconstrained book answer is the pairs row whenever the hand IS a pair,
  // even if this seat is out of splits — that's what "the book says" means.
  const bookAction = primaryAction((pairCell ?? totalCell).code)

  // The cell we actually play from: the pairs row only while splitting is on
  // the table, otherwise the hand is re-read as a plain hard/soft total.
  const cell = pairCell && can.split ? pairCell : totalCell
  // The 4+-deck H17 surrender exception for 8s falls back to the normal split
  // when surrender is not available for this otherwise splittable hand.
  const action = cell.table === 'pairs' && cell.row === '8,8' && cell.code === 'Rh' &&
    !can.surrender && can.split
    ? 'split'
    : resolve(cell.code, can)

  return {
    action,
    bookAction,
    situation: situationText(cell, total, soft, pairRank),
    cell: { table: cell.table, row: cell.row, col },
    explanation: explain({ cell, total, soft, col, rules: effectiveRules, action, bookAction, pairRank }),
  }
}

// ---------------------------------------------------------------------------
// Situation label
// ---------------------------------------------------------------------------

function situationText(cell: Cell, total: number, soft: boolean, pairRank: Rank | null): string {
  if (cell.table === 'pairs' && pairRank) {
    return `Pair of ${pairNoun(pairRank)} vs ${cell.col}`
  }
  return `${soft ? 'Soft' : 'Hard'} ${total} vs ${cell.col}`
}

/** 'A' → "Aces", 'K' → "10s", '8' → "8s" */
function pairNoun(rank: Rank): string {
  if (rank === 'A') return 'Aces'
  if (rank === 'J' || rank === 'Q' || rank === 'K' || rank === '10') return '10s'
  return `${rank}s`
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

interface ExplainCtx {
  cell: Cell
  total: number
  soft: boolean
  col: string
  rules: RulesConfig
  action: Action
  bookAction: Action
  pairRank: Rank | null
}

/** Roughly how often the dealer breaks with each upcard (S17 multi-deck). */
const DEALER_BUST: Record<string, number | undefined> = {
  '2': 35, '3': 37, '4': 40, '5': 42, '6': 42,
  '7': 26, '8': 24, '9': 23, '10': 21,
}

/** Roughly how often YOU break by taking one card on a stiff total. */
const HIT_BUST: Record<number, number | undefined> = {
  12: 31, 13: 39, 14: 46, 15: 54, 16: 62,
}

function bustPct(col: string, rules: RulesConfig): number {
  // Hitting soft 17 makes the dealer's 6 the single most breakable upcard.
  if (col === '6' && rules.dealerHitsSoft17) return 44
  return DEALER_BUST[col] ?? 0
}

function isBustCard(col: string): boolean {
  return col === '2' || col === '3' || col === '4' || col === '5' || col === '6'
}

/** '10' → "ten", 'A' → "ace", '9' → "9" — for reading aloud inside a sentence. */
function colWord(col: string): string {
  if (col === 'A') return 'ace'
  if (col === '10') return 'ten'
  return col
}

function explain(x: ExplainCtx): string {
  const parts: string[] = []

  if (x.bookAction === 'split' && x.action !== 'split' && x.pairRank) {
    parts.push(
      `The book splits ${pairNoun(x.pairRank).toLowerCase()} here, but this hand can't split — ` +
      `play it as ${x.soft ? 'a soft' : 'a hard'} ${x.total}.`,
    )
  }

  parts.push(x.cell.offChart ? offChartReason(x) : baseReason(x))

  const note = unavailableNote(x)
  if (note) parts.push(note)

  return parts.join(' ')
}

/** Why the final action differs from the code printed in the highlighted cell. */
function unavailableNote(x: ExplainCtx): string {
  const cellAction = primaryAction(x.cell.code)
  if (cellAction === x.action) return ''
  if (cellAction === 'double') {
    return x.action === 'stand'
      ? `You can't double this hand, so stand on it instead.`
      : `You can't double this hand, so just take the card.`
  }
  if (cellAction === 'surrender') {
    return x.action === 'stand'
      ? `Surrender isn't on offer, so stand and hope they break.`
      : `Surrender isn't on offer, so hit and hope.`
  }
  return ''
}

function offChartReason(x: ExplainCtx): string {
  if (x.soft) {
    if (x.cell.code === 'D') {
      return `A pair of aces that can't be re-split is a soft 12. Because this game lets you ` +
        `draw to split aces, double against the dealer's weak ${x.col} when you can; otherwise hit.`
    }
    return `A soft 12 sits below where the chart starts — you can't bust, and you can't stand on 12, ` +
      `so take a card.`
  }
  return `A hard ${x.total} is below the bottom row of the chart — nothing can hurt you here, so hit.`
}

function baseReason(x: ExplainCtx): string {
  if (x.cell.table === 'pairs') return pairReason(x)
  if (x.cell.table === 'soft') return softReason(x)
  return hardReason(x)
}

// --- pairs -----------------------------------------------------------------

/** The pair cells that are only splits when double-after-split is on offer. */
const DAS_ONLY_SPLITS: Record<string, readonly string[] | undefined> = {
  '6,6': ['2'],
  '4,4': ['5', '6'],
  '3,3': ['2', '3'],
  '2,2': ['2', '3'],
}

function pairReason(x: ExplainCtx): string {
  const { col, rules } = x
  const code = x.cell.code
  const bust = bustPct(col, rules)
  const dasNote = code === 'Ph'
    ? ` It's only worth it because you can double the hands you split into.`
    : ''

  // A DAS-only split that this game has taken away — say why, don't blame the
  // dealer's upcard for it.
  if (code === 'H' && (DAS_ONLY_SPLITS[x.cell.row] ?? []).includes(col)) {
    return `This pair is only a split when you can double after splitting, and this game doesn't ` +
      `allow it — play the hard ${x.total} and take a card.`
  }

  switch (x.cell.row) {
    case 'A,A':
      return `Always split aces. One hand of A,A is a soft 12 going nowhere; two fresh hands each ` +
        `start with the best card in the deck and land a ten about a third of the time.`

    case '10,10':
      return `Never split tens. Twenty already wins or pushes around 85% of the time — breaking it ` +
        `up trades one great hand for two ordinary ones.`

    case '9,9':
      if (code === 'S') {
        return col === '7'
          ? `Stand. A 7 finishes on 17 more often than anything else, and your 18 already beats it — ` +
            `don't break up a hand that's ahead.`
          : `Stand. Eighteen is behind a ${colWord(col)}, but splitting would put you behind in two ` +
            `hands instead of one.`
      }
      return isBustCard(col)
        ? `Eighteen is fine, but a ${col} busts about ${bust}% of the time — split and get twice ` +
          `the money in front of a dealer who's in trouble.`
        : `Their ${colWord(col)} beats 18 more often than it loses to it, so 18 isn't the winner it ` +
          `looks like. Two 9s give you two runs at 19 or 20 instead of one hand that's already behind.`

    case '8,8':
      if (code === 'Rh') {
        return `Against an ace in an H17 game, even two fresh 8s lose often enough that late ` +
          `surrender saves more than splitting. Take half the bet back.`
      }
      return isBustCard(col)
        ? `Sixteen is the worst hand in blackjack; two 8s starting fresh beat one 16 — especially ` +
          `against a ${col} that busts about ${bust}% of the time.`
        : `Sixteen is the worst hand in blackjack. Against a ${colWord(col)} you're splitting to ` +
          `lose less rather than to win, and two live 8s still beat one hopeless 16.`

    case '7,7':
      if (code === 'H') {
        return `Fourteen is bad, but splitting it into a ${colWord(col)} just buys you two bad hands. ` +
          `Take a card instead.`
      }
      return col === '7'
        ? `A 7 usually finishes on 17, and your 14 has to draw to beat it anyway. Split — a hand ` +
          `starting with a 7 gets there far more often than a stiff 14 does.`
        : `Fourteen is a stiff you'd have to hit into trouble. Two 7s start over while a ${col} ` +
          `busts about ${bust}% of the time.`

    case '6,6':
      if (code === 'H') {
        return `A pair of 6s is just a hard 12 against a ${colWord(col)} — hit it. Splitting into ` +
          `that upcard only doubles your exposure.`
      }
      return `Twelve is a hand you can't stand on and can't safely hit. Splitting 6s puts money out ` +
        `while a ${col} busts about ${bust}% of the time.${dasNote}`

    case '5,5':
      return code === 'H'
        ? `Never split 5s — they're a hard 10. But a ${colWord(col)} is too strong to double into, ` +
          `so play the 10 and hit.`
        : `Never split 5s. A pair of 5s is a hard 10, the best doubling hand there is, and it makes ` +
          `20 or better nearly 40% of the time against their ${colWord(col)}.`

    case '4,4':
      return code === 'H'
        ? `Two 4s are a hard 8 that can't bust — just hit it. Splitting turns one safe hand into two ` +
          `weak ones.`
        : `Normally a hard 8 just hits, but against a ${col} that busts about ${bust}% of the time ` +
          `splitting 4s wins out.${dasNote}`

    case '3,3':
    case '2,2': {
      const pip = x.cell.row === '3,3' ? '3' : '2'
      const pipTotal = x.cell.row === '3,3' ? 6 : 4
      if (code === 'H') {
        return `A pair of ${pip}s is a hard ${pipTotal} with nowhere to go, and a ${colWord(col)} is ` +
          `far too strong to split into. Take a card.`
      }
      return col === '7'
        ? `A hard ${pipTotal} can't get there in one hand. Split and give each ${pip} a real start ` +
          `against a 7 that usually stops on 17.${dasNote}`
        : `A hard ${pipTotal} can't win by standing, and a ${col} busts about ${bust}% of the time. ` +
          `Split it and get two live hands out there.${dasNote}`
    }

    default:
      return x.soft ? softReason(x) : hardReason(x)
  }
}

// --- soft totals -----------------------------------------------------------

function softReason(x: ExplainCtx): string {
  const { total, col, rules } = x
  const code = x.cell.code
  const bust = bustPct(col, rules)

  if (code === 'D') {
    return `You can't bust drawing to a soft ${total}, and a ${col} busts about ${bust}% of the ` +
      `time — get more money on the table while the dealer is weak.`
  }

  if (code === 'Ds') {
    if (total >= 19) {
      return `Soft 19 already wins most of the time, but when the dealer hits soft 17 a 6 is weak ` +
        `enough that the extra bet is worth more than the extra point. Double if you can, stand if you can't.`
    }
    return col === '2'
      ? `Soft 18 is a made hand, but a 2 is weaker than it looks when the dealer hits soft 17 — ` +
        `double if you're allowed, stand if you aren't.`
      : `Soft 18 wants a bigger bet against a ${col} that busts about ${bust}% of the time, but ` +
        `it's already a made hand — double if you're allowed, stand if you aren't.`
  }

  if (code === 'S') {
    if (total >= 19) {
      return `Soft ${total} is already a winning hand — 19 and 20 beat most of what the dealer ` +
        `finishes with. Don't get greedy.`
    }
    if (col === '7') {
      return `Eighteen already beats the 17 that a 7 makes more often than any other total. Stand.`
    }
    if (col === '8') {
      return `An 8 finishes on 18 more often than any other total, so standing pushes far more than ` +
        `it loses — and hitting just turns a made hand into a stiff. Stand.`
    }
    return `Eighteen is a made hand and a ${col} isn't weak enough to double into. Stand.`
  }

  if (total >= 18) {
    return `Soft 18 loses to a ${colWord(col)} more often than it wins — they make 19 or better too ` +
      `often. You can't bust taking a card, so hit and try to improve.`
  }
  return `A soft ${total} can't bust, so the card is pure upside — and standing on ${total} loses to ` +
    `almost anything the dealer finishes with.`
}

// --- hard totals -----------------------------------------------------------

function hardReason(x: ExplainCtx): string {
  const { total, col, rules } = x
  const code = x.cell.code
  const bust = bustPct(col, rules)

  if (code === 'Rh' || code === 'Rs') {
    if (total === 16) {
      return `Sixteen against a ${colWord(col)} wins less than a quarter of the time however you ` +
        `play it — taking half your bet back is the cheapest way out.`
    }
    if (total === 15) {
      return `Fifteen against a ${colWord(col)} is a losing hand every way you play it; giving up ` +
        `half the bet beats losing all of it most of the time.`
    }
    return `Even 17 loses more than half the time against an ace when the dealer hits soft 17 — take ` +
      `half the bet back rather than stand into it.`
  }

  if (code === 'D') {
    if (total === 11) {
      return `Eleven is the best doubling hand in the game — you can't bust, and nearly a third of ` +
        `the deck makes 21.`
    }
    if (total === 10) {
      return `Ten makes 20 or better close to 40% of the time and you're already ahead of a ` +
        `${colWord(col)} — double while you're the favorite.`
    }
    return `Nine doubles only in this window: a ${col} busts about ${bust}% of the time, and that's ` +
      `what pays for the extra bet.`
  }

  if (code === 'S') {
    if (total >= 18) {
      return `Standing on ${total} is already a strong hand — there's nothing to gain by risking it.`
    }
    if (total === 17) {
      return `Seventeen is a bad hand, but hitting it is worse: any card above a 4 busts you. Stand ` +
        `and hope the dealer breaks.`
    }
    if (total === 12) {
      return `Only a ten busts you here, but the dealer's ${col} busts about ${bust}% of the time — ` +
        `stand and let them wreck.`
    }
    return `Dealer's ${col} busts about ${bust}% of the time. Hitting a ${total} busts you about ` +
      `${HIT_BUST[total] ?? 50}% of the time — stand and let them take the risk.`
  }

  // 'H'
  if (total <= 8) {
    return `Nothing can bust a ${total}, and it's far too small to stand on or to double — just take a card.`
  }
  if (total === 9) {
    return `Nine is a good hitting hand, but a ${colWord(col)} is too strong to double into. Take the ` +
      `card without the extra bet.`
  }
  if (total === 10) {
    return `Ten is strong, but a ${colWord(col)} makes 20 or better far too often to double into. ` +
      `Hit and see what comes.`
  }
  if (total === 11) {
    return `Eleven is the best hitting hand there is, but an ace is strong enough that the extra bet ` +
      `doesn't pay when the dealer stands on soft 17. Just hit.`
  }
  if (total === 12 && (col === '2' || col === '3')) {
    return `Twelve against a ${col} is the closest call on the chart: a ${col} only busts about ` +
      `${bust}% of the time, and only a ten hurts you — about ${HIT_BUST[12] ?? 31}%. Take the card.`
  }
  return `Your ${total} loses to the made hand a ${colWord(col)} usually finishes with. Hitting busts ` +
    `you about ${HIT_BUST[total] ?? 50}% of the time, but standing loses more often than that.`
}
