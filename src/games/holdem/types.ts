// Texas hold'em module type contracts. Engine, evaluator, odds, AI, and UI
// all build against this file. Shared card primitives: src/shared/cards.ts.

import type { Card, Rank } from '../../shared/cards'

export type { Card, Rank }
export { RANKS, SUITS } from '../../shared/cards'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HoldemConfig {
  /** number of AI opponents, 1..5 (6-max table including the human) */
  aiPlayers: number
  smallBlind: number
  bigBlind: number
  /** stack a seat (re)buys in for, in chips */
  buyIn: number
  /** auto top-up short stacks to buyIn between hands */
  topUp: boolean
  /** Monte Carlo samples for the equity panel (accuracy vs speed) */
  equitySamples: number
}

export const DEFAULT_HOLDEM: HoldemConfig = {
  aiPlayers: 3,
  smallBlind: 5,
  bigBlind: 10,
  buyIn: 1000,
  topUp: true,
  equitySamples: 5000,
}

// ---------------------------------------------------------------------------
// Hand evaluation (engine/evaluate.ts)
// ---------------------------------------------------------------------------

/** 8 = straight flush … 0 = high card. */
export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  8: 'Straight flush',
  7: 'Four of a kind',
  6: 'Full house',
  5: 'Flush',
  4: 'Straight',
  3: 'Three of a kind',
  2: 'Two pair',
  1: 'Pair',
  0: 'High card',
}

/**
 * Comparable strength of a 5-card hand chosen from 5-7 cards.
 * Compare `score` numbers directly: higher wins, equal is a chop.
 */
export interface HandRank {
  category: HandCategory
  /**
   * Single packed integer encoding category + ordered tiebreak card values
   * (each value 2..14, ace high; wheel straight encodes its top card as 5).
   */
  score: number
  /** e.g. "Two pair, kings and nines, jack kicker" */
  label: string
  /** the five cards that make the hand (from the input), best first */
  best: Card[]
}

// ---------------------------------------------------------------------------
// Game state (engine/game.ts)
// ---------------------------------------------------------------------------

export type Street = 'preflop' | 'flop' | 'turn' | 'river'

export type PokerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'

/** A concrete act; bet/raise carry the TOTAL amount the seat is going to. */
export interface PokerAction {
  type: PokerActionType
  /** for bet: total bet size; for raise: total raised-to amount. Others omit. */
  to?: number
}

export interface HoldemSeatState {
  id: number
  kind: 'human' | 'ai'
  name: string
  /** chips behind (not committed) */
  stack: number
  /** hole cards, empty when folded pre-deal or sitting out */
  hole: Card[]
  /** chips committed on the CURRENT street */
  streetCommit: number
  /** chips committed across the whole hand (drives pot math / side pots) */
  totalCommit: number
  folded: boolean
  allIn: boolean
  /** seat busted and is out of chips (rebuys between hands if topUp) */
  out: boolean
  /** showdown result, filled at settlement */
  revealed: boolean
  handRank?: HandRank
  /** chips returned from the pot(s) this hand */
  won: number
}

/** One pot layer; `eligible` are seat ids that can win it. */
export interface Pot {
  amount: number
  eligible: number[]
}

export type HoldemPhase =
  | 'idle'        // between hands; waiting for "Next hand"
  | 'posting'     // blinds going in (one step)
  | 'dealing'     // hole cards, one card per step
  | 'betting'     // action on `street`; human turns pause the stepper
  | 'streetDeal'  // burn+deal community card(s) for the next street
  | 'showdown'    // reveal hands in order, one per step
  | 'settlement'  // pots awarded; waiting for "Next hand"

export interface HoldemEvent {
  kind: 'deal' | 'blind' | 'action' | 'street' | 'showdown' | 'award' | 'hand'
  text: string
  seatId?: number
}

