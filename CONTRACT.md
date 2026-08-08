# Module contracts

Multi-game trainer. `src/shared/` is game-agnostic (cards, rng, reusable UI);
each game lives under `src/games/<game>/`. Blackjack and Texas Hold'em are
implemented. Keep shared primitives generic and game-specific behavior inside
the corresponding module directory. Hold'em's contract is in
`CONTRACT-HOLDEM.md`.

All types referenced below are defined in `src/games/blackjack/types.ts` and
`src/shared/cards.ts`. Do not redefine them.

## src/games/blackjack/engine/hand.ts

```ts
export function handTotal(cards: Card[]): { total: number; soft: boolean }
export function isBlackjack(cards: Card[], fromSplit: boolean): boolean  // natural 21: 2 cards, not from split
export function handLabel(cards: Card[]): string                        // "Soft 18", "Hard 16", "Blackjack", "Bust (23)"
export function cardValue(rank: Rank): number                           // A=1 here; handTotal handles soft
```

## src/games/blackjack/engine/game.ts

Pure functions only — every mutator returns a NEW GameState (React reducer
friendly, StrictMode safe). All randomness flows through `rngSeed` +
`src/shared/rng.ts`. No Date.now / Math.random.

```ts
export function newGame(rules: RulesConfig, seed?: number): GameState    // phase 'betting'
export function applyRules(state: GameState, rules: RulesConfig): GameState // betting phase only; rebuilds shoe/seats as needed
export function setBet(state: GameState, amount: number): GameState      // human pendingBet (clamped to bankroll, MIN_BET granularity handled by UI)
export function addChips(state: GameState, amount: number): GameState    // free rebuy for human seat
export function startRound(state: GameState): GameState                  // posts bets (AI too), shuffles if pending, phase 'dealing'
export function needsStep(state: GameState): boolean                     // true when an automatic step is pending
export function step(state: GameState): GameState                        // advance ONE atomic step (one card, one reveal, one AI action…)
export function doAction(state: GameState, action: Action): GameState    // human action on their active hand
export function takeInsurance(state: GameState): GameState               // half of main bet
export function declineInsurance(state: GameState): GameState
export function nextRound(state: GameState): GameState                   // settlement → betting
export function availableActions(state: GameState): ActionContext        // for the HUMAN active hand; NO_ACTIONS when it isn't their turn
export function humanSeat(state: GameState): SeatState
export function currentSeat(state: GameState): SeatState | null          // active seat during playerTurns
export function currentHand(state: GameState): HandState | null
export function unseenComposition(state: GameState): Composition         // shoe + dealer hole card while hidden
```

### State machine (authoritative spec)

- **betting** → `startRound` requires human `pendingBet >= MIN_BET` and
  `<= bankroll`. Deduct bets from every seat's bankroll (AI seats choose a
  bet via `aiBet` from src/games/blackjack/ai/aiPlayer.ts; auto-rebuy AI
  bankroll +1000 with an event when below their bet). If `reshufflePending`,
  rebuild+shuffle shoe from `rules.decks` (event 'shuffle'). Clear events,
  round++, phase 'dealing', dealStep=0.
- **dealing** — each `step` deals exactly one card, casino order: every seat
  gets card 1 left→right, dealer upcard, every seat card 2, dealer hole
  (face down). After the hole card: if upcard is Ace and `rules.insurance` →
  phase 'insurance'; else if upcard is Ace or a ten-value → phase 'peek';
  else phase 'playerTurns' (activeSeatIndex=0).
- **insurance** — waits for human input (`takeInsurance`/`declineInsurance`).
  AI never insures. Both transitions → phase 'peek'.
- **peek** — one `step`: if hole makes dealer blackjack → reveal hole, settle
  the whole round immediately (naturals push, all other hands lose; insurance
  pays 2:1 → `insuranceResult`), phase 'settlement'. Else event
  "Dealer peeks — no blackjack", phase 'playerTurns'.
  Only peek when upcard is A or ten-value (else skip straight through).
- **playerTurns** — seats act in order 0..n-1, each hand in seat order.
  `step` handles AI actions (one action per step, via `aiDecide`) and
  auto-advances: a hand with blackjack is finished immediately (event);
  a hand at 21 auto-stands; a 1-card split hand gets its next card dealt as a
  step; split-aces hands with 2 cards auto-stand when `!rules.hitSplitAces`.
  For the human seat `needsStep` is false while a decision is pending
  (availableActions non-empty). `doAction`:
  - hit: draw card; bust → outcome 'bust', finished (bet already lost)
  - stand: finished
  - double: deduct extra bet equal to `hand.bet` from bankroll, bet ×2 on that
    hand, exactly one card, finished
  - split: pop second card into a new hand inserted after current, both hands
    `fromSplit` (and `fromSplitAces` if aces), deduct a new bet equal to
    `hand.bet`; the active hand then has 1 card — next step deals it.
  - surrender: outcome 'surrender', finished, payout will be bet/2.
  When all hands of all seats are finished → phase 'dealerTurn'.
  If EVERY hand is bust/surrendered/blackjack (nothing to draw for) the
  dealer still reveals the hole card but draws nothing.
