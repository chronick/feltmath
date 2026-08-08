// Hold'em equity — how often this hand wins at showdown against N random hands.
//
// ---------------------------------------------------------------------------
// MODEL / APPROXIMATION (applies to this whole odds module)
// ---------------------------------------------------------------------------
// Opponents are modelled as RANDOM hands: two cards drawn uniformly from the
// cards the hero cannot see (52 − hole − visible board). No range narrowing, no
// read on the action so far. That is the honest "vs N random hands" number the
// equity panel advertises — a villain who has been raising all street holds a
// stronger-than-random distribution, so this is a reference, not solver output.
//
// Runouts are dealt WITHOUT replacement (partial Fisher–Yates over one scratch
// deck), so card-removal effects are exact within every sample. Two modes:
//
//   'exact'        every completion is enumerated — heads-up on the river
//                  (C(45,2) = 990 villain hands) or on the turn (46 rivers ×
//                  C(45,2) = 45,540 combos). Zero sampling error.
//   'monte-carlo'  `samples` independent runouts through a seeded mulberry32.
//                  The standard error of an equity estimate is ≤ 0.5/√samples,
//                  so 5,000 samples ≈ ±1.4% at 95% confidence. Same seed + same
//                  inputs ⇒ same number, always (React StrictMode safe).
//
// The Monte Carlo loop allocates nothing per sample: one scratch deck, one hero
// array, one villain array, all reused. The only per-iteration allocation is
// whatever `evaluate` itself returns, which is why the evaluator is the whole
// performance budget (~20k evaluate calls at 5,000 samples vs 3 opponents).

import { compareHands, evaluate } from '../engine/evaluate'
import { mulberry32 } from '../../../shared/rng'
import { RANKS, SUITS } from '../types'
import type { Card, EquityReport, HandCategory, PotOddsReport, Rank } from '../types'

// ---------------------------------------------------------------------------
// Small rank primitives (local — the odds module stays free of engine deps
// beyond the evaluator itself)
// ---------------------------------------------------------------------------

/** Poker value of a rank: deuce = 2 … ace = 14 (always high preflop). */
const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
}

const RANK_NAME: Record<Rank, string> = {
  '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven',
  '8': 'eight', '9': 'nine', '10': 'ten', J: 'jack', Q: 'queen', K: 'king',
  A: 'ace',
}

const RANK_PLURAL: Record<Rank, string> = {
  '2': 'twos', '3': 'threes', '4': 'fours', '5': 'fives', '6': 'sixes',
  '7': 'sevens', '8': 'eights', '9': 'nines', '10': 'tens', J: 'jacks',
  Q: 'queens', K: 'kings', A: 'aces',
}

/** Full board length in hold'em — flop + turn + river. */
const FULL_BOARD = 5

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function samePhysicalCard(a: Card, b: Card): boolean {
  // Compare rank+suit, never `id`: the scratch deck below mints its own ids and
  // a caller may hand us cards from any shoe.
  return a.rank === b.rank && a.suit === b.suit
}

/**
 * The 52-card deck minus every card the hero can see, in a fresh array we own
 * and are free to shuffle in place. Ids are namespaced so these synthetic cards
 * can never collide with a live shoe's React keys.
 */
function remainingDeck(hole: readonly Card[], board: readonly Card[]): Card[] {
  const seen = new Set<string>()
  for (let i = 0; i < hole.length; i++) seen.add(`${hole[i].rank}-${hole[i].suit}`)
  for (let i = 0; i < board.length; i++) seen.add(`${board[i].rank}-${board[i].suit}`)
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const key = `${rank}-${suit}`
      if (!seen.has(key)) deck.push({ rank, suit, id: `eq-${key}` })
    }
  }
  return deck
}

// ---------------------------------------------------------------------------
// Equity
// ---------------------------------------------------------------------------

/**
 * Conservative normal-approximation 95% margin for a Monte Carlo estimate.
 *
 * A showdown share is bounded in [0, 1], so its standard deviation is at most
 * 0.5. Multiplying that worst-case standard error by 1.96 gives
 * 0.98 / sqrt(samples). Exact reports have no sampling margin.
 */
export function monteCarloMargin95(samples: number): number {
  const n = Math.floor(samples)
  return Number.isFinite(n) && n > 0 ? 0.98 / Math.sqrt(n) : 0
}

/** Running showdown score across samples/enumerations. */
interface Tally {
  /** samples where the hero was the sole best hand */
  win: number
  /** samples where the hero chopped with at least one villain */
  tie: number
  /** Σ of the hero's share of the pot (1 for a win, 1/k for a k-way chop) */
  share: number
  /** samples actually run */
  count: number
}

