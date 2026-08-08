# Hold'em module contracts

6-max No-Limit Texas Hold'em cash game vs 1–5 AI seats. Same architecture as
blackjack (see CONTRACT.md): pure engine, one atomic visible step per call,
all randomness through `rngSeed` + src/shared/rng.ts, React reducer friendly.
All types are defined in `src/games/holdem/types.ts` — do not redefine them.
No run-it-twice, no antes, no straddles, no rake.

## src/games/holdem/engine/evaluate.ts

```ts
export function evaluate(cards: Card[]): HandRank        // 5..7 cards, best 5
export function compareHands(a: HandRank, b: HandRank): number  // sign of a-b
```

- `score` packs category + tiebreaks into one comparable integer
  (e.g. base-15 digits: category, then five ordered values; wheel = 5-high).
- Correct wheels (A-2-3-4-5 straight & straight flush), flush kickers, full
  house ordering (trips digit then pair digit), quads + kicker, two-pair
  (high pair, low pair, kicker), board-plays-for-everyone chops.
- `label` in plain English: "Two pair, kings and nines, jack kicker".
- Performance matters (equity MC calls this ~50k times): precompute rank
  counts/suit buckets in one pass, no allocations in hot paths beyond the
  result, no sorting of full combos — evaluate the 7 cards directly
  (rank-count histogram + straight scan + flush check), don't enumerate all
  21 five-card subsets.

## src/games/holdem/engine/game.ts

```ts
export function newHoldemGame(config: HoldemConfig, seed?: number): HoldemState  // phase 'idle'
export function applyConfig(state: HoldemState, config: HoldemConfig): HoldemState // idle/settlement only; rebuild seats on aiPlayers change (preserve human stack & stats)
export function startHand(state: HoldemState): HoldemState   // idle|settlement → 'posting'; rotates button (not on the first hand); rebuys busted/short seats per topUp with an event; fresh shuffled deck
export function needsHoldemStep(state: HoldemState): boolean
export function holdemStep(state: HoldemState): HoldemState  // ONE atomic step
export function doPokerAction(state: HoldemState, action: PokerAction): HoldemState // human only, validated vs pokerActionsFor
export function pokerActionsFor(state: HoldemState): PokerActionContext  // for the HUMAN when acting; NO_POKER_ACTIONS otherwise
export function humanHoldemSeat(state: HoldemState): HoldemSeatState
export function potTotal(state: HoldemState): number  // all totalCommits
```

### Positions & order (get this exactly right)

- Seats array order IS table order clockwise. Button index rotates +1 each
  hand to the next seat that is not `out`.
- Multiway: SB = next live seat after button, BB = next after SB. Preflop
  action starts left of BB; postflop action starts left of button.
- **Heads-up (2 live seats): the button IS the small blind, acts FIRST
  preflop and SECOND postflop.**
- `startHand` seats the human at a fixed index; position changes come from
  button rotation. Position label helper: BTN/SB/BB always; remaining seats
  from the front: 6-max = UTG, HJ, CO; fewer players drop from UTG side.

### Betting rules (NLHE)

- `currentBet` = highest amount players must match this street. Preflop it is
  at least the configured big blind even when the BB is all-in short;
  `lastRaiseSize` starts at BB. Postflop the minimum opening bet is BB. A full
  raise sets `lastRaiseSize` to (newTotal − previousCurrentBet).
- Min raise-to = currentBet + lastRaiseSize (capped by stack → all-in).
- Call for less (all-in short call) allowed. **Incomplete all-in raise
  (increment < lastRaiseSize) does NOT re-open action** for seats that
  already acted this street and does NOT update lastRaiseSize; it does
  update currentBet to the all-in total.
- `pendingToAct`: initialized in street order at street start (live,
  non-all-in seats); acting seat pops itself; a FULL bet/raise refills it
  with every other live non-all-in seat (in order after the raiser).
  Betting closes when empty.
- Multiple incomplete all-in raises are cumulative for reopening purposes: a
  player who has already acted regains the right to raise once the total
  increase faced since that action is at least one full `lastRaiseSize`.
