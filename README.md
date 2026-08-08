# blackjack-trainer

A practice-focused casino card trainer, built as an installable PWA. Blackjack
is the first game; the architecture is multi-game (`src/games/<game>/` over
shared card/chip primitives in `src/shared/`) so hold'em and friends can land
later.

## Features

- **American blackjack** — hole card, dealer peek, insurance, late surrender
- **Configurable rules** — 1/2/4/6/8 decks, H17/S17, 3:2 vs 6:5, DAS,
  double restrictions, resplit aces, penetration
- **Free-play betting** — chips, bankroll, one-tap rebuy; stakes stay fun
- **Live odds** — exact dealer final-total distribution from the *actual
  remaining shoe composition*, win/push/lose if you stand, and EV per action
- **Hint + book** — basic-strategy advice with plain-English reasoning and a
  color-coded strategy chart that highlights your exact spot
- **AI table mates** — up to 6 companion players who play perfect book
- **Trainer stats** — win rate, net, and how often you matched the book
- **PWA** — installable on iOS/Android, offline-capable, dealing animations

## Dev

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # type-check + production build to dist/
```

No runtime dependencies beyond React. Odds are computed analytically
(memoized recursion over the dealer's draw tree), not by simulation.

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
```

`CONTRACT.md` documents the module APIs and the engine state machine.
