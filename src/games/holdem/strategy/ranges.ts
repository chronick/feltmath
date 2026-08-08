// Preflop ranges — the "book" for hold'em, encoded once.
//
// Same shape as the blackjack book (src/games/blackjack/strategy/book.ts): the
// range modal renders these charts directly and `holdemAdvice()` reads its
// preflop answer out of the same cells, so a highlighted square and the hint
// card can never disagree.
//
// Every chart is written as thirteen 13-character rows so the source looks like
// the printed grid a player already knows. Rows and columns both run
// A K Q J T 9 8 7 6 5 4 3 2:
//
//   - the diagonal is the pairs (AA down to 22)
//   - ABOVE the diagonal (row rank higher than column rank) is SUITED
//   - BELOW the diagonal is OFFSUIT
//
// Cell codes: R = raise/3-bet, C = call (or check, when checking is free),
// M = a genuine mix, . = fold. Writing them as full grids means all 169 combos
// are present in every chart by construction — there is no "missing cell" case.
//
// The baseline is a solid modern 6-max cash game, 100bb, no ante: tight from
// the front, wide on the button, blinds defended by 3-betting rather than
// cold-calling out of position. Percentages are noted per chart.

import type {
  Card,
  ComboKey,
  HoldemState,
  Position,
  Rank,
  RangeAction,
  RangeChart,
} from '../types'

// ---------------------------------------------------------------------------
// Ranks and combo keys
// ---------------------------------------------------------------------------

/** Grid order, strongest first. 'T' (not '10') is the chart spelling of a ten. */
export const CHART_RANKS: readonly string[] = [
  'A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2',
]

/** Table positions in the order the range modal should tab through them. */
export const POSITION_ORDER: readonly Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']

/** Card rank → the single character the charts use for it. */
const RANK_CHAR: Record<Rank, string> = {
  A: 'A', K: 'K', Q: 'Q', J: 'J', '10': 'T',
  '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2',
}

/** Ace-high numeric value, 2..14 — shared by advice and the AI. */
export function rankValue(rank: Rank): number {
  switch (rank) {
    case 'A': return 14
    case 'K': return 13
    case 'Q': return 12
    case 'J': return 11
    case '10': return 10
    default: return Number(rank)
  }
}

/** Position in the grid, 0 = ace … 12 = deuce. */
function rankSlot(rank: Rank): number {
  return CHART_RANKS.indexOf(RANK_CHAR[rank])
}

/**
 * Two hole cards → the 13×13 grid key: 'QQ', 'AKs', 'T9o' (ranks descending,
 * ten spelled 'T'). Returns '' for an incomplete hand — callers treat a miss as
 * "no chart answer" rather than as a fold.
 */
export function comboKeyOf(hole: Card[]): ComboKey {
  if (hole.length < 2) return ''
  const a = rankSlot(hole[0].rank)
  const b = rankSlot(hole[1].rank)
  if (a < 0 || b < 0) return ''
  const hi = CHART_RANKS[Math.min(a, b)]
  const lo = CHART_RANKS[Math.max(a, b)]
  if (a === b) return `${hi}${lo}`
  return `${hi}${lo}${hole[0].suit === hole[1].suit ? 's' : 'o'}`
}

/** The combo at grid cell (row, col) — suited above the diagonal, offsuit below. */
function comboKeyAt(row: number, col: number): ComboKey {
  const hi = CHART_RANKS[Math.min(row, col)]
  const lo = CHART_RANKS[Math.max(row, col)]
  if (row === col) return `${hi}${lo}`
  return `${hi}${lo}${row < col ? 's' : 'o'}`
}

/** Read one cell. A miss (incomplete hand, junk key) folds. */
export function chartAction(chart: RangeChart, combo: ComboKey): RangeAction {
  return chart.cells[combo] ?? 'fold'
}

// ---------------------------------------------------------------------------
// Grid → cells
// ---------------------------------------------------------------------------

const GRID_CODE: Record<string, RangeAction> = {
  R: 'raise',
  C: 'call',
  M: 'mixed',
  '.': 'fold',
}

function cellsFromGrid(rows: readonly string[]): Record<ComboKey, RangeAction> {
  const cells: Record<ComboKey, RangeAction> = {}
  for (let r = 0; r < CHART_RANKS.length; r++) {
    const row = rows[r] ?? ''
    for (let c = 0; c < CHART_RANKS.length; c++) {
      cells[comboKeyAt(r, c)] = GRID_CODE[row[c]] ?? 'fold'
    }
  }
  return cells
}