- Fold/check/call/bet/raise/allin all emit events ("Rocket Ron raises to
  $60"). `allin` action = raise/bet/call for the seat's whole stack.
- When only one live (unfolded) seat remains → return any uncalled excess to
  the last bettor, award the pot immediately (no reveal), settlement.
- When betting closes and ≤1 live seat is NOT all-in → return uncalled
  excess, then deal out the remaining streets (streetDeal steps, one street
  per step: flop = 3 cards one step) and go to showdown.
- Normal street close: flop(3)→turn(1)→river(1) via 'streetDeal' (burn
  implicit), then 'betting' again starting left of button; after river →
  'showdown'.

### Pots / showdown / settlement

- Side pots derived from `totalCommit` layers: sort distinct commit levels
  among ALL seats (folded chips are dead money in the layers they reach);
  layer amount = Σ over seats of the slice; eligible = non-folded seats with
  totalCommit ≥ level. Merge consecutive layers with identical eligible sets.
- Uncalled bet (excess over second-highest commit) returns to the bettor
  BEFORE pot layering, with an event.
- Showdown: one seat revealed per step (live seats in order starting left of
  button), `handRank` filled via evaluate(hole+board). Then settlement step:
  each pot goes to its best eligible hand(s), chops split evenly with odd
  chip(s) to the earliest eligible seat left of the button; `won` credited;
  events per award ("Main pot $240 → You — two pair, aces and nines").
- Stats (human): hands, handsWon (won any chips), net (won − totalCommit),
  vpipHands (any voluntary preflop chips: call/bet/raise, blinds don't
  count... a BB check is not VPIP, completing from SB is), showdowns,
  showdownsWon.
- phase 'settlement' is static; `startHand` begins the next hand.

### AI turns

During 'betting', when the acting seat is AI, `holdemStep` gets its action
from `aiPokerDecide(state, actingIndex)` (src/games/holdem/ai/aiPlayer.ts)
and applies it through the same internal apply path as human actions (same
validation; sanitize an illegal AI action to check-if-possible-else-fold).

## src/games/holdem/ai/aiPlayer.ts

```ts
export function aiPokerDecide(state: HoldemState, seatIndex: number): PokerAction
export const HOLDEM_AI_NAMES: readonly string[]   // >= 8, poker-flavored
```

- Deterministic: any randomness derives from hashing
  (state.rngSeed, seatIndex, state.handNumber, state.street,
  state.events.length) through shared rng — same state → same action.
- Seat personality from hash(seatId): tight/loose × passive/aggressive
  scalars. Preflop: hand-strength score (Chen-style formula is fine)
  thresholded by position + personality → fold/call/raise (2.5–3bb opens,
  ~3x 3-bets). Postflop: hand strength from evaluate + a cheap draw check
  (flush draw / OESD) → thresholds vs pot odds; personality scales
  bet/bluff frequency; sizes in {1/2 pot, 2/3 pot, pot} rounded to BB
  multiples; never illegal (respect min-raise, stack caps → all-in).
- Must never stall: always returns a legal action for the acting seat.

## src/games/holdem/odds/equity.ts

```ts
export function equity(hole: Card[], board: Card[], opponents: number, samples: number, seed: number): EquityReport
export function potOdds(toCall: number, potBeforeCall: number): PotOddsReport
export function describeMade(hole: Card[], board: Card[]): string  // "Pair of kings", preflop: "Ace-king suited"
```

- Remove hole+board from a fresh 52-card deck; each MC sample deals
  opponents' holes + remaining board WITHOUT replacement (seeded shuffle or
  Fisher-Yates partial), evaluates all, scores win/tie (tie = split share:
  equity = (wins + ties/k)/samples where k = players tied).
- Exact enumeration instead of MC when cheap: river vs 1 opponent
  (C(45,2)=990) and turn vs 1 opponent
  (C(46,2) opponent holes × 44 rivers = 45,540 assignments) → method 'exact'.
  Multiway or earlier streets → 'monte-carlo'.
- Target <80ms at samples=5000 with 3 opponents (lean on the fast evaluator;
  reuse one scratch deck array, no per-sample allocation storms).
