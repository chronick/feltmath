// 5-7 card poker hand evaluation. This is the hot path of the equity Monte
// Carlo (~50k calls per panel refresh), so it reads the cards DIRECTLY:
// one pass builds a rank histogram + per-suit rank bitmasks, then a bit scan
// finds straights and a high-to-low histogram sweep finds quads/trips/pairs.
// No 21-subset enumeration, no sorting of combos, and no per-call scratch
// allocation — the only allocations are the returned HandRank, its `best`
// array and its label string.
//
// ---------------------------------------------------------------------------
// SCORE PACKING
// ---------------------------------------------------------------------------
// `score` is six base-15 digits, most significant first:
//
//     category (0-8) · t1 · t2 · t3 · t4 · t5
//
// where each tiebreak digit is a card value 2..14 (ace high) and 0 means
// "this category needs no digit there".
//
//   8 straight flush  t1 = top card of the run (wheel = 5)
//   7 four of a kind  t1 = quad rank, t2 = best kicker of the other cards
//   6 full house      t1 = trips rank, t2 = pair rank
//   5 flush           t1..t5 = five highest cards OF THE FLUSH SUIT
//   4 straight        t1 = top card of the run (wheel = 5)
//   3 three of a kind t1 = trips rank, t2..t3 = kickers
//   2 two pair        t1 = high pair, t2 = low pair, t3 = kicker
//   1 pair            t1 = pair rank, t2..t4 = kickers
//   0 high card       t1..t5 = five highest cards
//
// Every digit is < 15 and every category is < 9, so the packing is strictly
// lexicographic: the biggest hand in category c scores
// c*15^5 + 759374 < (c+1)*15^5, so a higher category always wins, and inside a
// category the digits decide left to right. The largest possible score is
// 6,834,374 — exact in a double, so `score` differences are exact.

import type { Suit } from '../../../shared/cards'
import type { Card, HandCategory, HandRank, Rank } from '../types'

/** Ace high; tens and faces spelled out because Rank uses '10', not 'T'. */
const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
}

const SUIT_INDEX: Record<Suit, number> = {
  spades: 0,
  hearts: 1,
  diamonds: 2,
  clubs: 3,
}

// Label vocabulary, indexed by card value (slots 0 and 1 are never read).
const RANK_WORD = [
  '', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'jack', 'queen', 'king', 'ace',
]
const RANK_TITLE = [
  '', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Jack', 'Queen', 'King', 'Ace',
]
const RANK_PLURAL = [
  '', '', 'twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights',
  'nines', 'tens', 'jacks', 'queens', 'kings', 'aces',
]

// ---------------------------------------------------------------------------
// Scratch state
// ---------------------------------------------------------------------------
//
// Reused across calls so the Monte Carlo loop allocates nothing per hand.
// `evaluate` is synchronous and never re-entrant — it calls no user code that
// could call back into it — so a single shared set of buffers is safe.

/** cards per rank value, indexed 2..14 */
const rankCount = new Uint8Array(15)
/** cards per suit, indexed by SUIT_INDEX */
const suitCount = new Uint8Array(4)
/** bitmask of rank values present in each suit (bit v = value v) */
const suitRankMask = new Int32Array(4)
/** tiebreak digits t1..t5 of the packed score */
const tie = new Uint8Array(5)
/** card values of the winning five, most significant first */
const pickRanks = new Uint8Array(5)

const ACE_BIT = 1 << 14
/** Ace played low for the wheel; bit 0 is never used. */
const LOW_ACE_BIT = 1 << 1
const RUN = 0b11111

// ---------------------------------------------------------------------------
// Bit / histogram helpers
// ---------------------------------------------------------------------------

/**
 * Top card of the highest five-in-a-row inside `mask`, or 0 for no straight.
 * The wheel (A-2-3-4-5) returns 5, which is exactly how it must score.
 */
function straightTop(mask: number): number {
  const m = (mask & ACE_BIT) !== 0 ? mask | LOW_ACE_BIT : mask
  for (let top = 14; top >= 5; top--) {
    if (((m >>> (top - 4)) & RUN) === RUN) return top
  }
  return 0
}

/**
 * Write the five card values of a straight topped by `top` into `pickRanks`,
 * highest first. In the wheel the ace lands last: 5-4-3-2-A.
 */