/** How many of the 1326 starting hands a combo covers. */
function comboWeight(combo: ComboKey): number {
  if (combo.endsWith('s')) return 4
  if (combo.endsWith('o')) return 12
  return 6
}

/**
 * Share of all hands the chart plays, as a percentage. Mixes count half — a
 * "3-bet or call" square is only half a raising hand however you read it.
 */
export function rangePercent(
  chart: RangeChart,
  actions: readonly RangeAction[] = ['raise', 'call', 'mixed'],
): number {
  let combos = 0
  for (const [combo, action] of Object.entries(chart.cells)) {
    if (!actions.includes(action)) continue
    combos += action === 'mixed' ? comboWeight(combo) / 2 : comboWeight(combo)
  }
  return (combos / 1326) * 100
}

// ---------------------------------------------------------------------------
// First-in (RFI) charts
// ---------------------------------------------------------------------------

//              A  K  Q  J  T  9  8  7  6  5  4  3  2
/** UTG, ~15.5%: 22+, A2s+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo. */
const UTG_RFI: readonly string[] = [
  /* A */ 'RRRRRRRRRRRRR',
  /* K */ 'RRRRR........',
  /* Q */ 'RRRRR........',
  /* J */ 'R..RR........',
  /* T */ '....RR.......',
  /* 9 */ '.....RR......',
  /* 8 */ '......R......',
  /* 7 */ '.......R.....',
  /* 6 */ '........R....',
  /* 5 */ '.........R...',
  /* 4 */ '..........R..',
  /* 3 */ '...........R.',
  /* 2 */ '............R',
]

//              A  K  Q  J  T  9  8  7  6  5  4  3  2
/** Hijack, ~19.5%: UTG plus K9s+, Q9s+, J9s+, T8s+, 87s, 76s, 65s, ATo+, KJo. */
const HJ_RFI: readonly string[] = [
  /* A */ 'RRRRRRRRRRRRR',
  /* K */ 'RRRRRR.......',
  /* Q */ 'RRRRRR.......',
  /* J */ 'RR.RRR.......',
  /* T */ 'R...RRR......',
  /* 9 */ '.....RR......',
  /* 8 */ '......RR.....',
  /* 7 */ '.......RR....',
  /* 6 */ '........RR...',
  /* 5 */ '.........R...',
  /* 4 */ '..........R..',
  /* 3 */ '...........R.',
  /* 2 */ '............R',
]

//              A  K  Q  J  T  9  8  7  6  5  4  3  2
/** Cutoff, ~28%: K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, KTo+, QTo+, JTo. */
const CO_RFI: readonly string[] = [
  /* A */ 'RRRRRRRRRRRRR',
  /* K */ 'RRRRRRRRRR...',
  /* Q */ 'RRRRRRR......',
  /* J */ 'RRRRRRR......',
  /* T */ 'RRRRRRR......',
  /* 9 */ 'R....RRR.....',
  /* 8 */ 'R.....RRR....',
  /* 7 */ '.......RRR...',
  /* 6 */ '........RR...',
  /* 5 */ '.........RR..',
  /* 4 */ '..........R..',
  /* 3 */ '...........R.',
  /* 2 */ '............R',
]

//              A  K  Q  J  T  9  8  7  6  5  4  3  2
/** Button, ~43%: K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 43s, A2o+, K9o+, Q9o+, J9o+, T9o, 98o, 87o. */
const BTN_RFI: readonly string[] = [
  /* A */ 'RRRRRRRRRRRRR',
  /* K */ 'RRRRRRRRRRRRR',
  /* Q */ 'RRRRRRRRRRR..',
  /* J */ 'RRRRRRRRR....',
  /* T */ 'RRRRRRRRR....',
  /* 9 */ 'RRRRRRRRR....',
  /* 8 */ 'R....RRRRR...',
  /* 7 */ 'R.....RRRR...',
  /* 6 */ 'R.......RRR..',
  /* 5 */ 'R........RR..',
  /* 4 */ 'R.........RR.',
  /* 3 */ 'R..........R.',
  /* 2 */ 'R...........R',
]