- `potOdds`: requiredEquity = toCall / (potBeforeCall + toCall + ...callers
  ignored — keep the simple two-way formula and say so).

## src/games/holdem/strategy/ranges.ts + advice.ts

```ts
// ranges.ts
export function rfiChart(position: Position): RangeChart           // first-in ranges (SB = raise-or-fold sim­plified)
export function vsOpenChart(heroPosition: Position): RangeChart    // facing a single open: 3bet('raise')/call/fold — position-bucketed is fine (IP vs OOP); BB gets its own defend chart
export function comboKeyOf(hole: Card[]): ComboKey                 // 'AKs' / 'T9o' / 'QQ'
export function positionOf(state: HoldemState, seatId: number): Position

// advice.ts
export function holdemAdvice(state: HoldemState, ctx: PokerActionContext): HoldemAdvice
```

- Charts: standard solid 100bb 6-max baseline (UTG ≈15% open, HJ ≈18%, CO ≈26%,
  BTN ≈44%, SB ≈35% first-in; BB defend vs open ≈ call wide / 3bet value+
  some suited broadway). 13×13 grid keys: pairs 'TT', suited 'AQs', offsuit
  'AQo' — every one of the 169 combos present in every chart.
- advice preflop: unopened pot → rfiChart(position); facing exactly one
  raise → vsOpenChart (BB uses defend); 3bet+ pots → heuristic (continue
  only premium, explain). Suggested sizes: open 2.5bb (3bb UTG), 3bet ≈ 3×
  open (IP) / 4× (OOP), in chips rounded to BB.
- advice postflop: compare equity versus uniformly random opponent hands
  (advice computes its own quick equity at ~1500 samples with a seed derived
  from state.rngSeed) with required equity when facing a bet. Treat Monte
  Carlo edges inside the reported sampling margin as inconclusive. When unraised:
  strong made hands (two pair+, top pair good kicker) bet 2/3 pot; good
  draws semi-bluff or check per personality-free baseline; else check.
  Explanations teach: name the made hand/draw, the equity vs price, and the
  line ("You have 34% with the flush draw but only need 25% — call").
- Every explanation is honest that postflop advice is heuristic coaching,
  not solver output (one clause, not a disclaimer wall).

## src/games/holdem/ui/

Mirror the blackjack UI patterns (read src/games/blackjack/ui/ for idioms):
`HoldemGame.tsx` orchestrator (useReducer + auto-stepper ~450ms, equity via
useMemo ONLY on the human's turn, persistence key 'bjt-holdem-v1' for
config/stack/stats), `PokerTable.tsx` (oval felt, board center, pot chips,
button marker), `PokerSeat.tsx` (stack, street bet chips, hole cards - AI
face down until showdown, fold dims seat), `PokerActionBar.tsx` (Fold /
Check / Call $X / Bet|Raise with sizing: slider min→max + preset chips 1/3,
1/2, 2/3, pot, All-in; amounts in chips, BB-multiple stepping), equity panel
(equity bar vs opponents count, pot odds + required equity when facing a
bet, made-hand line, method+samples footnote), hint card + ranges modal
(13×13 color grid per position tabs, highlight current combo), settings
modal (aiPlayers 1-5, blinds, buy-in, top-up, equitySamples), stats bar
(hands, win rate, net, VPIP, showdown win), event log, hotkeys via shared
useHotkeys: F fold, C check/call, R bet/raise (focuses sizing), A all-in,
Enter confirm bet / next hand / start hand, ? hint, B ranges book — with
shared <Kbd> chips on the buttons. Reuse shared CardView/ChipStack/Modal/
Icons/Kbd. New CSS in holdem.css following blackjack.css tokens.
```

## Integration note

`src/App.tsx` game switcher is handled by the integrator (not the UI agent).
The UI agent exports `HoldemGame` from `src/games/holdem/ui/HoldemGame.tsx`
and touches nothing outside `src/games/holdem/ui/` + `src/games/holdem/holdem.css`
(if colocating css, keep it under the module dir).