function fillRun(top: number): void {
  for (let i = 0; i < 5; i++) {
    const v = top - i
    pickRanks[i] = v >= 2 ? v : 14
  }
}

/**
 * Append the highest remaining card values as one-card kickers, writing into
 * `pickRanks` from index `pi` and into `tie` from index `ti` (they advance in
 * lockstep — every kicker is exactly one card). `ex1`/`ex2` are the values the
 * hand already spent; 0 means "nothing to exclude" since real values are 2..14.
 *
 * Kickers are counted per DISTINCT value, which is what makes a third pair or a
 * leftover set contribute its rank exactly once — e.g. AAKKQQJ kicks the queen,
 * not the jack, and AAAAKKK kicks a king.
 */
function fillKickers(pi: number, ti: number, ex1: number, ex2: number): void {
  let p = pi
  let t = ti
  for (let v = 14; v >= 2 && p < 5; v--) {
    if (rankCount[v] === 0 || v === ex1 || v === ex2) continue
    pickRanks[p++] = v
    tie[t++] = v
  }
}

/**
 * Resolve `pickRanks` back to the actual Card objects from the input, most
 * significant first (the UI highlights these at showdown). `suit` is the flush
 * suit index for flush and straight-flush hands, -1 when any suit will do.
 *
 * Linear scans over at most seven cards, de-duplicated by object identity
 * against what has already been taken — no set, no sort. A value that is not
 * present (only reachable with malformed input) is simply skipped, so this
 * never throws; it just returns a shorter array.
 */
function pickCards(cards: Card[], suit: number): Card[] {
  const best: Card[] = []
  for (let i = 0; i < 5; i++) {
    const want = pickRanks[i]
    for (let c = 0; c < cards.length; c++) {
      const card = cards[c]
      if (RANK_VALUE[card.rank] !== want) continue
      if (suit >= 0 && SUIT_INDEX[card.suit] !== suit) continue
      let taken = false
      for (let k = 0; k < best.length; k++) {
        if (best[k] === card) {
          taken = true
          break
        }
      }
      if (taken) continue
      best.push(card)
      break
    }
  }
  return best
}