function emptyTally(): Tally {
  return { win: 0, tie: 0, share: 0, count: 0 }
}

/**
 * Equity of `hole` on `board` against `opponents` random hands.
 *
 * Heads-up on the turn or river the whole space is enumerated (`method:
 * 'exact'`, `samples` = the enumeration size) — everything else runs `samples`
 * seeded Monte Carlo runouts. `equity` counts chops as partial wins
 * (`(wins + Σ 1/k) / samples`), so `equity ≠ win + tie`; `win` is the
 * probability of scooping and `tie` the probability of chopping.
 */
export function equity(
  hole: Card[],
  board: Card[],
  opponents: number,
  samples: number,
  seed: number,
): EquityReport {
  const madeHand = describeMade(hole, board)
  const villains = Math.max(0, Math.floor(opponents))

  // Nobody to beat: the pot is already the hero's.
  if (villains === 0) {
    return { equity: 1, win: 1, tie: 0, opponents: 0, method: 'exact', samples: 0, madeHand }
  }

  const deck = remainingDeck(hole, board)
  const missing = Math.max(0, FULL_BOARD - board.length)
  const need = 2 * villains + missing

  // Malformed input (duplicate cards, an oversized table): report nothing
  // rather than guessing.
  if (deck.length < need) {
    return {
      equity: 0, win: 0, tie: 0, opponents: villains,
      method: 'monte-carlo', samples: 0, madeHand,
    }
  }

  // Cheap enough to be exact: heads-up with ≤ 1 card to come.
  if (villains === 1 && missing <= 1) {
    const tally = enumerateHeadsUp(hole, board, deck, missing)
    return toReport(tally, villains, 'exact', madeHand)
  }

  const runs = Math.max(1, Math.floor(samples))
  const tally = monteCarlo(hole, board, deck, villains, missing, runs, seed)
  return toReport(tally, villains, 'monte-carlo', madeHand)
}

function toReport(
  tally: Tally,
  opponents: number,
  method: 'exact' | 'monte-carlo',
  madeHand: string,
): EquityReport {
  const n = tally.count
  if (n === 0) {
    return { equity: 0, win: 0, tie: 0, opponents, method, samples: 0, madeHand }
  }
  return {
    equity: clamp01(tally.share / n),
    win: clamp01(tally.win / n),
    tie: clamp01(tally.tie / n),
    opponents,
    method,
    samples: n,
    madeHand,
  }
}

/**
 * Monte Carlo runouts. Hot loop invariants:
 * - `deck` is shuffled in place and never rebuilt; a partial Fisher–Yates moves
 *   `need` uniformly-random cards to the front each sample (the tail stays a
 *   valid permutation of the rest, so no restore pass is needed).
 * - `hero` and `villain` are preallocated packed arrays; only the cells that
 *   change per sample are rewritten.
 * - Villains are evaluated one at a time against the hero's rank, so a single
 *   villain scratch array suffices, and a villain who beats the hero ends the
 *   sample immediately.
 */
function monteCarlo(
  hole: readonly Card[],
  board: readonly Card[],
  deck: Card[],
  villains: number,
  missing: number,
  samples: number,
  seed: number,
): Tally {
  const rng = mulberry32(seed)
  const tally = emptyTally()
  const deckSize = deck.length
  const need = 2 * villains + missing

  // hero = hole + known board + (missing runout cards, rewritten per sample)
  const hero: Card[] = hole.concat(board)
  const heroBase = hero.length
  for (let i = 0; i < missing; i++) hero.push(deck[i])

  // villain = 2 hole cards + known board + the same runout tail
  const villain: Card[] = [deck[0], deck[1]]
  for (let i = 0; i < board.length; i++) villain.push(board[i])
  const villainBase = villain.length
  for (let i = 0; i < missing; i++) villain.push(deck[i])

  for (let s = 0; s < samples; s++) {
    // Partial Fisher–Yates: deck[0..need-1] becomes a uniform sample without
    // replacement. `| 0` truncates (indices are < 52, well inside int32).
    for (let i = 0; i < need; i++) {
      const j = i + ((rng() * (deckSize - i)) | 0)
      const swap = deck[i]
      deck[i] = deck[j]
      deck[j] = swap
    }

    for (let i = 0; i < missing; i++) {
      const runout = deck[i]
      hero[heroBase + i] = runout
      villain[villainBase + i] = runout
    }

    const heroRank = evaluate(hero)
    let tied = 0
    let beaten = false
    for (let v = 0; v < villains; v++) {
      const at = missing + 2 * v
      villain[0] = deck[at]
      villain[1] = deck[at + 1]
      const cmp = compareHands(heroRank, evaluate(villain))
      if (cmp < 0) {
        beaten = true
        break
      }
      if (cmp === 0) tied++
    }

    tally.count++
    if (beaten) continue
    if (tied === 0) {
      tally.win++
      tally.share += 1
    } else {
      tally.tie++
      tally.share += 1 / (tied + 1)
    }
  }

  return tally
}

