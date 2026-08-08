// The "book": multi-deck basic strategy charts, encoded once.
//
// This file is the single source of truth for strategy. The book modal renders
// `bookTables(rules)` directly, and `basicStrategy()` reads its answer out of
// the same tables — so a chart cell and the hint card can never disagree.
//
// Base charts are the standard 4–8 deck tables (Wizard of Odds layout) for
// S17 + DAS. Games where the dealer hits soft 17 apply a short, explicit patch
// list (`H17_DEVIATIONS`). Rule-dependent codes are then resolved against the
// active rules: surrender cells fall back to their non-surrender action when
// late surrender is off, and DAS-only split cells fall back to hit when
// double-after-split is off.

import type { BookCode, BookTable, BookTables, Rank, RulesConfig } from '../types'

// Short aliases so the chart bodies below line up like a printed strategy card.
const H: BookCode = 'H' // hit
const S: BookCode = 'S' // stand
const D: BookCode = 'D' // double, else hit
const Ds: BookCode = 'Ds' // double, else stand
const P: BookCode = 'P' // split
const Ph: BookCode = 'Ph' // split if double-after-split is allowed, else hit
const Rh: BookCode = 'Rh' // surrender, else hit
const Rs: BookCode = 'Rs' // surrender, else stand

/** Dealer upcard columns, left to right. */
export const BOOK_COLS: readonly string[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A']

/** Hard-total rows, 5 through 21. */
export const HARD_ROWS: readonly string[] = [
  '5', '6', '7', '8', '9', '10', '11', '12', '13',
  '14', '15', '16', '17', '18', '19', '20', '21',
]

/** Soft-total rows, A,2 (soft 13) through A,9 (soft 20). */
export const SOFT_ROWS: readonly string[] = [
  'A,2', 'A,3', 'A,4', 'A,5', 'A,6', 'A,7', 'A,8', 'A,9',
]

/** Pair rows, strongest first (the order players expect on a chart). */
export const PAIR_ROWS: readonly string[] = [
  'A,A', '10,10', '9,9', '8,8', '7,7', '6,6', '5,5', '4,4', '3,3', '2,2',
]

// ---------------------------------------------------------------------------
// Base charts — 4–8 decks, dealer STANDS on soft 17, double after split allowed
// ---------------------------------------------------------------------------

//                    2   3   4   5   6   7   8   9   10  A
const HARD_BASE: readonly (readonly BookCode[])[] = [
  /*  5 */ [H, H, H, H, H, H, H, H, H, H],
  /*  6 */ [H, H, H, H, H, H, H, H, H, H],
  /*  7 */ [H, H, H, H, H, H, H, H, H, H],
  /*  8 */ [H, H, H, H, H, H, H, H, H, H],
  /*  9 */ [H, D, D, D, D, H, H, H, H, H],
  /* 10 */ [D, D, D, D, D, D, D, D, H, H],
  /* 11 */ [D, D, D, D, D, D, D, D, D, H],
  /* 12 */ [H, H, S, S, S, H, H, H, H, H],
  /* 13 */ [S, S, S, S, S, H, H, H, H, H],
  /* 14 */ [S, S, S, S, S, H, H, H, H, H],
  /* 15 */ [S, S, S, S, S, H, H, H, Rh, H],
  /* 16 */ [S, S, S, S, S, H, H, Rh, Rh, Rh],
  /* 17 */ [S, S, S, S, S, S, S, S, S, S],
  /* 18 */ [S, S, S, S, S, S, S, S, S, S],
  /* 19 */ [S, S, S, S, S, S, S, S, S, S],
  /* 20 */ [S, S, S, S, S, S, S, S, S, S],
  /* 21 */ [S, S, S, S, S, S, S, S, S, S],
]

//                     2   3   4   5   6   7   8   9   10  A
const SOFT_BASE: readonly (readonly BookCode[])[] = [
  /* A,2 (13) */ [H, H, H, D, D, H, H, H, H, H],
  /* A,3 (14) */ [H, H, H, D, D, H, H, H, H, H],
  /* A,4 (15) */ [H, H, D, D, D, H, H, H, H, H],
  /* A,5 (16) */ [H, H, D, D, D, H, H, H, H, H],
  /* A,6 (17) */ [H, D, D, D, D, H, H, H, H, H],
  /* A,7 (18) */ [S, Ds, Ds, Ds, Ds, S, S, H, H, H],
  /* A,8 (19) */ [S, S, S, S, S, S, S, S, S, S],
  /* A,9 (20) */ [S, S, S, S, S, S, S, S, S, S],
]

//                      2   3   4   5   6   7   8   9   10  A
const PAIRS_BASE: readonly (readonly BookCode[])[] = [
  /* A,A   */ [P, P, P, P, P, P, P, P, P, P],
  /* 10,10 */ [S, S, S, S, S, S, S, S, S, S],
  /* 9,9   */ [P, P, P, P, P, S, P, P, S, S],
  /* 8,8   */ [P, P, P, P, P, P, P, P, P, P],
  /* 7,7   */ [P, P, P, P, P, P, H, H, H, H],
  /* 6,6   */ [Ph, P, P, P, P, H, H, H, H, H],
  /* 5,5   */ [D, D, D, D, D, D, D, D, H, H],
  /* 4,4   */ [H, H, H, Ph, Ph, H, H, H, H, H],
  /* 3,3   */ [Ph, Ph, P, P, P, P, H, H, H, H],
  /* 2,2   */ [Ph, Ph, P, P, P, P, H, H, H, H],
]

// ---------------------------------------------------------------------------
// H17 deviations (multi-deck)
// ---------------------------------------------------------------------------

interface CellPatch {
  table: keyof BookTables
  row: string
  col: string
  code: BookCode
}

/**
 * The multi-deck plays that change when the dealer HITS soft 17. Everything
 * else on the chart is identical to the S17 tables above.
 *
 * The two surrender patches are written as surrender codes; `gate()` walks them
 * back to hit/stand when the game doesn't offer late surrender.
 */
const H17_DEVIATIONS: readonly CellPatch[] = [
  { table: 'hard', row: '11', col: 'A', code: D },  // double 11 vs ace
  { table: 'soft', row: 'A,7', col: '2', code: Ds }, // double soft 18 vs 2
  { table: 'soft', row: 'A,8', col: '6', code: Ds }, // double soft 19 vs 6
  { table: 'hard', row: '15', col: 'A', code: Rh },  // surrender 15 vs ace
  { table: 'hard', row: '17', col: 'A', code: Rs },  // surrender 17 vs ace
]

// ---------------------------------------------------------------------------
// Table construction
// ---------------------------------------------------------------------------

/** Resolve rule-dependent codes down to what this game actually allows. */
function gate(code: BookCode, rules: RulesConfig): BookCode {
  if (!rules.lateSurrender) {
    if (code === 'Rh') return 'H'
    if (code === 'Rs') return 'S'
  }
  if (!rules.doubleAfterSplit && code === 'Ph') return 'H'
  return code
}

function buildTable(
  kind: keyof BookTables,
  rows: readonly string[],
  base: readonly (readonly BookCode[])[],
  rules: RulesConfig,
): BookTable {
  const cells: BookCode[][] = base.map((row) => row.slice())

  if (rules.dealerHitsSoft17) {
    for (const patch of H17_DEVIATIONS) {
      if (patch.table !== kind) continue
      const r = rows.indexOf(patch.row)
      const c = BOOK_COLS.indexOf(patch.col)
      if (r >= 0 && c >= 0) cells[r][c] = patch.code
    }
  }

  for (const row of cells) {
    for (let c = 0; c < row.length; c++) row[c] = gate(row[c], rules)
  }

  return { cols: [...BOOK_COLS], rows: [...rows], cells }
}

/** The full chart set for a given rule configuration. */
export function bookTables(rules: RulesConfig): BookTables {
  return {
    hard: buildTable('hard', HARD_ROWS, HARD_BASE, rules),
    soft: buildTable('soft', SOFT_ROWS, SOFT_BASE, rules),
    pairs: buildTable('pairs', PAIR_ROWS, PAIRS_BASE, rules),
  }
}

// ---------------------------------------------------------------------------
// Lookup helpers (shared by basicStrategy and the chart UI)
// ---------------------------------------------------------------------------

/** Dealer upcard → chart column label. All ten-value cards share the '10' column. */
export function dealerColumn(rank: Rank): string {
  if (rank === 'A') return 'A'
  if (rank === 'J' || rank === 'Q' || rank === 'K' || rank === '10') return '10'
  return rank
}

/** Hard total → row label, clamped to the printed 5–21 range. */
export function hardRow(total: number): string {
  const clamped = Math.min(21, Math.max(5, Math.trunc(total)))
  return String(clamped)
}

/** Soft total → row label ('A,2'…'A,9'), clamped to the printed 13–20 range. */
export function softRow(total: number): string {
  const clamped = Math.min(20, Math.max(13, Math.trunc(total)))
  // soft total = 11 + kicker, so the row's kicker card is total − 11
  return `A,${clamped - 11}`
}

/** Pair rank → row label. Any two ten-value cards share the '10,10' row. */
export function pairRow(rank: Rank): string {
  if (rank === 'A') return 'A,A'
  if (rank === 'J' || rank === 'Q' || rank === 'K' || rank === '10') return '10,10'
  return `${rank},${rank}`
}

/**
 * Read one cell. Callers clamp their row/col first, so a miss means a
 * degenerate hand rather than a real chart entry — hitting is the safe default.
 */
export function bookCode(table: BookTable, row: string, col: string): BookCode {
  const r = table.rows.indexOf(row)
  const c = table.cols.indexOf(col)
  if (r < 0 || c < 0) return 'H'
  return table.cells[r][c]
}