export interface HoldemStats {
  hands: number
  handsWon: number
  net: number
  /** hands where the human voluntarily put chips in preflop */
  vpipHands: number
  /** times the human saw a showdown / won at showdown */
  showdowns: number
  showdownsWon: number
}

export interface HoldemState {
  config: HoldemConfig
  rngSeed: number
  deck: Card[]
  board: Card[]
  seats: HoldemSeatState[]
  /** seat index with the dealer button */
  button: number
  /** whose turn during 'betting' */
  actingIndex: number
  phase: HoldemPhase
  street: Street
  /** highest total streetCommit any seat has made this street */
  currentBet: number
  /** size of the last full bet/raise increment this street (min-raise basis) */
  lastRaiseSize: number
  /**
   * Seat ids still owed a turn this street. Betting ends when empty.
   * (Re-filled on a full raise; after an incomplete all-in raise, seats that
   * already acted are still owed a CALL decision but may not re-raise.)
   */
  pendingToAct: number[]
  /**
   * Seat ids barred from raising this street: they had already acted when an
   * incomplete all-in raise moved the bet. They may still call or fold.
   * Cleared at each street start and by any full bet/raise.
   */
  raiseBarred: number[]
  /** dealing bookkeeping */
  dealStep: number
  /** showdown reveal bookkeeping */
  revealStep: number
  pots: Pot[]
  handNumber: number
  events: HoldemEvent[]
  stats: HoldemStats
}

/** What the human may do right now (amounts in chips). */
export interface PokerActionContext {
  canFold: boolean
  canCheck: boolean
  canCall: boolean
  /** chips required to call (already net of streetCommit) */
  callAmount: number
  canBet: boolean
  canRaise: boolean
  /** minimum total for a bet / raise-to */
  minTo: number
  /** maximum total (stack + streetCommit = all-in) */
  maxTo: number
  /** current pot total incl. this street's commits (for sizing presets) */
  potSize: number
}

export const NO_POKER_ACTIONS: PokerActionContext = {
  canFold: false, canCheck: false, canCall: false, callAmount: 0,
  canBet: false, canRaise: false, minTo: 0, maxTo: 0, potSize: 0,
}

// ---------------------------------------------------------------------------
// Odds / equity (odds/equity.ts)
// ---------------------------------------------------------------------------

export interface EquityReport {
  /** P(best hand at showdown) counting ties as partial wins */
  equity: number
  win: number
  tie: number
  /** number of opponents assumed still in */
  opponents: number
  /** 'exact' enumeration (river/turn heads-up) or 'monte-carlo' */
  method: 'exact' | 'monte-carlo'
  samples: number
  /** current made hand / draw description, e.g. "Pair of kings" */
  madeHand: string
}

export interface PotOddsReport {
  toCall: number
  potAfterCall: number
  /** toCall / (pot + toCall) — equity needed to break even on a call */
  requiredEquity: number
}

// ---------------------------------------------------------------------------
// Strategy (strategy/ranges.ts + strategy/advice.ts)
// ---------------------------------------------------------------------------

/** Position at a 6-max table (fewer players collapse from the front). */
export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB'

/** '22'..'AA' pairs, 'AKs'/'AKo' style otherwise — standard 13x13 grid key. */
export type ComboKey = string

export type RangeAction = 'raise' | 'call' | 'mixed' | 'fold'

export interface RangeChart {
  position: Position
  /** situation label, e.g. "Open (first in)" or "BB vs BTN open" */
  situation: string
  cells: Record<ComboKey, RangeAction>
}

export interface HoldemAdvice {
  /** recommended action (bet/raise carry a suggested `to`) */
  action: PokerAction
  /** e.g. "A♠K♠ on the button (first in)" or "Top pair vs turn barrel" */
  situation: string
  explanation: string
  /** preflop only: chart + combo to highlight in the range modal */
  chart?: { position: Position; combo: ComboKey }
  /** postflop context surfaced in the hint card */
  equity?: number
  requiredEquity?: number
}
