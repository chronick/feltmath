// Blackjack module type contracts. Engine, strategy, odds, AI, and UI all
// build against this file. Shared card primitives live in src/shared/cards.ts.

import type { Card, Composition, Rank } from '../../shared/cards'

export type { Card, Composition, Rank }
export { RANKS, SUITS } from '../../shared/cards'

// ---------------------------------------------------------------------------
// Rules (American / hole-card game)
// ---------------------------------------------------------------------------

export interface RulesConfig {
  /** number of 52-card decks in the shoe */
  decks: 1 | 2 | 4 | 6 | 8
  /** H17 (true) vs S17 (false) */
  dealerHitsSoft17: boolean
  /** 1.5 = 3:2, 1.2 = 6:5 */
  blackjackPayout: 1.5 | 1.2
  doubleAfterSplit: boolean
  /** which two-card totals may double */
  doubleOn: 'any2' | '9to11' | '10to11'
  /** max hands a seat can split to (2..4) */
  maxSplitHands: number
  resplitAces: boolean
  /** may the player hit split aces (usually false: one card each) */
  hitSplitAces: boolean
  lateSurrender: boolean
  /** offer insurance when dealer shows an ace */
  insurance: boolean
  /** fraction of the shoe dealt before reshuffle, e.g. 0.75 */
  penetration: number
  /** number of AI companion players, 0..6 */
  aiPlayers: number
}

export const DEFAULT_RULES: RulesConfig = {
  decks: 6,
  dealerHitsSoft17: true,
  blackjackPayout: 1.5,
  doubleAfterSplit: true,
  doubleOn: 'any2',
  maxSplitHands: 4,
  resplitAces: false,
  hitSplitAces: false,
  lateSurrender: true,
  insurance: true,
  penetration: 0.75,
  aiPlayers: 2,
}

export const MIN_BET = 5
export const STARTING_BANKROLL = 1000

// ---------------------------------------------------------------------------
// Hands / seats / game state
// ---------------------------------------------------------------------------

export type Action = 'hit' | 'stand' | 'double' | 'split' | 'surrender'

export type HandOutcome =
  | 'win' | 'lose' | 'push' | 'blackjack' | 'surrender' | 'bust'

export interface HandState {
  cards: Card[]
  bet: number
  doubled: boolean
  surrendered: boolean
  /** true if this hand came from a split */
  fromSplit: boolean
  /** true if this hand is a split-aces hand (one-card rule may apply) */
  fromSplitAces: boolean
  /** player has stood / busted / auto-resolved; no more actions */
  finished: boolean
  outcome?: HandOutcome
  /** chips returned at settlement (stake + winnings; 0 on a loss) */
  payout?: number
}

export interface SeatState {
  id: number
  kind: 'human' | 'ai'
  name: string
  bankroll: number
  /** bet posted for next round (betting phase) */
  pendingBet: number
  hands: HandState[]
  activeHandIndex: number
  /** insurance side bet posted this round (0 = none) */
  insuranceBet: number
  insuranceResult?: 'win' | 'lose'
}

export type Phase =
  | 'betting'        // waiting for the human to post a bet
  | 'dealing'        // initial deal, one card per step
  | 'insurance'      // dealer shows ace, human decides insurance
  | 'peek'           // dealer checks hole card for blackjack (American rule)
  | 'playerTurns'    // seats act in order; AI seats auto-play
  | 'dealerTurn'     // dealer reveals hole card and draws
  | 'settlement'     // pay/collect, show results, wait for "next hand"

export interface DealerState {
  cards: Card[]
  holeRevealed: boolean
}

/** One entry per visible step, drives the event log. */
export interface GameEvent {
  kind:
    | 'shuffle' | 'deal' | 'reveal' | 'action' | 'outcome'
    | 'dealerDraw' | 'insuranceResult' | 'roundStart' | 'roundEnd'
  text: string
  seatId?: number
}

export interface GameState {
  rules: RulesConfig
  /** seed for the pure, deterministic shuffle (advances on every shuffle) */
  rngSeed: number
  shoe: Card[]
  /** cards seen and discarded (for penetration/reshuffle logic) */
  discard: Card[]
  /** true → reshuffle before next round */
  reshufflePending: boolean
  dealer: DealerState
  seats: SeatState[]
  /** index into seats during playerTurns */
  activeSeatIndex: number
  phase: Phase
  /** monotonically increasing round counter */
  round: number
  /** events of the current round (cleared at roundStart) */
  events: GameEvent[]
  /** deal-order bookkeeping used by the dealing phase */
  dealStep: number
  /** session stats for the human seat */
  stats: SessionStats
}

export interface SessionStats {
  rounds: number
  handsPlayed: number
  handsWon: number
  handsLost: number
  handsPushed: number
  blackjacks: number
  net: number
  /** how many of the human's decisions matched basic strategy */
  hintsMatched: number
  hintsTotal: number
}

// ---------------------------------------------------------------------------
// Strategy contracts (implemented in src/games/blackjack/strategy/)
// ---------------------------------------------------------------------------

/** What the current hand is allowed to do right now. */
export interface ActionContext {
  canHit: boolean
  canStand: boolean
  canDouble: boolean
  canSplit: boolean
  canSurrender: boolean
}

export const NO_ACTIONS: ActionContext = {
  canHit: false, canStand: false, canDouble: false, canSplit: false, canSurrender: false,
}

export interface StrategyAdvice {
  /** best action given what's actually allowed */
  action: Action
  /** unconstrained book action (e.g. 'double' even when doubling isn't allowed) */
  bookAction: Action
  /** e.g. "Hard 16 vs 10" */
  situation: string
  /** chart coordinates for highlighting the book cell */
  cell: { table: 'hard' | 'soft' | 'pairs'; row: string; col: string }
  /** 1-3 sentence plain-English rationale */
  explanation: string
}

/** Rendered chart data for the book modal. */
export type BookCode = 'H' | 'S' | 'D' | 'Ds' | 'P' | 'Ph' | 'Rh' | 'Rs'
// H hit · S stand · D double else hit · Ds double else stand
// P split · Ph split if DAS else hit · Rh surrender else hit · Rs surrender else stand

export interface BookTable {
  /** column headers: dealer upcards '2'..'10','A' */
  cols: string[]
  /** row labels, e.g. '16', 'A,7', '8,8' */
  rows: string[]
  /** cells[rowIdx][colIdx] */
  cells: BookCode[][]
}

export interface BookTables {
  hard: BookTable
  soft: BookTable
  pairs: BookTable
}

// ---------------------------------------------------------------------------
// Odds contracts (implemented in src/games/blackjack/odds/)
// ---------------------------------------------------------------------------

/** Probability distribution over the dealer's final result. */
export interface DealerDistribution {
  p17: number
  p18: number
  p19: number
  p20: number
  p21: number
  /** natural blackjack (0 when conditioned away by peek) */
  pBlackjack: number
  pBust: number
}

export interface ActionEV {
  action: Action
  /** expected value in units of the initial bet, e.g. -0.054 */
  ev: number
  available: boolean
}

export interface OddsReport {
  dealer: DealerDistribution
  /** P(win/push/lose) if the player stands now */
  standWin: number
  standPush: number
  standLose: number
  /** EV per action, sorted best-first, unavailable actions excluded */
  evs: ActionEV[]
  /** best available action by EV */
  best: Action
}
