// No-Limit Texas hold'em engine — a pure state machine.
//
// Same discipline as the blackjack engine: every exported mutator returns a NEW
// HoldemState built by structural sharing, nothing here mutates its input, and
// all randomness flows through `rngSeed` + src/shared/rng.ts. No Math.random, no
// Date.now. That makes the engine safe as a React `useReducer` reducer under
// StrictMode, which double-invokes reducers: same input, same output, and the
// extra call is discarded.
//
// `holdemStep()` advances exactly ONE atomic *visible* step — the blinds, one
// hole card, one AI action, one street, one showdown reveal, one settlement — so
// the UI can animate each beat on a timer. `needsHoldemStep()` is false exactly
// when the table is waiting on the human, or the hand is over.
//
// Two invariants the whole file leans on:
//   * `seats[i].id === i` — seats are built once per table size and never
//     reordered, so ids and indexes are interchangeable (`seatIndexOf` still
//     goes through a lookup so a future reshuffle can't silently corrupt play).
//   * Seat array order IS table order clockwise. The human keeps seat 0 for the
//     life of the table; position comes from where the BUTTON sits, so rotating
//     the button walks the human through every seat's position.

import { NO_POKER_ACTIONS } from '../types'
import type {
  HoldemConfig,
  HoldemEvent,
  HoldemSeatState,
  HoldemState,
  HoldemStats,
  PokerAction,
  PokerActionContext,
  Pot,
  Street,
} from '../types'
import type { Card } from '../../../shared/cards'
import { SUIT_SYMBOL, buildDecks } from '../../../shared/cards'
import { shuffled } from '../../../shared/rng'
import { HOLDEM_AI_NAMES, aiPokerDecide } from '../ai/aiPlayer'
import { compareHands, evaluate } from './evaluate'

/** Fixed default so a fresh table is reproducible (no Date.now seeding). */
const DEFAULT_SEED = 0x5eed5ace

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function emptyStats(): HoldemStats {
  return {
    hands: 0,
    handsWon: 0,
    net: 0,
    vpipHands: 0,
    showdowns: 0,
    showdownsWon: 0,
  }
}

function newSeat(
  id: number,
  kind: HoldemSeatState['kind'],
  name: string,
  stack: number,
): HoldemSeatState {
  return {
    id,
    kind,
    name,
    stack,
    hole: [],
    streetCommit: 0,
    totalCommit: 0,
    folded: false,
    allIn: false,
    out: false,
    revealed: false,
    won: 0,
  }
}

/** Names are keyed on seat id so a given chair always has the same regular. */
function aiName(id: number): string {
  const ordinal = id - 1
  return HOLDEM_AI_NAMES.length > 0
    ? HOLDEM_AI_NAMES[ordinal % HOLDEM_AI_NAMES.length]
    : `Player ${ordinal + 1}`
}

function buildSeats(config: HoldemConfig, humanStack?: number): HoldemSeatState[] {
  const opponents = Math.max(1, Math.min(5, Math.floor(config.aiPlayers)))
  const seats: HoldemSeatState[] = [
    newSeat(0, 'human', 'You', humanStack ?? config.buyIn),
  ]
  for (let id = 1; id <= opponents; id++) {
    seats.push(newSeat(id, 'ai', aiName(id), config.buyIn))
  }
  return seats
}

export function newHoldemGame(config: HoldemConfig, seed?: number): HoldemState {
  return {
    config,
    rngSeed: seed ?? DEFAULT_SEED,
    deck: [],
    board: [],
    seats: buildSeats(config),
    button: 0,
    actingIndex: 0,
    phase: 'idle',
    street: 'preflop',
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    pendingToAct: [],
    raiseBarred: [],
    dealStep: 0,
    revealStep: 0,
    pots: [],
    handNumber: 0,
    events: [],
    stats: emptyStats(),
  }
}