- **dealerTurn** — first `step` reveals hole (event). Then one card per
  `step` while total < 17 or (total==17 && soft && rules.dealerHitsSoft17).
  When done → settlement step: compute every hand outcome + payout, credit
  bankrolls, update `stats` (human seat only; count each hand; net = returns
  − outlays including insurance and doubles), events per seat outcome,
  `reshufflePending` when (discard + dealt) / total > penetration, phase
  'settlement'.
- **settlement** — static; `nextRound` moves cards to discard, resets hands,
  phase 'betting'. Human `pendingBet` persists round to round (re-clamped).

Payout ledger (bets already deducted when posted): loss/bust → 0 returned;
push → bet; win → 2×bet; natural blackjack → bet × (1 + rules.blackjackPayout);
surrender → bet/2; insurance win → 3× insuranceBet returned (stake + 2:1).

`availableActions` for a 2-card hand: double allowed per `rules.doubleOn`
(hard totals; any2 = always) + bankroll ≥ extra bet + (if fromSplit, requires
doubleAfterSplit) + not on split aces w/ one-card rule; split requires pair
(intentional house rule: equal rank only, e.g. K,K yes / K,10 no), seat hands
< maxSplitHands, bankroll ≥ extra bet, aces
resplit only if resplitAces; surrender only first decision of a non-split
2-card hand when lateSurrender. Hit/stand always true for an unfinished hand
(except split-aces one-card rule → only stand).

`doAction` MUST also update stats.hintsTotal/hintsMatched by comparing the
human action against `basicStrategy(...).action` before applying it.

## src/games/blackjack/strategy/basicStrategy.ts

```ts
export function basicStrategy(cards: Card[], dealerUp: Rank, rules: RulesConfig, ctx: ActionContext, canFundDoubleAfterSplit?: boolean): StrategyAdvice
```

Basic strategy selected for single-deck, double-deck, or 4–8 deck play and
adjusted for H17/S17, surrender, DAS, double restrictions, and split-ace rules.
It falls back sensibly when the book action is unavailable (double→hit unless
Ds→stand; split
unavailable → play as hard/soft total; surrender unavailable → Rh hit /
Rs stand). Explanation strings: concise, concrete, teach the WHY
("Dealer's 6 busts 42% of the time — let them take the risk").

## src/games/blackjack/strategy/book.ts

```ts
export function bookTables(rules: RulesConfig): BookTables
```

Chart data the UI renders; must agree with basicStrategy (generate
basicStrategy FROM these tables to guarantee consistency).

## src/games/blackjack/ai/aiPlayer.ts

```ts
export function aiDecide(cards: Card[], dealerUp: Rank, rules: RulesConfig, ctx: ActionContext, canFundDoubleAfterSplit?: boolean): Action
export function aiBet(seatId: number, round: number, bankroll: number): number  // deterministic, chip-multiple spread
export const AI_NAMES: readonly string[]  // >= 6 fun names
```

aiDecide = basicStrategy constrained to ctx (never insures).

## src/games/blackjack/odds/index.ts (+ dealerOdds.ts, playerEV.ts)

```ts
export function dealerDistribution(dealerUp: Rank, comp: Composition, rules: RulesConfig, conditionNoBlackjack: boolean): DealerDistribution
export function computeOdds(playerCards: Card[], dealerUp: Rank, comp: Composition, rules: RulesConfig, ctx: ActionContext, canFundDoubleAfterSplit?: boolean): OddsReport
```

- `comp` is the CURRENT unseen composition (shoe + hole card). Dealer recursion
  removes each drawn card from the composition and memoizes the resulting
  states.
- Dealer recursion: start from upcard, draw until stand/bust per H17/S17.
  `conditionNoBlackjack=true` (post-peek, upcard A or 10): renormalize the
  FIRST hole-card draw to exclude the rank completing a natural.
- standWin/standPush/standLose from the dealer distribution vs player total
  (player bust → standWin=0, standLose=1).
- EVs in units of initial bet: stand (win×1 − lose×1), hit (optimal
  play-after via memoized recursion over (total, soft)), double (one card
  then stand, ×2 stakes), split (2 × EV of a fresh one-card
  hand starting with the pair rank played optimally; split aces one-card
  rule respected), surrender (−0.5). Natural-blackjack payout does NOT
  appear here (odds are only shown mid-decision, never for a natural).
- The dealer distribution is exact for the current shoe. Prospective player
  draws use fixed live-shoe value frequencies; split EV additionally omits
  resplits. The UI labels these action EVs as modeled approximations.
- Must complete in < ~50ms for a 8-deck shoe. Memoize inside the call.
- Best action = max EV among available.

## src/games/blackjack/ui/  +  src/shared/ui/

React 19 function components, plain CSS (no framework). Details in the UI
brief. Shared: `CardView`, `ChipStack`, theme tokens. Blackjack:
`BlackjackGame` (owns `useReducer` over engine), table layout, seats, odds
panel, hint card, book modal, settings, betting controls, stats bar.

## App shell

`src/App.tsx` — lazy-loaded Blackjack/Hold'em game switcher.
`src/main.tsx` mounts App and registers `sw.js`.
