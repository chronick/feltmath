# Feltmath

**feltmath.com** — the math of the felt. A practice-focused casino card
trainer, built as an installable PWA. Blackjack and No-Limit Texas Hold'em;
the architecture is multi-game (`src/games/<game>/` over shared card/chip
primitives in `src/shared/`) so more games can land later.

## Features

- **American blackjack** — hole card, dealer peek, insurance, late surrender
- **Configurable rules** — 1/2/4/6/8 decks, H17/S17, 3:2 vs 6:5, DAS,
  double restrictions, resplit aces, penetration
- **Free-play betting** — chips, bankroll, one-tap rebuy; stakes stay fun
- **Blackjack odds** — removal-aware dealer final-total distribution from the
  actual remaining shoe, stand outcomes, and clearly labelled action-EV models
- **Hold'em equity** — exact enumeration when cheap, seeded Monte Carlo versus
  random hands otherwise, with pot odds and sampling uncertainty
- **Hint + book** — deck- and rule-aware blackjack basic strategy plus solid
  100bb 6-max Hold'em baselines, both with plain-English reasoning
- **AI table mates** — up to 6 companion players who play perfect book
- **Trainer stats** — win rate, net, and how often you matched the book
- **PWA** — installable on iOS/Android; both lazy-loaded games are precached
  for offline use

Blackjack uses a strict same-rank split house rule: `K,K` may split, while
`K,10` may not.

## Dev

```bash
npm install
npm run dev        # http://localhost:5199
npm test           # blackjack + Hold'em rule/evaluator regression suites
npm run typecheck
npm run build      # type-check + production build to dist/
```

No runtime dependencies beyond React. Blackjack dealer probabilities use
memoized without-replacement recursion; action EVs include documented teaching
approximations. Hold'em enumerates cheap heads-up spots exactly and uses seeded
Monte Carlo for larger state spaces.

## Architecture

```
src/
  shared/           # game-agnostic: cards, seeded RNG, CardView, ChipStack
  games/blackjack/
    types.ts        # single source of type truth (see CONTRACT.md)
    engine/         # pure state machine — one atomic step per call
    strategy/       # basic-strategy book (chart data IS the strategy source)
    odds/           # dealer distribution + per-action EV
    ai/             # AI seat behavior (plays the book)
    ui/             # React components
  games/holdem/
    engine/         # betting state machine, pots, evaluator
    strategy/       # preflop ranges + heuristic coaching
    odds/           # exact/Monte Carlo equity + pot odds
    ui/             # React components
```

`CONTRACT.md` and `CONTRACT-HOLDEM.md` document the module APIs and engine state
machines.
