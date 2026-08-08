import { Suspense, lazy, useState } from 'react'

const BlackjackGame = lazy(() =>
  import('./games/blackjack/ui/BlackjackGame').then((m) => ({ default: m.BlackjackGame })),
)
const HoldemGame = lazy(() =>
  import('./games/holdem/ui/HoldemGame').then((m) => ({ default: m.HoldemGame })),
)

interface GameEntry {
  id: string
  label: string
}

const GAMES: GameEntry[] = [
  { id: 'blackjack', label: 'Blackjack' },
  { id: 'holdem', label: "Hold'em" },
]

const GAME_KEY = 'feltmath-game'

function initialGame(): string {
  try {
    const saved = localStorage.getItem(GAME_KEY)
    if (saved && GAMES.some((g) => g.id === saved)) return saved
  } catch {
    // private mode etc. — fall through
  }
  return GAMES[0].id
}

export default function App() {
  const [activeId, setActiveId] = useState(initialGame)

  const select = (id: string) => {
    setActiveId(id)
    try {
      localStorage.setItem(GAME_KEY, id)
    } catch {
      // best effort
    }
  }

  return (
    <div className="app">
      <header className="appbar">
        <span className="appbar__mark" aria-hidden="true">
          ♠
        </span>
        <nav className="appbar__games" aria-label="Games">
          {GAMES.map((game) => (
            <button
              key={game.id}
              type="button"
              className={`appbar__game${game.id === activeId ? ' is-active' : ''}`}
              aria-current={game.id === activeId ? 'page' : undefined}
              onClick={() => select(game.id)}
            >
              {game.label}
            </button>
          ))}
        </nav>
        <span className="appbar__tag">Feltmath</span>
      </header>

      <Suspense fallback={<div className="app__loading">Shuffling up…</div>}>
        {activeId === 'holdem' ? <HoldemGame /> : <BlackjackGame />}
      </Suspense>
    </div>
  )
}
