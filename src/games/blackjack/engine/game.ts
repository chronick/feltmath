// Blackjack engine — a pure state machine.
//
// Every exported mutator returns a NEW GameState built by structural sharing;
// nothing here mutates its input. That makes the engine safe as a React
// `useReducer` reducer under StrictMode, which double-invokes reducers: the
// same input always produces the same output and the extra call is discarded.
//
// All randomness flows through `state.rngSeed` + src/shared/rng.ts. No
// Math.random, no Date.now.
//
// `step()` advances exactly ONE atomic *visible* step (one card, one reveal,
// one AI action, one dealer draw, one settlement) so the UI can animate each
// beat on a timer. `needsStep()` says whether another automatic step is
// pending; it is false whenever the game is waiting on the human.

import { MIN_BET, NO_ACTIONS, STARTING_BANKROLL } from '../types'
import type {
  Action,
  ActionContext,
  DealerState,
  GameEvent,
  GameState,
  HandOutcome,
  HandState,
  RulesConfig,
  SeatState,
  SessionStats,
} from '../types'
import type { Card, Composition, Rank } from '../../../shared/cards'
import { SUIT_SYMBOL, buildDecks, emptyComposition } from '../../../shared/cards'
import { shuffled } from '../../../shared/rng'
import { AI_NAMES, aiBet, aiDecide } from '../ai/aiPlayer'
import { basicStrategy } from '../strategy/basicStrategy'
import { cardValue, handLabel, handTotal, isBlackjack } from './hand'

/** Fixed default so a fresh game is reproducible (no Date.now seeding). */
const DEFAULT_SEED = 0x5eed1e55
/** Chips an AI seat buys in for when it cannot cover its next bet. */
const AI_REBUY = 1000

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function emptyStats(): SessionStats {
  return {
    rounds: 0,
    handsPlayed: 0,
    handsWon: 0,
    handsLost: 0,
    handsPushed: 0,
    blackjacks: 0,
    net: 0,
    hintsMatched: 0,
    hintsTotal: 0,
  }
}

function emptyDealer(): DealerState {
  return { cards: [], holeRevealed: false }
}

function newHand(bet: number): HandState {
  return {
    cards: [],
    bet,
    doubled: false,
    surrendered: false,
    fromSplit: false,
    fromSplitAces: false,
    finished: false,
  }
}

/**
 * Name for the AI at `seatId`, given where the human sits. Keyed on the seat's
 * ordinal among the AI seats so a full table never repeats a name.
 */
function aiName(seatId: number, humanIndex: number): string {
  const ordinal = seatId < humanIndex ? seatId : seatId - 1
  return AI_NAMES.length > 0 ? AI_NAMES[ordinal % AI_NAMES.length] : `Player ${ordinal + 1}`
}

function newSeat(
  id: number,
  kind: SeatState['kind'],
  name: string,
  bankroll: number,
  pendingBet: number,
): SeatState {
  return {
    id,
    kind,
    name,
    bankroll,
    pendingBet,
    hands: [],
    activeHandIndex: 0,
    insuranceBet: 0,
  }
}

/**
 * The human sits in the middle of the table with AI seats around them.
 * Order of play is array order, so seats to the human's left act first.
 */
function middleSeat(aiPlayers: number): number {
  return Math.floor((aiPlayers + 1) / 2)
}

function buildSeats(aiPlayers: number, humanBankroll: number, humanPendingBet: number): SeatState[] {
  const players = Math.max(0, aiPlayers)
  const middle = middleSeat(players)
  const seats: SeatState[] = []
  for (let i = 0; i < players + 1; i++) {
    seats.push(
      i === middle
        ? newSeat(i, 'human', 'You', humanBankroll, humanPendingBet)
        : newSeat(i, 'ai', aiName(i, middle), STARTING_BANKROLL, 0),
    )
  }
  return seats
}

export function newGame(rules: RulesConfig, seed?: number): GameState {
  const { items, nextSeed } = shuffled(buildDecks(rules.decks), seed ?? DEFAULT_SEED)
  return {
    rules,
    rngSeed: nextSeed,
    shoe: items,
    discard: [],
    reshufflePending: false,
    dealer: emptyDealer(),
    seats: buildSeats(rules.aiPlayers, STARTING_BANKROLL, MIN_BET),
    activeSeatIndex: 0,
    phase: 'betting',
    round: 0,
    events: [],
    dealStep: 0,
    stats: emptyStats(),
  }
}

// ---------------------------------------------------------------------------
// Structural-sharing helpers
// ---------------------------------------------------------------------------

function updateSeat(state: GameState, index: number, fn: (seat: SeatState) => SeatState): GameState {
  const seats = state.seats.slice()
  seats[index] = fn(seats[index])
  return { ...state, seats }
}

function updateHand(seat: SeatState, index: number, fn: (hand: HandState) => HandState): SeatState {
  const hands = seat.hands.slice()
  hands[index] = fn(hands[index])
  return { ...seat, hands }
}

function withEvent(
  state: GameState,
  kind: GameEvent['kind'],
  text: string,
  seatId?: number,
): GameState {
  const event: GameEvent = seatId === undefined ? { kind, text } : { kind, text, seatId }
  return { ...state, events: [...state.events, event] }
}

// ---------------------------------------------------------------------------
// Text helpers (event log)
// ---------------------------------------------------------------------------