//              A  K  Q  J  T  9  8  7  6  5  4  3  2
/** Small blind, ~35%, raise-or-fold: no limping into one player who closes the action. */
const SB_RFI: readonly string[] = [
  /* A */ 'RRRRRRRRRRRRR',
  /* K */ 'RRRRRRRRRR...',
  /* Q */ 'RRRRRRRR.....',
  /* J */ 'RRRRRRR......',
  /* T */ 'RRRRRRR......',
  /* 9 */ 'RRRRRRRR.....',
  /* 8 */ 'R.....RRR....',
  /* 7 */ 'R......RRR...',
  /* 6 */ 'R.......RR...',
  /* 5 */ 'R........RR..',
  /* 4 */ 'R.........R..',
  /* 3 */ '...........R.',
  /* 2 */ '............R',
]

/**
 * The big blind is never truly "first in" — if it folds to the BB the hand is
 * over. The chart that matters in an unraised pot is BB facing limpers: raise
 * the hands that want a bigger pot heads-up (the button's opening range does
 * the job), and CHECK everything else. Nothing folds here, because checking
 * costs nothing — so the fold cells become 'call', which the modal reads as
 * "take the free card".
 */
const BB_UNRAISED: readonly string[] = BTN_RFI.map((row) => row.replace(/\./g, 'C'))

// ---------------------------------------------------------------------------
// Facing a single raise
// ---------------------------------------------------------------------------

//              A  K  Q  J  T  9  8  7  6  5  4  3  2
/**
 * Out of position vs one open (UTG/HJ cold, and the small blind): mostly
 * 3-bet-or-fold, ~9%. Flatting out of position with the blind still behind you
 * plays badly, so the flat range is small and strong; A5s/A4s are the bluffs
 * because the ace blocks their premium hands and the wheel cards flop equity.
 */
const VS_OPEN_OOP: readonly string[] = [
  /* A */ 'RRMCC....RRM.',
  /* K */ 'RRMMC........',
  /* Q */ 'M.RCC........',
  /* J */ '...RC........',
  /* T */ '....MC.......',
  /* 9 */ '.....CC......',
  /* 8 */ '......C......',
  /* 7 */ '.......C.....',
  /* 6 */ '........C....',
  /* 5 */ '.........C...',
  /* 4 */ '.............',
  /* 3 */ '.............',
  /* 2 */ '.............',
]

//              A  K  Q  J  T  9  8  7  6  5  4  3  2
/**
 * In position vs one open (cutoff and button), ~22%: position lets you flat a
 * wide, playable range instead of blowing up the pot, so most of the chart is
 * 'call' with a QQ+/AK value 3-bet and A5s as the bluff.
 */
const VS_OPEN_IP: readonly string[] = [
  /* A */ 'RRMCCCCCCRMCC',
  /* K */ 'RRMCCC.......',
  /* Q */ 'CCRCCC.......',
  /* J */ 'CC.MCC.......',
  /* T */ 'C...CCC......',
  /* 9 */ '.....CC......',
  /* 8 */ '......CC.....',
  /* 7 */ '.......CC....',
  /* 6 */ '........CC...',
  /* 5 */ '.........CC..',
  /* 4 */ '..........C..',
  /* 3 */ '...........C.',
  /* 2 */ '............C',
]

//              A  K  Q  J  T  9  8  7  6  5  4  3  2
/**
 * Big blind defending vs one open, ~45%. You already have a big blind in the
 * pot and you close the action, so the price is far better than anyone else's
 * — defend any pair, nearly every suited hand, and the broadways. It is still
 * a losing position long run; defending wide loses less, it doesn't win.
 */
const BB_DEFEND: readonly string[] = [
  /* A */ 'RRMCCCCCCRMCC',
  /* K */ 'RRMCCCCCCCCCC',
  /* Q */ 'CCRCCCCCCCC..',
  /* J */ 'CCCRCCCCC....',
  /* T */ 'CCCCMCCCC....',
  /* 9 */ 'CCCCCCCCC....',
  /* 8 */ 'C...CCCCCC...',
  /* 7 */ 'C.....CCCC...',
  /* 6 */ 'C......CCCC..',
  /* 5 */ 'C.......CCCC.',
  /* 4 */ 'C.........CC.',
  /* 3 */ 'C..........C.',
  /* 2 */ 'C...........C',
]

// ---------------------------------------------------------------------------
// Chart construction
// ---------------------------------------------------------------------------

/** Charts are immutable, so build each one once and hand out the same object. */
const chartCache = new Map<string, RangeChart>()