/**
 * Exhaustive heads-up enumeration with `missing` ∈ {0, 1} cards to come.
 *
 * River (missing = 0): one hero evaluation, C(45,2) = 990 villain hands.
 * Turn (missing = 1): rivers OUTER so the hero is evaluated once per river
 * (46 times) instead of once per combo — 46 × C(45,2) = 45,540 combos and
 * ≈ 45.6k evaluations total. Every (river, villain hand) assignment of three
 * distinct unseen cards is equally likely, so the uniform sum is exact.
 */
function enumerateHeadsUp(
  hole: readonly Card[],
  board: readonly Card[],
  deck: readonly Card[],
  missing: number,
): Tally {
  const tally = emptyTally()
  const deckSize = deck.length

  const hero: Card[] = hole.concat(board)
  const heroBase = hero.length
  for (let i = 0; i < missing; i++) hero.push(deck[i])

  const villain: Card[] = [deck[0], deck[1]]
  for (let i = 0; i < board.length; i++) villain.push(board[i])
  const villainBase = villain.length
  for (let i = 0; i < missing; i++) villain.push(deck[i])

  const runouts = missing === 1 ? deckSize : 1
  for (let r = 0; r < runouts; r++) {
    // −1 skips nothing when the board is already complete.
    const used = missing === 1 ? r : -1
    if (missing === 1) {
      hero[heroBase] = deck[r]
      villain[villainBase] = deck[r]
    }
    const heroRank = evaluate(hero)

    for (let a = 0; a < deckSize; a++) {
      if (a === used) continue
      villain[0] = deck[a]
      for (let b = a + 1; b < deckSize; b++) {
        if (b === used) continue
        villain[1] = deck[b]
        const cmp = compareHands(heroRank, evaluate(villain))
        tally.count++
        if (cmp > 0) {
          tally.win++
          tally.share += 1
        } else if (cmp === 0) {
          tally.tie++
          tally.share += 0.5
        }
      }
    }
  }

  return tally
}

// ---------------------------------------------------------------------------
// Pot odds
// ---------------------------------------------------------------------------

/**
 * Price of a call: `requiredEquity = toCall / (potBeforeCall + toCall)`.
 *
 * Deliberately the simple TWO-WAY formula. It ignores players still to act
 * behind (overcalls sweeten the price), future streets (implied and reverse
 * implied odds), and any dead money that may still come in — so it answers
 * exactly one question: "if this call closes the action and we go to showdown,
 * how often must I win to break even?"
 */
export function potOdds(toCall: number, potBeforeCall: number): PotOddsReport {
  const call = Math.max(0, toCall)
  const pot = Math.max(0, potBeforeCall)
  const potAfterCall = pot + call
  return {
    toCall: call,
    potAfterCall,
    requiredEquity: potAfterCall > 0 ? clamp01(call / potAfterCall) : 0,
  }
}

// ---------------------------------------------------------------------------
// Hand description
// ---------------------------------------------------------------------------

/**
 * One line naming what the hero actually holds.
 *
 * Preflop (empty board) it describes the two cards — "Pocket aces",
 * "Ace-king suited", "Ten-nine offsuit". With a board it is the evaluator's
 * label for the best five, prefixed "Board plays: …" when those five come
 * entirely off the board and the hole cards contribute nothing.
 */
export function describeMade(hole: Card[], board: Card[]): string {
  if (board.length === 0) return describeHole(hole)

  const cards = hole.concat(board)
  // Not a real hold'em street (evaluate wants 5–7 cards) — fall back to the
  // preflop description rather than throwing at the UI.
  if (cards.length < 5) return describeHole(hole)

  const rank = evaluate(cards)
  let usesHole = false
  for (let i = 0; i < rank.best.length && !usesHole; i++) {
    for (let h = 0; h < hole.length; h++) {
      if (samePhysicalCard(rank.best[i], hole[h])) {
        usesHole = true
        break
      }
    }
  }
  if (usesHole) return rank.label
  // Lowercase the evaluator's leading capital so the prefix reads as one line.
  return `Board plays: ${rank.label.charAt(0).toLowerCase()}${rank.label.slice(1)}`
}