function cardText(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`
}

/** "18" or "bust (23)" — the running score shown after a card. */
function scoreText(cards: Card[]): string {
  const { total } = handTotal(cards)
  return total > 21 ? `bust (${total})` : `${total}`
}

/** "You hit" / "Mira hits" — the human seat speaks in second person. */
function verb(seat: SeatState, base: string, thirdPerson?: string): string {
  if (seat.kind === 'human') return base
  if (thirdPerson) return thirdPerson
  return /(s|x|z|ch|sh)$/.test(base) ? `${base}es` : `${base}s`
}

function money(amount: number): string {
  const abs = Math.abs(amount)
  const body = Number.isInteger(abs) ? `${abs}` : abs.toFixed(2)
  return amount < 0 ? `-$${body}` : `$${body}`
}

function netText(net: number): string {
  if (net === 0) return 'even'
  return net > 0 ? `+${money(net)}` : `-${money(-net)}`
}

function deckText(decks: number): string {
  return `${decks} deck${decks === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function humanSeat(state: GameState): SeatState {
  const seat = state.seats.find((s) => s.kind === 'human')
  if (!seat) throw new Error('blackjack: table has no human seat')
  return seat
}

function humanSeatIndex(state: GameState): number {
  const index = state.seats.findIndex((s) => s.kind === 'human')
  return index < 0 ? 0 : index
}

export function currentSeat(state: GameState): SeatState | null {
  if (state.phase !== 'playerTurns') return null
  if (state.activeSeatIndex < 0 || state.activeSeatIndex >= state.seats.length) return null
  return state.seats[state.activeSeatIndex]
}

export function currentHand(state: GameState): HandState | null {
  const seat = currentSeat(state)
  if (!seat) return null
  if (seat.activeHandIndex < 0 || seat.activeHandIndex >= seat.hands.length) return null
  return seat.hands[seat.activeHandIndex]
}

function dealerUpRank(state: GameState): Rank {
  // During playerTurns the upcard always exists; the fallback only guards
  // against callers poking the engine in an impossible phase.
  return state.dealer.cards.length > 0 ? state.dealer.cards[0].rank : 'A'
}

function isTenValue(rank: Rank): boolean {
  return cardValue(rank) === 10
}

/** Counts of every rank the player has not seen: shoe + the hidden hole card. */
export function unseenComposition(state: GameState): Composition {
  const comp = emptyComposition()
  for (const card of state.shoe) comp[card.rank]++
  if (!state.dealer.holeRevealed && state.dealer.cards.length > 1) {
    comp[state.dealer.cards[1].rank]++
  }
  return comp
}

// ---------------------------------------------------------------------------
// Shoe
// ---------------------------------------------------------------------------

interface DrawResult {
  card: Card
  shoe: Card[]
  discard: Card[]
  rngSeed: number
  reshuffled: boolean
}

/**
 * Take the top card. If the shoe somehow runs dry mid-round (penetration
 * normally reshuffles first) the discards are shuffled back in, which keeps
 * `shoe + inPlay + discard === 52 * decks` — and keeps `unseenComposition`
 * exact.
 */
function drawFrom(state: GameState): DrawResult {
  if (state.shoe.length > 0) {
    return {
      card: state.shoe[0],
      shoe: state.shoe.slice(1),
      discard: state.discard,
      rngSeed: state.rngSeed,
      reshuffled: false,
    }
  }
  const source = state.discard.length > 0 ? state.discard : buildDecks(state.rules.decks)
  const { items, nextSeed } = shuffled(source, state.rngSeed)
  return {
    card: items[0],
    shoe: items.slice(1),
    discard: [],
    rngSeed: nextSeed,
    reshuffled: true,
  }
}

function takeCard(state: GameState): { state: GameState; card: Card } {
  const draw = drawFrom(state)
  let next: GameState = {
    ...state,
    shoe: draw.shoe,
    discard: draw.discard,
    rngSeed: draw.rngSeed,
  }
  if (draw.reshuffled) {
    next = withEvent(next, 'shuffle', 'Shoe ran out — reshuffling the discards')
  }
  return { state: next, card: draw.card }
}

function giveToHand(
  state: GameState,
  seatIndex: number,
  handIndex: number,
): { state: GameState; card: Card } {
  const drawn = takeCard(state)
  const next = updateSeat(drawn.state, seatIndex, (seat) =>
    updateHand(seat, handIndex, (hand) => ({ ...hand, cards: [...hand.cards, drawn.card] })),
  )
  return { state: next, card: drawn.card }
}

function giveToDealer(state: GameState): { state: GameState; card: Card } {
  const drawn = takeCard(state)
  const next: GameState = {
    ...drawn.state,
    dealer: { ...drawn.state.dealer, cards: [...drawn.state.dealer.cards, drawn.card] },
  }
  return { state: next, card: drawn.card }
}

function freshShoe(state: GameState): GameState {
  const { items, nextSeed } = shuffled(buildDecks(state.rules.decks), state.rngSeed)
  return { ...state, shoe: items, rngSeed: nextSeed, discard: [], reshufflePending: false }
}

/** Conservative floor so a round never starts on a shoe it could exhaust. */
function minShoeForRound(state: GameState): number {
  return state.seats.length * 4 + 8
}

// ---------------------------------------------------------------------------
// Betting phase
// ---------------------------------------------------------------------------

function rulesEqual(a: RulesConfig, b: RulesConfig): boolean {
  const keys = Object.keys(a) as (keyof RulesConfig)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

function clampHumanBet(state: GameState): GameState {
  const index = humanSeatIndex(state)
  const seat = state.seats[index]
  const clamped = Math.max(0, Math.min(seat.pendingBet, seat.bankroll))
  if (clamped === seat.pendingBet) return state
  return updateSeat(state, index, (s) => ({ ...s, pendingBet: clamped }))
}

/**
 * Swap in a new rules config. Betting phase only. A deck change rebuilds and
 * reshuffles the shoe; an AI-count change rebuilds the seats, preserving the
 * human's bankroll and pending bet (session stats live on the state, so they
 * survive untouched).
 */
export function applyRules(state: GameState, rules: RulesConfig): GameState {
  if (state.phase !== 'betting') return state
  if (rulesEqual(state.rules, rules)) return state

  let next: GameState = { ...state, rules }

  if (rules.decks !== state.rules.decks) {
    next = freshShoe(next)
    next = withEvent(next, 'shuffle', `New shoe — ${deckText(rules.decks)}`)
  }

  if (rules.aiPlayers !== state.rules.aiPlayers) {
    const human = humanSeat(state)
    next = {
      ...next,
      seats: buildSeats(rules.aiPlayers, human.bankroll, human.pendingBet),
      activeSeatIndex: 0,
    }
  }

  return clampHumanBet(next)
}

export function setBet(state: GameState, amount: number): GameState {
  if (state.phase !== 'betting' || !Number.isFinite(amount)) return state
  const index = humanSeatIndex(state)
  const seat = state.seats[index]
  const next = Math.max(0, Math.min(Math.floor(amount), seat.bankroll))
  if (next === seat.pendingBet) return state
  return updateSeat(state, index, (s) => ({ ...s, pendingBet: next }))
}

export function addChips(state: GameState, amount: number): GameState {
  if (!Number.isFinite(amount) || amount <= 0) return state
  const index = humanSeatIndex(state)
  const seat = state.seats[index]
  const next = updateSeat(state, index, (s) => ({ ...s, bankroll: s.bankroll + amount }))
  return withEvent(next, 'action', `${seat.name} ${verb(seat, 'add')} ${money(amount)} in chips`, seat.id)
}

/** Post every seat's bet and move to the deal. Requires a legal human bet. */
export function startRound(state: GameState): GameState {
  if (state.phase !== 'betting') return state
  const human = humanSeat(state)
  if (human.pendingBet < MIN_BET || human.pendingBet > human.bankroll) return state

  let next: GameState = {
    ...state,
    events: [],
    round: state.round + 1,
    dealer: emptyDealer(),
    activeSeatIndex: 0,
    dealStep: 0,
    phase: 'dealing',
  }
  next = withEvent(next, 'roundStart', `Round ${next.round}`)

  if (next.reshufflePending || next.shoe.length < minShoeForRound(next)) {
    next = freshShoe(next)
    next = withEvent(next, 'shuffle', `Shuffling ${deckText(next.rules.decks)}`)
  }

  const seats: SeatState[] = []
  const rebuys: GameEvent[] = []
  for (const seat of next.seats) {
    if (seat.kind === 'human') {
      const bet = human.pendingBet
      seats.push({
        ...seat,
        bankroll: seat.bankroll - bet,
        hands: [newHand(bet)],
        activeHandIndex: 0,
        insuranceBet: 0,
        insuranceResult: undefined,
      })
      continue
    }
    let bankroll = seat.bankroll
    const wanted = aiBet(seat.id, next.round, bankroll)
    let bet = Math.max(MIN_BET, Number.isFinite(wanted) ? Math.round(wanted) : MIN_BET)
    if (bankroll < bet) {
      bankroll += AI_REBUY
      rebuys.push({
        kind: 'action',
        seatId: seat.id,
        text: `${seat.name} ${verb(seat, 'buy')} in for ${money(AI_REBUY)}`,
      })
    }
    bet = Math.min(bet, bankroll)
    seats.push({
      ...seat,
      bankroll: bankroll - bet,
      pendingBet: bet,
      hands: [newHand(bet)],
      activeHandIndex: 0,
      insuranceBet: 0,
      insuranceResult: undefined,
    })
  }

  return { ...next, seats, events: [...next.events, ...rebuys] }
}

// ---------------------------------------------------------------------------
// Dealing phase
// ---------------------------------------------------------------------------

/**
 * Casino order: every seat gets card 1 left→right, dealer upcard, every seat
 * card 2, dealer hole card face down. One card per step.
 */
function stepDealing(state: GameState): GameState {
  const seats = state.seats.length
  const at = state.dealStep
  if (at < seats) return dealSeatCard(state, at)
  if (at === seats) return dealUpcard(state)
  if (at < 2 * seats + 1) return dealSeatCard(state, at - seats - 1)
  return dealHoleCard(state)
}

function dealSeatCard(state: GameState, seatIndex: number): GameState {
  const drawn = giveToHand(state, seatIndex, 0)
  const seat = drawn.state.seats[seatIndex]
  const next = withEvent(
    drawn.state,
    'deal',
    `${seat.name}: ${cardText(drawn.card)} — ${scoreText(seat.hands[0].cards)}`,
    seat.id,
  )
  return { ...next, dealStep: next.dealStep + 1 }
}

function dealUpcard(state: GameState): GameState {
  const drawn = giveToDealer(state)
  const next = withEvent(drawn.state, 'deal', `Dealer shows ${cardText(drawn.card)}`)
  return { ...next, dealStep: next.dealStep + 1 }
}

function dealHoleCard(state: GameState): GameState {
  const drawn = giveToDealer(state)
  const next = withEvent(drawn.state, 'deal', 'Dealer takes the hole card')
  return afterInitialDeal({ ...next, dealStep: next.dealStep + 1 })
}

function afterInitialDeal(state: GameState): GameState {
  const up = state.dealer.cards[0]
  if (up.rank === 'A' && state.rules.insurance) return { ...state, phase: 'insurance' }
  if (up.rank === 'A' || isTenValue(up.rank)) return { ...state, phase: 'peek' }
  return enterPlayerTurns(state)
}

// ---------------------------------------------------------------------------
// Insurance + peek
// ---------------------------------------------------------------------------

function mainBet(seat: SeatState): number {
  return seat.hands.length > 0 ? seat.hands[0].bet : 0
}

export function takeInsurance(state: GameState): GameState {
  if (state.phase !== 'insurance') return state
  const index = humanSeatIndex(state)
  const seat = state.seats[index]
  const wager = Math.min(mainBet(seat) / 2, seat.bankroll)
  if (wager <= 0) return declineInsurance(state)
  let next = updateSeat(state, index, (s) => ({
    ...s,
    bankroll: s.bankroll - wager,
    insuranceBet: wager,
  }))
  next = withEvent(
    next,
    'action',
    `${seat.name} ${verb(seat, 'take')} insurance — ${money(wager)}`,
    seat.id,
  )
  return { ...next, phase: 'peek' }
}

export function declineInsurance(state: GameState): GameState {
  if (state.phase !== 'insurance') return state
  const seat = humanSeat(state)
  const next = withEvent(
    state,
    'action',
    `${seat.name} ${verb(seat, 'decline')} insurance`,
    seat.id,
  )
  return { ...next, phase: 'peek' }
}

/** Flag the insurance side bet; the chips move in `settleRound`. */
function resolveInsurance(state: GameState, dealerNatural: boolean): GameState {
  let next = state
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i]
    if (seat.insuranceBet <= 0) continue
    next = updateSeat(next, i, (s) => ({ ...s, insuranceResult: dealerNatural ? 'win' : 'lose' }))
    next = withEvent(
      next,
      'insuranceResult',
      dealerNatural
        ? `Insurance pays ${money(seat.insuranceBet * 2)}`
        : `Insurance loses ${money(seat.insuranceBet)}`,
      seat.id,
    )
  }
  return next
}

function stepPeek(state: GameState): GameState {
  const up = state.dealer.cards[0]
  // Only an ace or a ten-value warrants a peek; anything else skips through.
  if (up.rank !== 'A' && !isTenValue(up.rank)) return enterPlayerTurns(state)

  if (!isBlackjack(state.dealer.cards, false)) {
    let next = withEvent(state, 'reveal', 'Dealer peeks — no blackjack')
    next = resolveInsurance(next, false)
    return enterPlayerTurns(next)
  }

  let next: GameState = { ...state, dealer: { ...state.dealer, holeRevealed: true } }
  next = withEvent(
    next,
    'reveal',
    `Dealer peeks — Blackjack! ${cardText(state.dealer.cards[1])}`,
  )
  next = resolveInsurance(next, true)
  return settleRound(next, true)
}

// ---------------------------------------------------------------------------
// Player turns
// ---------------------------------------------------------------------------

function enterPlayerTurns(state: GameState): GameState {
  return normalizeTurn({ ...state, phase: 'playerTurns', activeSeatIndex: 0 })
}

/**
 * Point (activeSeatIndex, activeHandIndex) at the next unfinished hand — pure
 * bookkeeping, never a visible step. When nothing is left to play the dealer
 * takes over. Every transition that finishes a hand runs this, so during
 * playerTurns the pointers always address a playable hand.
 */
function normalizeTurn(state: GameState): GameState {
  const seats = state.seats.slice()
  let mutated = false
  let seatIndex = state.activeSeatIndex

  while (seatIndex < seats.length) {
    const seat = seats[seatIndex]
    let handIndex = seat.activeHandIndex
    while (handIndex < seat.hands.length && seat.hands[handIndex].finished) handIndex++

    if (handIndex < seat.hands.length) {
      if (handIndex !== seat.activeHandIndex) {
        seats[seatIndex] = { ...seat, activeHandIndex: handIndex }
        mutated = true
      }
      break
    }

    // Seat is done — park the pointer on its last hand so nothing ever indexes
    // past the end of `hands`.
    const parked = Math.max(0, seat.hands.length - 1)
    if (parked !== seat.activeHandIndex) {
      seats[seatIndex] = { ...seat, activeHandIndex: parked }
      mutated = true
    }
    seatIndex++
  }

  const base = mutated ? { ...state, seats } : state
  if (seatIndex >= seats.length) {
    return enterDealerTurn({ ...base, activeSeatIndex: Math.max(0, seats.length - 1) })
  }
  return seatIndex === state.activeSeatIndex ? base : { ...base, activeSeatIndex: seatIndex }
}

function enterDealerTurn(state: GameState): GameState {
  return { ...state, phase: 'dealerTurn' }
}

/**
 * "This hand needs a real decision" — anything else auto-resolves as a visible
 * step. Derived from `actionsFor` so `needsStep()` and `availableActions()` can
 * never disagree (which would deadlock the UI: no buttons, no auto step).
 */
function awaitsDecision(state: GameState, seat: SeatState, hand: HandState): boolean {
  return countActions(actionsFor(state, seat, hand)) > 0
}

function finishHand(
  state: GameState,
  seatIndex: number,
  handIndex: number,
  outcome?: HandOutcome,
): GameState {
  return updateSeat(state, seatIndex, (seat) =>
    updateHand(seat, handIndex, (hand) =>
      outcome ? { ...hand, finished: true, outcome } : { ...hand, finished: true },
    ),
  )
}

/**
 * One automatic beat for a hand that does not need a decision: deal the second
 * card to a freshly split hand, announce a blackjack, or auto-stand.
 * Returns null when the hand is the player's to decide.
 */
function autoResolve(state: GameState, seat: SeatState, hand: HandState): GameState | null {
  if (awaitsDecision(state, seat, hand)) return null

  const seatIndex = state.activeSeatIndex
  const handIndex = seat.activeHandIndex

  if (hand.cards.length < 2) {
    const drawn = giveToHand(state, seatIndex, handIndex)
    const dealt = drawn.state.seats[seatIndex].hands[handIndex]
    return withEvent(
      drawn.state,
      'deal',
      `${seat.name}: ${cardText(drawn.card)} — ${scoreText(dealt.cards)}`,
      seat.id,
    )
  }

  if (isBlackjack(hand.cards, hand.fromSplit)) {
    const next = finishHand(state, seatIndex, handIndex)
    return normalizeTurn(
      withEvent(next, 'action', `${seat.name} ${verb(seat, 'have', 'has')} Blackjack!`, seat.id),
    )
  }

  const { total } = handTotal(hand.cards)

  if (hand.fromSplitAces && !state.rules.hitSplitAces) {
    const next = finishHand(state, seatIndex, handIndex)
    return normalizeTurn(
      withEvent(
        next,
        'action',
        `${seat.name} ${verb(seat, 'stand')} — ${total} (one card on split aces)`,
        seat.id,
      ),
    )
  }

  const busted = total > 21
  const next = finishHand(state, seatIndex, handIndex, busted ? 'bust' : undefined)
  const text = busted
    ? `${seat.name} ${verb(seat, 'bust')} — ${total}`
    : `${seat.name} ${verb(seat, 'stand')} — ${total}`
  return normalizeTurn(withEvent(next, 'action', text, seat.id))
}

function stepPlayerTurns(state: GameState): GameState {
  const normalized = normalizeTurn(state)
  if (normalized.phase !== 'playerTurns') return normalized

  const seat = normalized.seats[normalized.activeSeatIndex]
  const hand = seat.hands[seat.activeHandIndex]

  const auto = autoResolve(normalized, seat, hand)
  if (auto) return auto
  if (seat.kind === 'ai') return playAi(normalized)
  return normalized // human decision pending — needsStep() is false here
}

function playAi(state: GameState): GameState {
  const seat = state.seats[state.activeSeatIndex]
  const hand = seat.hands[seat.activeHandIndex]
  const ctx = actionsFor(state, seat, hand)
  const choice = sanitizeAction(aiDecide(hand.cards, dealerUpRank(state), state.rules, ctx), ctx)
  return applyActiveAction(state, choice)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function isAllowed(action: Action, ctx: ActionContext): boolean {
  switch (action) {
    case 'hit':
      return ctx.canHit
    case 'stand':
      return ctx.canStand
    case 'double':
      return ctx.canDouble
    case 'split':
      return ctx.canSplit
    case 'surrender':
      return ctx.canSurrender
  }
}

function countActions(ctx: ActionContext): number {
  return (
    (ctx.canHit ? 1 : 0) +
    (ctx.canStand ? 1 : 0) +
    (ctx.canDouble ? 1 : 0) +
    (ctx.canSplit ? 1 : 0) +
    (ctx.canSurrender ? 1 : 0)
  )
}

function sanitizeAction(action: Action, ctx: ActionContext): Action {
  if (isAllowed(action, ctx)) return action
  return ctx.canStand ? 'stand' : 'hit'
}

function doubleAllowed(rules: RulesConfig, total: number, soft: boolean): boolean {
  switch (rules.doubleOn) {
    case 'any2':
      return true
    case '9to11':
      return !soft && total >= 9 && total <= 11
    case '10to11':
      return !soft && total >= 10 && total <= 11
  }
}

function actionsFor(state: GameState, seat: SeatState, hand: HandState): ActionContext {
  if (hand.finished) return NO_ACTIONS
  if (hand.cards.length < 2) return NO_ACTIONS // waiting on its second split card
  if (isBlackjack(hand.cards, hand.fromSplit)) return NO_ACTIONS

  const { rules } = state
  const { total, soft } = handTotal(hand.cards)
  // 21 auto-stands and a bust is already finished — neither is a decision.
  if (total >= 21) return NO_ACTIONS

  const twoCards = hand.cards.length === 2
  const canAfford = seat.bankroll >= hand.bet

  const canSplit =
    twoCards &&
    canAfford &&
    hand.cards[0].rank === hand.cards[1].rank &&
    seat.hands.length < rules.maxSplitHands &&
    (hand.cards[0].rank !== 'A' || !hand.fromSplit || rules.resplitAces)

  // Split aces take one card each: no hit, no double, no surrender. Standing is
  // forced (so it auto-resolves) unless a re-split is on the table.
  if (hand.fromSplitAces && !rules.hitSplitAces) {
    return canSplit ? { ...NO_ACTIONS, canStand: true, canSplit: true } : NO_ACTIONS
  }

  const canDouble =
    twoCards &&
    canAfford &&
    doubleAllowed(rules, total, soft) &&
    (!hand.fromSplit || rules.doubleAfterSplit)

  const canSurrender = rules.lateSurrender && twoCards && !hand.fromSplit

  return { canHit: true, canStand: true, canDouble, canSplit, canSurrender }
}

/** What the HUMAN active hand may do right now; NO_ACTIONS when it isn't their turn. */
export function availableActions(state: GameState): ActionContext {
  const seat = currentSeat(state)
  if (!seat || seat.kind !== 'human') return NO_ACTIONS
  const hand = currentHand(state)
  if (!hand) return NO_ACTIONS
  return actionsFor(state, seat, hand)
}

function applyHit(state: GameState, seatIndex: number, handIndex: number): GameState {
  const seat = state.seats[seatIndex]
  const drawn = giveToHand(state, seatIndex, handIndex)
  const hand = drawn.state.seats[seatIndex].hands[handIndex]
  let next = withEvent(
    drawn.state,
    'action',
    `${seat.name} ${verb(seat, 'hit')}: ${cardText(drawn.card)} — ${scoreText(hand.cards)}`,
    seat.id,
  )
  if (handTotal(hand.cards).total > 21) next = finishHand(next, seatIndex, handIndex, 'bust')
  return normalizeTurn(next)
}

function applyStand(state: GameState, seatIndex: number, handIndex: number): GameState {
  const seat = state.seats[seatIndex]
  const { total } = handTotal(seat.hands[handIndex].cards)
  const next = withEvent(
    finishHand(state, seatIndex, handIndex),
    'action',
    `${seat.name} ${verb(seat, 'stand')} — ${total}`,
    seat.id,
  )
  return normalizeTurn(next)
}

function applyDouble(state: GameState, seatIndex: number, handIndex: number): GameState {
  const seat = state.seats[seatIndex]
  const extra = seat.hands[handIndex].bet

  const staked = updateSeat(state, seatIndex, (s) =>
    updateHand({ ...s, bankroll: s.bankroll - extra }, handIndex, (hand) => ({
      ...hand,
      bet: hand.bet * 2,
      doubled: true,
    })),
  )

  const drawn = giveToHand(staked, seatIndex, handIndex)
  const hand = drawn.state.seats[seatIndex].hands[handIndex]
  const busted = handTotal(hand.cards).total > 21
  let next = withEvent(
    drawn.state,
    'action',
    `${seat.name} ${verb(seat, 'double')}: ${cardText(drawn.card)} — ${scoreText(hand.cards)}`,
    seat.id,
  )
  next = finishHand(next, seatIndex, handIndex, busted ? 'bust' : undefined)
  return normalizeTurn(next)
}

function applySplit(state: GameState, seatIndex: number, handIndex: number): GameState {
  const seat = state.seats[seatIndex]
  const hand = seat.hands[handIndex]
  const first = hand.cards[0]
  const second = hand.cards[1]
  const aces = first.rank === 'A'

  const left: HandState = { ...hand, cards: [first], fromSplit: true, fromSplitAces: aces }
  const right: HandState = {
    cards: [second],
    bet: hand.bet,
    doubled: false,
    surrendered: false,
    fromSplit: true,
    fromSplitAces: aces,
    finished: false,
  }
  const hands = seat.hands.slice()
  hands.splice(handIndex, 1, left, right)

  const next = updateSeat(state, seatIndex, (s) => ({
    ...s,
    bankroll: s.bankroll - hand.bet,
    hands,
  }))
  // The active hand now holds one card — the next step deals its partner.
  return withEvent(
    next,
    'action',
    `${seat.name} ${verb(seat, 'split')} ${cardText(first)} ${cardText(second)}`,
    seat.id,
  )
}

function applySurrender(state: GameState, seatIndex: number, handIndex: number): GameState {
  const seat = state.seats[seatIndex]
  const label = handLabel(seat.hands[handIndex].cards)
  let next = updateSeat(state, seatIndex, (s) =>
    updateHand(s, handIndex, (hand) => ({
      ...hand,
      surrendered: true,
      finished: true,
      outcome: 'surrender',
    })),
  )
  next = withEvent(
    next,
    'action',
    `${seat.name} ${verb(seat, 'surrender')} — ${label}`,
    seat.id,
  )
  return normalizeTurn(next)
}

function applyActiveAction(state: GameState, action: Action): GameState {
  const seatIndex = state.activeSeatIndex
  const handIndex = state.seats[seatIndex].activeHandIndex
  switch (action) {
    case 'hit':
      return applyHit(state, seatIndex, handIndex)
    case 'stand':
      return applyStand(state, seatIndex, handIndex)
    case 'double':
      return applyDouble(state, seatIndex, handIndex)
    case 'split':
      return applySplit(state, seatIndex, handIndex)
    case 'surrender':
      return applySurrender(state, seatIndex, handIndex)
  }
}

/** Score the human's choice against the book before applying it. */
function scoreHint(
  state: GameState,
  hand: HandState,
  ctx: ActionContext,
  action: Action,
): GameState {
  if (countActions(ctx) < 2) return state // forced play, not a decision
  const advice = basicStrategy(hand.cards, dealerUpRank(state), state.rules, ctx)
  return {
    ...state,
    stats: {
      ...state.stats,
      hintsTotal: state.stats.hintsTotal + 1,
      hintsMatched: state.stats.hintsMatched + (advice.action === action ? 1 : 0),
    },
  }
}

export function doAction(state: GameState, action: Action): GameState {
  const seat = currentSeat(state)
  if (!seat || seat.kind !== 'human') return state
  const hand = currentHand(state)
  if (!hand) return state
  const ctx = actionsFor(state, seat, hand)
  if (!isAllowed(action, ctx)) return state
  return applyActiveAction(scoreHint(state, hand, ctx, action), action)
}

// ---------------------------------------------------------------------------
// Dealer turn
// ---------------------------------------------------------------------------

/** A hand the dealer still has to beat: not bust, not surrendered, not a natural. */
function isLiveHand(hand: HandState): boolean {
  return (
    !hand.surrendered &&
    handTotal(hand.cards).total <= 21 &&
    !isBlackjack(hand.cards, hand.fromSplit)
  )
}

function anyLiveHand(state: GameState): boolean {
  return state.seats.some((seat) => seat.hands.some(isLiveHand))
}

function dealerMustDraw(state: GameState): boolean {
  // Nothing left to beat — the dealer reveals the hole card but draws nothing.
  if (!anyLiveHand(state)) return false
  const { total, soft } = handTotal(state.dealer.cards)
  if (total >= 21) return false
  if (total < 17) return true
  return total === 17 && soft && state.rules.dealerHitsSoft17
}

function stepDealerTurn(state: GameState): GameState {
  if (!state.dealer.holeRevealed) {
    const revealed: GameState = { ...state, dealer: { ...state.dealer, holeRevealed: true } }
    return withEvent(
      revealed,
      'reveal',
      `Dealer reveals ${cardText(state.dealer.cards[1])} — ${scoreText(state.dealer.cards)}`,
    )
  }

  if (dealerMustDraw(state)) {
    const drawn = giveToDealer(state)
    return withEvent(
      drawn.state,
      'dealerDraw',
      `Dealer draws ${cardText(drawn.card)} — ${scoreText(drawn.state.dealer.cards)}`,
    )
  }

  const { total } = handTotal(state.dealer.cards)
  const next =
    total <= 21 && anyLiveHand(state)
      ? withEvent(state, 'dealerDraw', `Dealer stands — ${total}`)
      : state
  return settleRound(next, false)
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/**
 * Payout ledger (stakes were deducted when posted): loss/bust returns 0, push
 * returns the bet, a win returns 2×, a natural returns bet × (1 + payout),
 * surrender returns half.
 */
function resolveHand(
  hand: HandState,
  dealerTotal: number,
  dealerNatural: boolean,
  rules: RulesConfig,
): { outcome: HandOutcome; payout: number } {
  const { total } = handTotal(hand.cards)
  const natural = isBlackjack(hand.cards, hand.fromSplit)

  if (hand.surrendered) return { outcome: 'surrender', payout: hand.bet / 2 }
  if (total > 21) return { outcome: 'bust', payout: 0 }
  if (dealerNatural) {
    return natural ? { outcome: 'push', payout: hand.bet } : { outcome: 'lose', payout: 0 }
  }
  if (natural) {
    return { outcome: 'blackjack', payout: hand.bet * (1 + rules.blackjackPayout) }
  }
  if (dealerTotal > 21 || total > dealerTotal) return { outcome: 'win', payout: 2 * hand.bet }
  if (total === dealerTotal) return { outcome: 'push', payout: hand.bet }
  return { outcome: 'lose', payout: 0 }
}

function outcomeText(
  seat: SeatState,
  hand: HandState,
  outcome: HandOutcome,
  payout: number,
  dealerTotal: number,
  dealerNatural: boolean,
): string {
  const { total } = handTotal(hand.cards)
  const dealerPhrase = dealerNatural
    ? 'dealer Blackjack'
    : dealerTotal > 21
      ? `dealer busts (${dealerTotal})`
      : `dealer ${dealerTotal}`

  switch (outcome) {
    case 'blackjack':
      return `${seat.name} ${verb(seat, 'win')} ${money(payout - hand.bet)} — Blackjack!`
    case 'win':
      return `${seat.name} ${verb(seat, 'win')} ${money(hand.bet)} — ${total} vs ${dealerPhrase}`
    case 'push':
      return `${seat.name} ${verb(seat, 'push')} — ${total} vs ${dealerPhrase}`
    case 'bust':
      return `${seat.name} ${verb(seat, 'lose')} ${money(hand.bet)} — bust (${total})`
    case 'surrender':
      return `${seat.name} ${verb(seat, 'surrender')} — ${money(payout)} back`
    case 'lose':
      return `${seat.name} ${verb(seat, 'lose')} ${money(hand.bet)} — ${total} vs ${dealerPhrase}`
  }
}

interface SeatSettlement {
  seat: SeatState
  events: GameEvent[]
  outlay: number
  returned: number
}

function settleSeat(
  seat: SeatState,
  dealerTotal: number,
  dealerNatural: boolean,
  rules: RulesConfig,
): SeatSettlement {
  const events: GameEvent[] = []
  let outlay = 0
  let returned = 0

  const hands = seat.hands.map((hand): HandState => {
    const { outcome, payout } = resolveHand(hand, dealerTotal, dealerNatural, rules)
    outlay += hand.bet
    returned += payout
    events.push({
      kind: 'outcome',
      seatId: seat.id,
      text: outcomeText(seat, hand, outcome, payout, dealerTotal, dealerNatural),
    })
    return { ...hand, finished: true, outcome, payout }
  })

  if (seat.insuranceBet > 0) {
    outlay += seat.insuranceBet
    if (seat.insuranceResult === 'win') returned += seat.insuranceBet * 3
  }

  return {
    seat: { ...seat, hands, bankroll: seat.bankroll + returned },
    events,
    outlay,
    returned,
  }
}

function accumulateStats(
  stats: SessionStats,
  result: SeatSettlement,
  net: number,
): SessionStats {
  let { handsPlayed, handsWon, handsLost, handsPushed, blackjacks } = stats

  for (const hand of result.seat.hands) {
    handsPlayed++
    // Counts naturals dealt, so one that pushes a dealer natural still shows up.
    if (isBlackjack(hand.cards, hand.fromSplit)) blackjacks++
    switch (hand.outcome) {
      case 'win':
      case 'blackjack':
        handsWon++
        break
      case 'push':
        handsPushed++
        break
      default:
        // lose / bust / surrender — surrender is a half-loss, counted as a loss
        // so won + lost + pushed always equals handsPlayed.
        handsLost++
        break
    }
  }

  return {
    ...stats,
    rounds: stats.rounds + 1,
    handsPlayed,
    handsWon,
    handsLost,
    handsPushed,
    blackjacks,
    net: stats.net + net,
  }
}

function cardsOnTable(state: GameState): number {
  const inHands = state.seats.reduce(
    (seatTotal, seat) => seatTotal + seat.hands.reduce((n, hand) => n + hand.cards.length, 0),
    0,
  )
  return inHands + state.dealer.cards.length
}

/** One atomic step: score every hand, move the chips, arm the reshuffle. */
function settleRound(state: GameState, dealerNatural: boolean): GameState {
  const dealerTotal = handTotal(state.dealer.cards).total
  const results = state.seats.map((seat) =>
    settleSeat(seat, dealerTotal, dealerNatural, state.rules),
  )
  const seats = results.map((r) => r.seat)
  const outcomes = results.flatMap((r) => r.events)

  const human = results.find((r) => r.seat.kind === 'human')
  const net = human ? human.returned - human.outlay : 0
  const stats = human ? accumulateStats(state.stats, human, net) : state.stats

  const settled: GameState = { ...state, seats }
  const seen = state.discard.length + cardsOnTable(settled)
  const shoeSize = 52 * state.rules.decks

  let next: GameState = {
    ...settled,
    stats,
    dealer: { ...state.dealer, holeRevealed: true },
    events: [...state.events, ...outcomes],
    reshufflePending: state.reshufflePending || seen / shoeSize > state.rules.penetration,
    phase: 'settlement',
  }
  next = withEvent(next, 'roundEnd', `Round ${state.round} — ${netText(net)}`)
  return next
}

/** Settlement → betting: cards to the discard tray, hands cleared, bet re-clamped. */
export function nextRound(state: GameState): GameState {
  if (state.phase !== 'settlement') return state

  const collected: Card[] = []
  for (const seat of state.seats) {
    for (const hand of seat.hands) collected.push(...hand.cards)
  }
  collected.push(...state.dealer.cards)

  const seats = state.seats.map((seat): SeatState => ({
    ...seat,
    hands: [],
    activeHandIndex: 0,
    insuranceBet: 0,
    insuranceResult: undefined,
    pendingBet: Math.max(0, Math.min(seat.pendingBet, seat.bankroll)),
  }))

  return {
    ...state,
    seats,
    discard: [...state.discard, ...collected],
    dealer: emptyDealer(),
    activeSeatIndex: 0,
    dealStep: 0,
    phase: 'betting',
  }
}

// ---------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------

/** True when an automatic step is pending; false whenever the human is on. */
export function needsStep(state: GameState): boolean {
  switch (state.phase) {
    case 'betting':
    case 'insurance':
    case 'settlement':
      return false
    case 'dealing':
    case 'peek':
    case 'dealerTurn':
      return true
    case 'playerTurns':
      return countActions(availableActions(state)) === 0
  }
}

/** Advance exactly one visible step. A no-op while waiting on the human. */
export function step(state: GameState): GameState {
  switch (state.phase) {
    case 'dealing':
      return stepDealing(state)
    case 'peek':
      return stepPeek(state)
    case 'playerTurns':
      return stepPlayerTurns(state)
    case 'dealerTurn':
      return stepDealerTurn(state)
    case 'betting':
    case 'insurance':
    case 'settlement':
      return state
  }
}