function chartOf(
  key: string,
  position: Position,
  situation: string,
  grid: readonly string[],
): RangeChart {
  const cached = chartCache.get(key)
  if (cached) return cached
  const chart: RangeChart = { position, situation, cells: cellsFromGrid(grid) }
  chartCache.set(key, chart)
  return chart
}

/** First-in opening range for a position. */
export function rfiChart(position: Position): RangeChart {
  switch (position) {
    case 'UTG': return chartOf('rfi:UTG', position, 'Open (first in)', UTG_RFI)
    case 'HJ': return chartOf('rfi:HJ', position, 'Open (first in)', HJ_RFI)
    case 'CO': return chartOf('rfi:CO', position, 'Open (first in)', CO_RFI)
    case 'BTN': return chartOf('rfi:BTN', position, 'Open (first in)', BTN_RFI)
    case 'SB': return chartOf('rfi:SB', position, 'Open (first in, raise or fold)', SB_RFI)
    case 'BB': return chartOf('rfi:BB', position, 'Unraised pot (raise or check)', BB_UNRAISED)
  }
}

/**
 * Facing exactly one raise. Bucketed by whether the hero will have position on
 * the raiser after the flop — that, not the exact seat, is what decides
 * flat-vs-3-bet. The big blind gets its own chart because it closes the action
 * at a discount.
 */
export function vsOpenChart(heroPosition: Position): RangeChart {
  if (heroPosition === 'BB') {
    return chartOf('vs:BB', heroPosition, 'BB defending vs an open', BB_DEFEND)
  }
  if (heroPosition === 'BTN' || heroPosition === 'CO') {
    return chartOf(`vs:ip:${heroPosition}`, heroPosition, 'Vs an open, in position', VS_OPEN_IP)
  }
  return chartOf(`vs:oop:${heroPosition}`, heroPosition, 'Vs an open, out of position', VS_OPEN_OOP)
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

/** Seat indices still at the table (busted seats have no position). */
function liveSeatIndices(state: HoldemState): number[] {
  const live: number[] = []
  for (let i = 0; i < state.seats.length; i++) {
    if (!state.seats[i].out) live.push(i)
  }
  return live
}

/**
 * Postflop action order: starts left of the button and ends ON the button.
 * Heads-up this puts the button (who is also the small blind) last, which is
 * exactly right — the same rule covers both cases.
 */
export function postflopOrder(state: HoldemState): number[] {
  const live = liveSeatIndices(state)
  if (live.length === 0) return []
  let buttonSlot = live.indexOf(state.button)
  if (buttonSlot < 0) buttonSlot = 0
  const order: number[] = []
  for (let i = 1; i <= live.length; i++) {
    order.push(live[(buttonSlot + i) % live.length])
  }
  return order
}

/**
 * Where a seat is sitting relative to the button.
 *
 * Walking clockwise from the button: BTN, SB, BB, then the rest. The remaining
 * seats are named from the BACK of that walk (the seat just before the button
 * is the cutoff), so short tables drop UTG first exactly as the contract says.
 * Heads-up, the button IS the small blind.
 */
export function positionOf(state: HoldemState, seatId: number): Position {
  const live = liveSeatIndices(state)
  if (live.length === 0) return 'BTN'

  const byId = state.seats.findIndex((seat) => seat.id === seatId)
  const seatIndex = byId >= 0 ? byId : seatId
  const slot = live.indexOf(seatIndex)
  if (slot < 0) return 'BTN'

  let buttonSlot = live.indexOf(state.button)
  if (buttonSlot < 0) buttonSlot = 0

  const n = live.length
  const offset = (slot - buttonSlot + n) % n

  if (n <= 1) return 'BTN'
  if (n === 2) return offset === 0 ? 'SB' : 'BB'
  if (offset === 0) return 'BTN'
  if (offset === 1) return 'SB'
  if (offset === 2) return 'BB'

  // Everything past the blinds is named backwards from the button.
  const fromButton = n - 1 - offset
  if (fromButton === 0) return 'CO'
  if (fromButton === 1) return 'HJ'
  return 'UTG'
}

/** "the button", "under the gun" — reads inside a sentence. */
export function positionLabel(position: Position): string {
  switch (position) {
    case 'UTG': return 'under the gun'
    case 'HJ': return 'the hijack'
    case 'CO': return 'the cutoff'
    case 'BTN': return 'the button'
    case 'SB': return 'the small blind'
    case 'BB': return 'the big blind'
  }
}