function describeHole(hole: readonly Card[]): string {
  if (hole.length < 2) return 'No hand'
  const a = hole[0]
  const b = hole[1]
  if (a.rank === b.rank) return `Pocket ${RANK_PLURAL[a.rank]}`
  const aHigh = RANK_VALUE[a.rank] >= RANK_VALUE[b.rank]
  const hi = aHigh ? a : b
  const lo = aHigh ? b : a
  const suffix = a.suit === b.suit ? 'suited' : 'offsuit'
  return `${capitalize(RANK_NAME[hi.rank])}-${RANK_NAME[lo.rank]} ${suffix}`
}

// ---------------------------------------------------------------------------
// Quick heuristic strength (for the AI — NOT equity)
// ---------------------------------------------------------------------------

/**
 * Rough band each hand category occupies on the 0–1 strength scale. Deliberately
 * non-linear: a flush is far closer to a straight than "5/8 vs 4/8" suggests.
 */
const CATEGORY_BAND: Record<HandCategory, readonly [number, number]> = {
  0: [0.0, 0.18],  // high card
  1: [0.18, 0.45], // pair
  2: [0.45, 0.62], // two pair
  3: [0.62, 0.74], // three of a kind
  4: [0.74, 0.84], // straight
  5: [0.84, 0.91], // flush
  6: [0.91, 0.96], // full house
  7: [0.96, 0.99], // four of a kind
  8: [0.99, 1.0],  // straight flush
}

/** Bill Chen's high-card component: A = 10, K = 8, Q = 7, J = 6, else rank/2. */
function chenHighCard(value: number): number {
  if (value === 14) return 10
  if (value === 13) return 8
  if (value === 12) return 7
  if (value === 11) return 6
  return value / 2
}

/** Bill Chen's preflop formula. Range ≈ −1 (72o) … 20 (AA). */
function chenScore(hole: readonly Card[]): number {
  if (hole.length < 2) return 0
  const a = hole[0]
  const b = hole[1]
  const va = RANK_VALUE[a.rank]
  const vb = RANK_VALUE[b.rank]
  const hi = va >= vb ? va : vb
  const lo = va >= vb ? vb : va

  let score = chenHighCard(hi)
  if (va === vb) {
    score = Math.max(5, score * 2)
  } else {
    const gap = hi - lo - 1
    if (gap === 1) score -= 1
    else if (gap === 2) score -= 2
    else if (gap === 3) score -= 4
    else if (gap >= 4) score -= 5
    // Straight bonus: connected-ish and no ace/king/queen stretching the gap.
    if (gap <= 1 && hi < 12) score += 1
  }
  if (a.suit === b.suit) score += 2
  return Math.ceil(score)
}

/**
 * Cheap 0–1 strength score, for AI thresholds and quick UI sorting.
 *
 * HEURISTIC, not equity — it never simulates a runout and knows nothing about
 * how many opponents are in or what is still to come. Preflop it is a
 * normalized Chen score; postflop it blends the made-hand category band with
 * (a) the top card of the made hand and (b) how many hole cards the made hand
 * actually uses, so trips on a paired board that plays for everyone scores well
 * below trips you made with a pocket pair. Use `equity()` for real numbers.
 */
export function handStrengthQuick(hole: Card[], board: Card[]): number {
  const cards = hole.concat(board)
  if (board.length === 0 || cards.length < 5) {
    return clamp01((chenScore(hole) + 1) / 21)
  }

  const rank = evaluate(cards)
  const band = CATEGORY_BAND[rank.category]
  // `best` is ordered best-first, so best[0] carries the defining rank.
  const top = rank.best.length > 0 ? RANK_VALUE[rank.best[0].rank] : 8
  const topNorm = clamp01((top - 2) / 12)

  let used = 0
  for (let h = 0; h < hole.length; h++) {
    for (let i = 0; i < rank.best.length; i++) {
      if (samePhysicalCard(rank.best[i], hole[h])) {
        used++
        break
      }
    }
  }
  const holeNorm = hole.length > 0 ? clamp01(used / hole.length) : 0

  const within = 0.5 * topNorm + 0.5 * holeNorm
  return clamp01(band[0] + (band[1] - band[0]) * within)
}