/** Pack the current `tie` digits under `category` and materialise the result. */
function finish(
  category: HandCategory,
  cards: Card[],
  suit: number,
  label: string,
): HandRank {
  // Annotated: `category` is a literal union, so an inferred `let` would not
  // widen to number and the arithmetic below would not type-check.
  let score: number = category
  for (let i = 0; i < 5; i++) score = score * 15 + tie[i]
  return { category, score, label, best: pickCards(cards, suit) }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Best five-card hand out of 5-7 cards (hole + board).
 *
 * Categories are tested strongest first and each test is exhaustive for seven
 * cards, so the first match IS the best hand. Two coincidences make the short
 * circuits safe: only one suit can hold five of seven cards (so there is only
 * ever one flush and one candidate straight flush), and neither quads nor a
 * full house can coexist with a flush in seven cards.
 */
export function evaluate(cards: Card[]): HandRank {
  rankCount.fill(0)
  suitCount.fill(0)
  suitRankMask.fill(0)
  tie.fill(0)
  pickRanks.fill(0)

  let rankMask = 0
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const v = RANK_VALUE[card.rank]
    const s = SUIT_INDEX[card.suit]
    rankCount[v]++
    rankMask |= 1 << v
    suitCount[s]++
    suitRankMask[s] |= 1 << v
  }

  let flushSuit = -1
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      flushSuit = s
      break
    }
  }

  // 8 — straight flush. A run of five same-suit cards can only live in the
  // suit that has five of them, so scan that one rank mask and nothing else.
  if (flushSuit >= 0) {
    const sfTop = straightTop(suitRankMask[flushSuit])
    if (sfTop > 0) {
      tie[0] = sfTop
      fillRun(sfTop)
      const label = sfTop === 14
        ? 'Royal flush'
        : `${RANK_TITLE[sfTop]}-high straight flush`
      return finish(8, cards, flushSuit, label)
    }
  }

  // One sweep, high value first, for every paired shape: quads, the two best
  // sets of trips, the two best pairs.
  let quad = 0
  let trips = 0
  let trips2 = 0
  let pair1 = 0
  let pair2 = 0
  for (let v = 14; v >= 2; v--) {
    const c = rankCount[v]
    if (c === 4) {
      if (quad === 0) quad = v
    } else if (c === 3) {
      if (trips === 0) trips = v
      else if (trips2 === 0) trips2 = v
    } else if (c === 2) {
      if (pair1 === 0) pair1 = v
      else if (pair2 === 0) pair2 = v
    }
  }

  // 7 — four of a kind plus the best of the remaining cards (which may be the
  // rank of a leftover set, e.g. AAAA KKK kicks a king).
  if (quad > 0) {
    pickRanks[0] = quad
    pickRanks[1] = quad
    pickRanks[2] = quad
    pickRanks[3] = quad
    tie[0] = quad
    fillKickers(4, 1, quad, 0)
    return finish(7, cards, -1, `Four of a kind, ${RANK_PLURAL[quad]}`)
  }

  // 6 — full house: the best set, then the best pair, where a SECOND set can
  // supply that pair with two of its three cards (999 333 → nines over threes).
  if (trips > 0 && (trips2 > 0 || pair1 > 0)) {
    const pairRank = trips2 > pair1 ? trips2 : pair1
    pickRanks[0] = trips
    pickRanks[1] = trips
    pickRanks[2] = trips
    pickRanks[3] = pairRank
    pickRanks[4] = pairRank
    tie[0] = trips
    tie[1] = pairRank
    const label = `Full house, ${RANK_PLURAL[trips]} over ${RANK_PLURAL[pairRank]}`
    return finish(6, cards, -1, label)
  }

  // 5 — flush: the five highest cards OF THE FLUSH SUIT. Reading the suit's
  // own rank mask is what keeps a big offsuit card out of the hand (A♠ with
  // K♥Q♥9♥7♥2♥ is a king-high flush, not an ace-high one).
  if (flushSuit >= 0) {
    const mask = suitRankMask[flushSuit]
    let i = 0
    for (let v = 14; v >= 2 && i < 5; v--) {
      if ((mask & (1 << v)) === 0) continue
      pickRanks[i] = v
      tie[i] = v
      i++
    }
    return finish(5, cards, flushSuit, `${RANK_TITLE[tie[0]]}-high flush`)
  }

  // 4 — straight, wheel included (it scores and reads as five-high).
  const top = straightTop(rankMask)
  if (top > 0) {
    tie[0] = top
    fillRun(top)
    return finish(4, cards, -1, `${RANK_TITLE[top]}-high straight`)
  }

  // 3 — three of a kind (a pair alongside would have been a full house).
  if (trips > 0) {
    pickRanks[0] = trips
    pickRanks[1] = trips
    pickRanks[2] = trips
    tie[0] = trips
    fillKickers(3, 1, trips, 0)
    return finish(3, cards, -1, `Three of a kind, ${RANK_PLURAL[trips]}`)
  }

  // 2 — the two highest pairs; a third pair only ever offers its rank as a
  // kicker candidate, which the distinct-value kicker scan picks up for free.
  if (pair2 > 0) {
    pickRanks[0] = pair1
    pickRanks[1] = pair1
    pickRanks[2] = pair2
    pickRanks[3] = pair2
    tie[0] = pair1
    tie[1] = pair2
    fillKickers(4, 2, pair1, pair2)
    const kicker = tie[2]
    const pairs = `Two pair, ${RANK_PLURAL[pair1]} and ${RANK_PLURAL[pair2]}`
    const label = kicker > 0 ? `${pairs}, ${RANK_WORD[kicker]} kicker` : pairs
    return finish(2, cards, -1, label)
  }

  // 1 — one pair.
  if (pair1 > 0) {
    pickRanks[0] = pair1
    pickRanks[1] = pair1
    tie[0] = pair1
    fillKickers(2, 1, pair1, 0)
    return finish(1, cards, -1, `Pair of ${RANK_PLURAL[pair1]}`)
  }

  // 0 — high card.
  fillKickers(0, 0, 0, 0)
  return finish(0, cards, -1, `${RANK_TITLE[tie[0]]} high`)
}

/**
 * Sign of a − b: negative when `a` loses, 0 for a chop, positive when `a` wins.
 * Board-plays-for-everyone chops fall out for free — both hands pack the same
 * five board values into the same score.
 */
export function compareHands(a: HandRank, b: HandRank): number {
  return a.score < b.score ? -1 : a.score > b.score ? 1 : 0
}