function configEqual(a: HoldemConfig, b: HoldemConfig): boolean {
  const keys = Object.keys(a) as (keyof HoldemConfig)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

/**
 * Swap in a new config between hands. Changing the opponent count rebuilds the
 * table (the human's stack rides along; session stats live on the state and are
 * untouched); everything else takes effect on the next hand.
 */
export function applyConfig(state: HoldemState, config: HoldemConfig): HoldemState {
  if (state.phase !== 'idle' && state.phase !== 'settlement') return state
  if (configEqual(state.config, config)) return state

  const next: HoldemState = { ...state, config }
  if (config.aiPlayers === state.config.aiPlayers) return next

  const human = humanHoldemSeat(state)
  return {
    ...next,
    seats: buildSeats(config, human.stack),
    button: 0,
    actingIndex: 0,
    pendingToAct: [],
    pots: [],
    board: [],
  }
}

// ---------------------------------------------------------------------------
// Structural-sharing helpers
// ---------------------------------------------------------------------------

function updateSeat(
  state: HoldemState,
  index: number,
  fn: (seat: HoldemSeatState) => HoldemSeatState,
): HoldemState {
  const seats = state.seats.slice()
  seats[index] = fn(seats[index])
  return { ...state, seats }
}

function withEvent(
  state: HoldemState,
  kind: HoldemEvent['kind'],
  text: string,
  seatId?: number,
): HoldemState {
  const event: HoldemEvent = seatId === undefined ? { kind, text } : { kind, text, seatId }
  return { ...state, events: [...state.events, event] }
}

// ---------------------------------------------------------------------------
// Text helpers (event log — concise casino-dealer voice, human in 2nd person)
// ---------------------------------------------------------------------------

function cardText(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`
}

function handText(cards: Card[]): string {
  return cards.map(cardText).join(' ')
}

/** "You fold" / "Rocket Ron folds" — the human seat speaks in second person. */
function verb(seat: HoldemSeatState, base: string, thirdPerson?: string): string {
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

/** HandRank labels are sentence-cased; inline they read better lowercased. */
function lower(label: string): string {
  return label.length > 0 ? label.charAt(0).toLowerCase() + label.slice(1) : label
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function humanHoldemSeat(state: HoldemState): HoldemSeatState {
  const seat = state.seats.find((s) => s.kind === 'human')
  if (!seat) throw new Error("hold'em: table has no human seat")
  return seat
}

function humanIndex(state: HoldemState): number {
  return state.seats.findIndex((s) => s.kind === 'human')
}

/** Every chip committed this hand, this street included. */
export function potTotal(state: HoldemState): number {
  return state.seats.reduce((sum, seat) => sum + seat.totalCommit, 0)
}

function seatIndexOf(state: HoldemState, id: number): number {
  const direct = state.seats[id]
  if (direct && direct.id === id) return id
  return state.seats.findIndex((s) => s.id === id)
}

/** Dealt in and not folded — a seat that can still win chips. */
function isLive(seat: HoldemSeatState): boolean {
  return !seat.folded && !seat.out
}

/** Live and with chips behind — a seat that can still be asked for a decision. */
function canAct(seat: HoldemSeatState): boolean {
  return isLive(seat) && !seat.allIn && seat.stack > 0
}

function liveIndexes(state: HoldemState): number[] {
  const out: number[] = []
  for (let i = 0; i < state.seats.length; i++) if (isLive(state.seats[i])) out.push(i)
  return out
}

// ---------------------------------------------------------------------------
// Table order
// ---------------------------------------------------------------------------

/** Seat indexes clockwise for one lap, starting at `from` (wrapped). */
function orderFrom(state: HoldemState, from: number): number[] {
  const n = state.seats.length
  const start = ((from % n) + n) % n
  const out: number[] = []
  for (let k = 0; k < n; k++) out.push((start + k) % n)
  return out
}

/** Seats dealt into this hand, clockwise from the button. */
function dealtInFromButton(state: HoldemState): number[] {
  return orderFrom(state, state.button).filter((i) => !state.seats[i].out)
}

/**
 * Blind seats for the hand. Multiway the blinds are the two seats after the
 * button; HEADS-UP THE BUTTON IS THE SMALL BLIND (and so acts first preflop,
 * second postflop). Derived from `out`, which never changes mid-hand, so this
 * stays stable as seats fold.
 */
function blindIndexes(state: HoldemState): { sb: number; bb: number } | null {
  const dealt = dealtInFromButton(state)
  if (dealt.length < 2) return null
  if (dealt.length === 2) return { sb: dealt[0], bb: dealt[1] }
  return { sb: dealt[1], bb: dealt[2] }
}

/** What `index` put up as a forced blind this hand (0 for everyone else). */
function postedBlind(state: HoldemState, index: number): number {
  const blinds = blindIndexes(state)
  if (!blinds) return 0
  if (index === blinds.sb) return state.config.smallBlind
  if (index === blinds.bb) return state.config.bigBlind
  return 0
}

/**
 * Action order for a street. Preflop starts left of the big blind (which, heads
 * up, wraps back onto the button); postflop always starts left of the button.
 */
function streetOrder(state: HoldemState, street: Street): number[] {
  if (street === 'preflop') {
    const blinds = blindIndexes(state)
    const from = blinds ? blinds.bb + 1 : state.button + 1
    return orderFrom(state, from).filter((i) => !state.seats[i].out)
  }
  return orderFrom(state, state.button + 1).filter((i) => !state.seats[i].out)
}

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

/**
 * Take the top card. One 52-card deck covers six seats plus the board twice
 * over, so the reshuffle branch only guards against the engine being poked in
 * an impossible state — it never fires in a real hand.
 */
function takeCard(state: HoldemState): { state: HoldemState; card: Card } {
  if (state.deck.length > 0) {
    return { state: { ...state, deck: state.deck.slice(1) }, card: state.deck[0] }
  }
  const { items, nextSeed } = shuffled(buildDecks(1), state.rngSeed)
  return { state: { ...state, deck: items.slice(1), rngSeed: nextSeed }, card: items[0] }
}

// ---------------------------------------------------------------------------
// Starting a hand
// ---------------------------------------------------------------------------

/** Wipe the per-hand fields; stack / out are decided by the caller. */
function freshSeat(seat: HoldemSeatState, stack: number, out: boolean): HoldemSeatState {
  return {
    ...seat,
    stack,
    hole: [],
    streetCommit: 0,
    totalCommit: 0,
    // A seat sitting out is treated as folded everywhere a hand is scored, so a
    // `folded`-only check can never hand it chips.
    folded: out,
    allIn: false,
    out,
    revealed: false,
    handRank: undefined,
    won: 0,
  }
}

/**
 * idle|settlement → 'posting'. Tops up / rebuys per `config.topUp`, benches
 * seats that are broke without a top-up, rotates the button (never on the first
 * hand) to the next seat that is playing, and cuts a fresh shuffled deck.
 *
 * No-ops when fewer than two seats can play — the UI ships with topUp on, so
 * that only happens if someone deliberately plays a table dry.
 */
export function startHand(state: HoldemState): HoldemState {
  if (state.phase !== 'idle' && state.phase !== 'settlement') return state

  const { buyIn, topUp } = state.config
  const chipEvents: HoldemEvent[] = []

  const seats = state.seats.map((seat): HoldemSeatState => {
    if (topUp && seat.stack < buyIn) {
      chipEvents.push({
        kind: 'hand',
        seatId: seat.id,
        text:
          seat.stack <= 0
            ? `${seat.name} ${verb(seat, 'rebuy', 'rebuys')} for ${money(buyIn)}`
            : `${seat.name} ${verb(seat, 'top', 'tops')} up to ${money(buyIn)}`,
      })
      return freshSeat(seat, buyIn, false)
    }
    if (seat.stack <= 0) {
      if (!seat.out) {
        chipEvents.push({
          kind: 'hand',
          seatId: seat.id,
          text: `${seat.name} ${verb(seat, 'sit', 'sits')} out — out of chips`,
        })
      }
      return freshSeat(seat, 0, true)
    }
    return freshSeat(seat, seat.stack, false)
  })

  if (seats.filter((seat) => !seat.out).length < 2) return state

  // Rotate first, then land on the next seat that is actually playing.
  const n = seats.length
  const offset = state.handNumber > 0 ? 1 : 0
  let button = state.button
  for (let k = 0; k < n; k++) {
    const candidate = (state.button + offset + k) % n
    if (!seats[candidate].out) {
      button = candidate
      break
    }
  }

  const { items, nextSeed } = shuffled(buildDecks(1), state.rngSeed)
  const handNumber = state.handNumber + 1

  let next: HoldemState = {
    ...state,
    deck: items,
    rngSeed: nextSeed,
    board: [],
    seats,
    button,
    actingIndex: button,
    phase: 'posting',
    street: 'preflop',
    currentBet: 0,
    lastRaiseSize: state.config.bigBlind,
    pendingToAct: [],
    raiseBarred: [],
    dealStep: 0,
    revealStep: 0,
    pots: [],
    handNumber,
    events: [],
  }

  next = withEvent(next, 'hand', `Hand ${handNumber}`)
  next = { ...next, events: [...next.events, ...chipEvents] }

  const dealer = seats[button]
  next = withEvent(
    next,
    'hand',
    offset > 0
      ? `Button moves to ${dealer.name}`
      : `${dealer.name} ${verb(dealer, 'have', 'has')} the button`,
    dealer.id,
  )
  return next
}

// ---------------------------------------------------------------------------
// Posting the blinds (one step)
// ---------------------------------------------------------------------------

function postBlind(
  state: HoldemState,
  index: number,
  amount: number,
  which: 'small' | 'big',
): HoldemState {
  const seat = state.seats[index]
  const posted = Math.min(amount, seat.stack)
  if (posted <= 0) return state

  const next = updateSeat(state, index, (s) => ({
    ...s,
    stack: s.stack - posted,
    streetCommit: s.streetCommit + posted,
    totalCommit: s.totalCommit + posted,
    allIn: s.stack - posted <= 0,
  }))
  const tail = next.seats[index].allIn ? ' — all in' : ''
  return withEvent(
    next,
    'blind',
    `${seat.name} ${verb(seat, 'post')} the ${which} blind ${money(posted)}${tail}`,
    seat.id,
  )
}

function stepPosting(state: HoldemState): HoldemState {
  const blinds = blindIndexes(state)
  if (!blinds) return { ...state, phase: 'dealing', dealStep: 0 }

  let next = postBlind(state, blinds.sb, state.config.smallBlind, 'small')
  next = postBlind(next, blinds.bb, state.config.bigBlind, 'big')

  // A short all-in big blind does not discount the preflop bring-in: callers
  // still owe a full big blind and the first minimum raise is to two big blinds.
  // The short blind's actual commit remains smaller, so normal side-pot layering
  // still gives it action only on the chips it could cover.
  const postedHigh = next.seats.reduce((high, seat) => Math.max(high, seat.streetCommit), 0)
  const currentBet = Math.max(state.config.bigBlind, postedHigh)
  return {
    ...next,
    currentBet,
    lastRaiseSize: state.config.bigBlind,
    phase: 'dealing',
    dealStep: 0,
  }
}

// ---------------------------------------------------------------------------
// Dealing hole cards (one card per step, two passes)
// ---------------------------------------------------------------------------

/** Cards go left of the button first, exactly like a live deal. */
function dealOrder(state: HoldemState): number[] {
  return orderFrom(state, state.button + 1).filter((i) => !state.seats[i].out)
}

function stepDealing(state: HoldemState): HoldemState {
  const order = dealOrder(state)
  if (order.length === 0) return { ...state, phase: 'settlement' }

  const index = order[state.dealStep % order.length]
  const drawn = takeCard(state)
  let next = updateSeat(drawn.state, index, (s) => ({ ...s, hole: [...s.hole, drawn.card] }))
  next = { ...next, dealStep: next.dealStep + 1 }

  // Only the human's cards are face up, so only they belong in the log.
  const seat = next.seats[index]
  if (seat.kind === 'human' && seat.hole.length === 2) {
    next = withEvent(next, 'deal', `You are dealt ${handText(seat.hole)}`, seat.id)
  }

  if (next.dealStep >= order.length * 2) return enterBetting(next, 'preflop')
  return next
}

// ---------------------------------------------------------------------------
// Betting
// ---------------------------------------------------------------------------

/**
 * Open a betting round. Postflop this wipes the street commits and resets the
 * min-bet basis to one big blind; preflop it inherits the blinds. Rounds that
 * cannot happen (nobody left with chips, or one lone caller who owes nothing)
 * close immediately instead of billing the UI for a pointless check.
 */
function enterBetting(state: HoldemState, street: Street): HoldemState {
  const base: HoldemState =
    street === 'preflop'
      ? { ...state, street, raiseBarred: [] }
      : {
          ...state,
          street,
          seats: state.seats.map((seat) =>
            seat.streetCommit === 0 ? seat : { ...seat, streetCommit: 0 },
          ),
          currentBet: 0,
          lastRaiseSize: state.config.bigBlind,
          raiseBarred: [],
        }

  const actors = streetOrder(base, street).filter((i) => canAct(base.seats[i]))
  const owed = actors.some((i) => base.seats[i].streetCommit < base.currentBet)
  const pending = actors.length <= 1 && !owed ? [] : actors.map((i) => base.seats[i].id)

  return advanceBetting({ ...base, phase: 'betting', pendingToAct: pending })
}

/** Point at the next seat owed a turn, or close the round. */
function advanceBetting(state: HoldemState): HoldemState {
  const pending = state.pendingToAct.filter((id) => {
    const index = seatIndexOf(state, id)
    return index >= 0 && canAct(state.seats[index])
  })
  const next =
    pending.length === state.pendingToAct.length ? state : { ...state, pendingToAct: pending }

  if (liveIndexes(next).length <= 1 || pending.length === 0) return closeBetting(next)
  return { ...next, phase: 'betting', actingIndex: seatIndexOf(next, pending[0]) }
}

/**
 * Betting is over. Give back any uncalled excess, then: one seat left → award
 * without a reveal; at most one seat still has chips → run the board out;
 * river → showdown; otherwise deal the next street.
 */
function closeBetting(state: HoldemState): HoldemState {
  const settled = { ...refundUncalled(state), pendingToAct: [] }

  const live = liveIndexes(settled)
  if (live.length <= 1) return stepSettlement(settled)

  const withChips = live.filter((i) => canAct(settled.seats[i]))
  if (withChips.length <= 1) {
    return settled.board.length >= 5
      ? enterShowdown(settled)
      : { ...settled, phase: 'streetDeal' }
  }

  if (settled.street === 'river') return enterShowdown(settled)
  return { ...settled, phase: 'streetDeal' }
}

/**
 * The top committer's chips above the second-highest commit were never called,
 * so they come straight back — before any pot layering, or the layers would
 * hand a player their own uncalled bet. Chips back behind the line means the
 * seat is no longer all-in (this is how an incomplete all-in raise nobody could
 * call resolves).
 */
function refundUncalled(state: HoldemState): HoldemState {
  let top = -1
  for (let i = 0; i < state.seats.length; i++) {
    if (top < 0 || state.seats[i].totalCommit > state.seats[top].totalCommit) top = i
  }
  if (top < 0) return state

  let second = 0
  for (let i = 0; i < state.seats.length; i++) {
    if (i !== top) second = Math.max(second, state.seats[i].totalCommit)
  }

  const excess = state.seats[top].totalCommit - second
  if (excess <= 0) return state

  const seat = state.seats[top]
  const next = updateSeat(state, top, (s) => ({
    ...s,
    stack: s.stack + excess,
    streetCommit: Math.max(0, s.streetCommit - excess),
    totalCommit: s.totalCommit - excess,
    allIn: false,
  }))
  return withEvent(
    next,
    'award',
    `${seat.name} ${verb(seat, 'take', 'takes')} back ${money(excess)} (uncalled)`,
    seat.id,
  )
}

// ---------------------------------------------------------------------------
// Action legality
// ---------------------------------------------------------------------------

function actionsForSeat(state: HoldemState, index: number): PokerActionContext {
  if (state.phase !== 'betting') return NO_POKER_ACTIONS
  if (index < 0 || index >= state.seats.length) return NO_POKER_ACTIONS

  const seat = state.seats[index]
  if (!canAct(seat)) return NO_POKER_ACTIONS

  const toCall = Math.max(0, state.currentBet - seat.streetCommit)
  const maxTo = seat.streetCommit + seat.stack
  // One formula covers both: postflop currentBet is 0 and lastRaiseSize is the
  // big blind, so the minimum opening bet falls out of the min-raise rule.
  const minTo = Math.min(state.currentBet + state.lastRaiseSize, maxTo)

  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, seat.stack),
    canBet: state.currentBet === 0,
    canRaise:
      state.currentBet > 0 && maxTo > state.currentBet && !state.raiseBarred.includes(seat.id),
    minTo,
    maxTo,
    potSize: potTotal(state),
  }
}

function hasPokerActions(ctx: PokerActionContext): boolean {
  return ctx.canFold || ctx.canCheck || ctx.canCall || ctx.canBet || ctx.canRaise
}

/** What the HUMAN may do right now; NO_POKER_ACTIONS whenever it isn't their turn. */
export function pokerActionsFor(state: HoldemState): PokerActionContext {
  if (state.phase !== 'betting') return NO_POKER_ACTIONS
  const seat = state.seats[state.actingIndex]
  if (!seat || seat.kind !== 'human') return NO_POKER_ACTIONS
  return actionsForSeat(state, state.actingIndex)
}

/**
 * Validate an action against the context, returning the concrete act to apply
 * or null when it is illegal. 'bet' and 'raise' are the same move wearing
 * different labels — whichever the situation calls for is used, so a caller
 * that guesses wrong still gets the wager it asked for at the price it named.
 */
function normalizeAction(action: PokerAction, ctx: PokerActionContext): PokerAction | null {
  switch (action.type) {
    case 'fold':
      return ctx.canFold ? { type: 'fold' } : null
    case 'check':
      return ctx.canCheck ? { type: 'check' } : null
    case 'call':
      return ctx.canCall ? { type: 'call' } : null
    case 'allin':
      return ctx.canBet || ctx.canRaise || ctx.canCall ? { type: 'allin' } : null
    case 'bet':
    case 'raise': {
      if (!ctx.canBet && !ctx.canRaise) return null
      const to = Math.floor(action.to ?? 0)
      if (!Number.isFinite(to)) return null
      if (to < ctx.minTo || to > ctx.maxTo) return null
      return { type: ctx.canBet ? 'bet' : 'raise', to }
    }
  }
}

/** An AI that hands back something illegal checks if it can, folds if it can't. */
function sanitizeAiAction(action: PokerAction, ctx: PokerActionContext): PokerAction {
  const legal = normalizeAction(action, ctx)
  if (legal) return legal
  return ctx.canCheck ? { type: 'check' } : { type: 'fold' }
}

// ---------------------------------------------------------------------------
// Applying an action (one path for human and AI alike)
// ---------------------------------------------------------------------------

function commit(state: HoldemState, index: number, amount: number): HoldemState {
  if (amount <= 0) return state
  return updateSeat(state, index, (s) => ({
    ...s,
    stack: s.stack - amount,
    streetCommit: s.streetCommit + amount,
    totalCommit: s.totalCommit + amount,
    allIn: s.stack - amount <= 0,
  }))
}

/**
 * VPIP counts hands where the human chose to put chips in preflop. Blinds are
 * forced, so the test is "were they still sitting on exactly their blind before
 * this act" — a big blind checking never qualifies, a small blind completing
 * does, and a second voluntary act in the same hand cannot double-count.
 */
function noteVpip(
  state: HoldemState,
  index: number,
  committedBefore: number,
  amount: number,
): HoldemState {
  if (state.street !== 'preflop' || amount <= 0) return state
  if (state.seats[index].kind !== 'human') return state
  if (committedBefore > postedBlind(state, index)) return state
  return { ...state, stats: { ...state.stats, vpipHands: state.stats.vpipHands + 1 } }
}

/**
 * Roll the turn on.
 * - 'full'       — a full bet/raise: every other live seat with chips gets a
 *                  fresh turn (in order after the aggressor) and the raise bar
 *                  lifts.
 * - 'incomplete' — an all-in under-raise: seats that owe chips still get a
 *                  CALL decision, but anyone who had already acted this street
 *                  is barred from re-raising until the cumulative amount they
 *                  face reaches a full raise (standard NLHE rule).
 * - 'none'       — fold/check/call: the actor just pops off the queue.
 */
type ActionReopen = 'none' | 'full' | 'incomplete'

function afterAction(state: HoldemState, index: number, mode: ActionReopen): HoldemState {
  const actorId = state.seats[index].id

  if (mode === 'full') {
    const pending = orderFrom(state, index + 1)
      .filter((i) => i !== index && canAct(state.seats[i]))
      .map((i) => state.seats[i].id)
    return advanceBetting({ ...state, pendingToAct: pending, raiseBarred: [] })
  }

  if (mode === 'incomplete') {
    // Who had already completed their turn at the old bet level? Everyone
    // actionable who was no longer queued. They may call the short raise but
    // not use it to re-open their own raising.
    const wasPending = new Set(state.pendingToAct)
    const barred = new Set(state.raiseBarred)
    for (let i = 0; i < state.seats.length; i++) {
      const seat = state.seats[i]
      if (i === index || !canAct(seat)) continue
      if (!wasPending.has(seat.id)) barred.add(seat.id)
      // Multiple short all-ins can add up to a full raise. Reopen action seat by
      // seat: what matters is how much THIS player now faces above the amount
      // they already committed on their last action, not whether the latest
      // individual all-in was itself a full raise.
      if (barred.has(seat.id) && state.currentBet - seat.streetCommit >= state.lastRaiseSize) {
        barred.delete(seat.id)
      }
    }
    const pending = orderFrom(state, index + 1)
      .filter((i) => i !== index && canAct(state.seats[i]) &&
        state.seats[i].streetCommit < state.currentBet)
      .map((i) => state.seats[i].id)
    return advanceBetting({ ...state, pendingToAct: pending, raiseBarred: [...barred] })
  }

  const pending = state.pendingToAct.filter((id) => id !== actorId)
  return advanceBetting({ ...state, pendingToAct: pending })
}

function applyFold(state: HoldemState, index: number): HoldemState {
  const seat = state.seats[index]
  const next = withEvent(
    updateSeat(state, index, (s) => ({ ...s, folded: true })),
    'action',
    `${seat.name} ${verb(seat, 'fold')}`,
    seat.id,
  )
  return afterAction(next, index, 'none')
}

function applyCheck(state: HoldemState, index: number): HoldemState {
  const seat = state.seats[index]
  const next = withEvent(state, 'action', `${seat.name} ${verb(seat, 'check')}`, seat.id)
  return afterAction(next, index, 'none')
}

function applyCall(state: HoldemState, index: number): HoldemState {
  const seat = state.seats[index]
  const before = seat.streetCommit
  // A short stack calls for whatever it has; the excess comes back to the
  // bettor when the street closes.
  const amount = Math.min(Math.max(0, state.currentBet - seat.streetCommit), seat.stack)

  let next = commit(state, index, amount)
  const tail = next.seats[index].allIn ? ' — all in' : ''
  next = withEvent(
    next,
    'action',
    `${seat.name} ${verb(seat, 'call')} ${money(amount)}${tail}`,
    seat.id,
  )
  next = noteVpip(next, index, before, amount)
  return afterAction(next, index, 'none')
}

/**
 * A bet or a raise to `to` (a TOTAL for this street). A raise whose increment
 * reaches `lastRaiseSize` is full: it becomes the new min-raise basis and
 * re-opens the action for everyone. An incomplete all-in raise (the only way
 * to under-raise) moves `currentBet` up and leaves `lastRaiseSize` alone;
 * seats that owe chips still get a call/fold decision, but anyone who had
 * already acted is barred from re-raising (`raiseBarred`). Chips that end up
 * uncalled anyway are handed back by `refundUncalled` at street close.
 */
function applyWager(state: HoldemState, index: number, to: number): HoldemState {
  const seat = state.seats[index]
  const maxTo = seat.streetCommit + seat.stack
  const target = Math.min(Math.max(to, seat.streetCommit), maxTo)
  const amount = target - seat.streetCommit
  if (amount <= 0) {
    // Not actually a wager (only reachable if a caller skips validation) —
    // resolve it as the passive act the seat is facing.
    return state.currentBet > seat.streetCommit
      ? applyCall(state, index)
      : applyCheck(state, index)
  }

  const previousBet = state.currentBet
  const increment = target - previousBet
  const full = increment >= state.lastRaiseSize

  let next = commit(state, index, amount)
  next = {
    ...next,
    currentBet: Math.max(previousBet, target),
    lastRaiseSize: full ? increment : state.lastRaiseSize,
  }

  const tail = next.seats[index].allIn ? ' — all in' : ''
  next = withEvent(
    next,
    'action',
    previousBet > 0
      ? `${seat.name} ${verb(seat, 'raise')} to ${money(target)}${tail}`
      : `${seat.name} ${verb(seat, 'bet')} ${money(target)}${tail}`,
    seat.id,
  )
  next = noteVpip(next, index, seat.streetCommit, amount)
  return afterAction(next, index, full ? 'full' : 'incomplete')
}

function applyAllIn(state: HoldemState, index: number): HoldemState {
  const seat = state.seats[index]
  const target = seat.streetCommit + seat.stack
  // Shoving for less than the bet is just a call for everything; a seat barred
  // from raising can put in at most the call, so its "all-in" clamps to one.
  if (target <= state.currentBet) return applyCall(state, index)
  if (state.raiseBarred.includes(seat.id)) return applyCall(state, index)
  return applyWager(state, index, target)
}

function applyAction(state: HoldemState, index: number, action: PokerAction): HoldemState {
  switch (action.type) {
    case 'fold':
      return applyFold(state, index)
    case 'check':
      return applyCheck(state, index)
    case 'call':
      return applyCall(state, index)
    case 'bet':
    case 'raise':
      return applyWager(state, index, action.to ?? 0)
    case 'allin':
      return applyAllIn(state, index)
  }
}

/** The human's move. Anything the context disallows is rejected untouched. */
export function doPokerAction(state: HoldemState, action: PokerAction): HoldemState {
  const ctx = pokerActionsFor(state)
  if (!hasPokerActions(ctx)) return state
  const legal = normalizeAction(action, ctx)
  if (!legal) return state
  return applyAction(state, state.actingIndex, legal)
}

function stepBetting(state: HoldemState): HoldemState {
  const seat = state.seats[state.actingIndex]
  if (!seat) return advanceBetting(state)

  const ctx = actionsForSeat(state, state.actingIndex)
  if (!hasPokerActions(ctx)) return advanceBetting(state)
  if (seat.kind === 'human') return state // needsHoldemStep() is false here

  const action = sanitizeAiAction(aiPokerDecide(state, state.actingIndex), ctx)
  return applyAction(state, state.actingIndex, action)
}

// ---------------------------------------------------------------------------
// Community cards (one street per step; the burn card is implicit)
// ---------------------------------------------------------------------------

function stepStreetDeal(state: HoldemState): HoldemState {
  const count = state.board.length === 0 ? 3 : 1
  let next = state
  const dealt: Card[] = []
  for (let k = 0; k < count; k++) {
    const drawn = takeCard(next)
    next = drawn.state
    dealt.push(drawn.card)
  }
  next = { ...next, board: [...next.board, ...dealt] }

  const street: Street =
    next.board.length <= 3 ? 'flop' : next.board.length === 4 ? 'turn' : 'river'
  const heading = street === 'flop' ? 'Flop' : street === 'turn' ? 'Turn' : 'River'
  next = withEvent({ ...next, street }, 'street', `${heading}: ${handText(dealt)}`)

  const live = liveIndexes(next)
  if (live.length <= 1) return stepSettlement(next)

  // Runout: at most one seat still has chips, so nobody bets — keep dealing a
  // street per step until the board is out.
  const withChips = live.filter((i) => canAct(next.seats[i]))
  if (withChips.length <= 1) {
    return next.board.length >= 5 ? enterShowdown(next) : next
  }

  return enterBetting(next, street)
}

// ---------------------------------------------------------------------------
// Showdown (one reveal per step)
// ---------------------------------------------------------------------------

function enterShowdown(state: HoldemState): HoldemState {
  return { ...state, phase: 'showdown', revealStep: 0, pendingToAct: [] }
}

function stepShowdown(state: HoldemState): HoldemState {
  const order = orderFrom(state, state.button + 1).filter((i) => isLive(state.seats[i]))
  if (state.revealStep >= order.length) return stepSettlement(state)

  const index = order[state.revealStep]
  const seat = state.seats[index]
  const rank = evaluate([...seat.hole, ...state.board])

  let next = updateSeat(state, index, (s) => ({ ...s, revealed: true, handRank: rank }))
  next = { ...next, revealStep: next.revealStep + 1 }
  return withEvent(
    next,
    'showdown',
    `${seat.name} ${verb(seat, 'show')} ${handText(seat.hole)} — ${lower(rank.label)}`,
    seat.id,
  )
}

// ---------------------------------------------------------------------------
// Pots + settlement (one step)
// ---------------------------------------------------------------------------

function sameEligible(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * Layer the pot by distinct commit levels. Every seat contributes its slice of
 * each layer — including folded seats, whose chips are dead money in the layers
 * they reached — and only unfolded seats that paid up to a level can win it.
 * Consecutive layers with the same eligible set collapse into one pot.
 */
function buildPots(state: HoldemState): Pot[] {
  const live = liveIndexes(state).map((i) => state.seats[i].id)
  const levels = Array.from(
    new Set(state.seats.map((s) => s.totalCommit).filter((v) => v > 0)),
  ).sort((a, b) => a - b)

  const pots: Pot[] = []
  let previous = 0
  for (const level of levels) {
    let amount = 0
    for (const seat of state.seats) {
      amount += Math.min(seat.totalCommit, level) - Math.min(seat.totalCommit, previous)
    }
    previous = level
    if (amount <= 0) continue

    const eligible = state.seats
      .filter((seat) => isLive(seat) && seat.totalCommit >= level)
      .map((seat) => seat.id)
    // A layer nobody live can claim is dead money for the layer below it.
    const claimants = eligible.length > 0 ? eligible : live

    const last = pots[pots.length - 1]
    if (last && sameEligible(last.eligible, claimants)) {
      pots[pots.length - 1] = { amount: last.amount + amount, eligible: last.eligible }
    } else {
      pots.push({ amount, eligible: claimants })
    }
  }
  return pots
}

function potName(index: number, count: number): string {
  if (index === 0) return 'Main pot'
  return count > 2 ? `Side pot ${index}` : 'Side pot'
}

/** Best hands among the eligible seats; every tied seat comes back. */
function bestOf(state: HoldemState, eligible: number[]): number[] {
  let winners: number[] = []
  for (const index of eligible) {
    const rank = state.seats[index].handRank
    if (!rank) continue
    if (winners.length === 0) {
      winners = [index]
      continue
    }
    const best = state.seats[winners[0]].handRank
    if (!best) {
      winners = [index]
      continue
    }
    const cmp = compareHands(rank, best)
    if (cmp > 0) winners = [index]
    else if (cmp === 0) winners.push(index)
  }
  return winners
}

function awardPot(
  state: HoldemState,
  pot: Pot,
  index: number,
  count: number,
  contested: boolean,
): HoldemState {
  const eligible = pot.eligible
    .map((id) => seatIndexOf(state, id))
    .filter((i) => i >= 0 && isLive(state.seats[i]))
  if (eligible.length === 0) return state

  // Every live seat is evaluated before settlement, so `bestOf` only comes back
  // empty if the engine is poked into an impossible state — chop it rather than
  // leave chips on the table.
  const best = contested ? bestOf(state, eligible) : eligible
  const winners = best.length > 0 ? best : eligible
  // Odd chips go to the earliest winner left of the button, so put the winners
  // in that order before slicing the pot.
  const ordered = orderFrom(state, state.button + 1).filter((i) => winners.includes(i))
  if (ordered.length === 0) return state

  const share = Math.floor(pot.amount / ordered.length)
  let remainder = pot.amount - share * ordered.length

  let next = state
  const parts: string[] = []
  for (const seatIndex of ordered) {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    const amount = share + extra
    next = updateSeat(next, seatIndex, (s) => ({
      ...s,
      stack: s.stack + amount,
      won: s.won + amount,
    }))
    parts.push(`${next.seats[seatIndex].name} ${money(amount)}`)
  }

  const label = contested ? state.seats[ordered[0]].handRank?.label : undefined
  const hand = label ? ` — ${lower(label)}` : ''
  const takers = ordered.length === 1 ? state.seats[ordered[0]].name : parts.join(', ')
  const uncontested = contested ? '' : ' (uncontested)'
  return withEvent(
    next,
    'award',
    `${potName(index, count)} ${money(pot.amount)} → ${takers}${uncontested}${hand}`,
    ordered.length === 1 ? state.seats[ordered[0]].id : undefined,
  )
}

function accumulateStats(state: HoldemState): HoldemState {
  const index = humanIndex(state)
  if (index < 0) return state
  const human = state.seats[index]
  if (human.out) return state // never dealt in

  const net = human.won - human.totalCommit
  const stats: HoldemStats = {
    ...state.stats,
    hands: state.stats.hands + 1,
    handsWon: state.stats.handsWon + (human.won > 0 ? 1 : 0),
    net: state.stats.net + net,
    showdowns: state.stats.showdowns + (human.revealed ? 1 : 0),
    showdownsWon: state.stats.showdownsWon + (human.revealed && human.won > 0 ? 1 : 0),
  }
  return withEvent({ ...state, stats }, 'hand', `Hand ${state.handNumber} — ${netText(net)}`)
}

/** One atomic step: layer the pots, push the chips, book the stats. */
function stepSettlement(state: HoldemState): HoldemState {
  const contested = liveIndexes(state).length > 1
  const pots = buildPots(state)

  let next: HoldemState = { ...state, pots, pendingToAct: [] }
  for (let i = 0; i < pots.length; i++) {
    next = awardPot(next, pots[i], i, pots.length, contested)
  }
  return accumulateStats({ ...next, phase: 'settlement' })
}

// ---------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------

/** True when an automatic step is pending; false whenever the human is on. */
export function needsHoldemStep(state: HoldemState): boolean {
  switch (state.phase) {
    case 'idle':
    case 'settlement':
      return false
    case 'betting':
      return !hasPokerActions(pokerActionsFor(state))
    case 'posting':
    case 'dealing':
    case 'streetDeal':
    case 'showdown':
      return true
  }
}

/** Advance exactly one visible step. A no-op while waiting on the human. */
export function holdemStep(state: HoldemState): HoldemState {
  switch (state.phase) {
    case 'posting':
      return stepPosting(state)
    case 'dealing':
      return stepDealing(state)
    case 'betting':
      return stepBetting(state)
    case 'streetDeal':
      return stepStreetDeal(state)
    case 'showdown':
      return stepShowdown(state)
    case 'idle':
    case 'settlement':
      return state
  }
}
