import { Suspense, lazy, useState } from 'react'
import { useBlurButtonsAfterPointerClick } from './shared/ui/useHotkeys'

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
  useBlurButtonsAfterPointerClick()

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
        <a
          className="appbar__github"
          href="https://github.com/chronick/feltmath"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View Feltmath on GitHub (opens in a new tab)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
            />
          </svg>
        </a>
      </header>

      <Suspense fallback={<div className="app__loading">Shuffling up…</div>}>
        {activeId === 'holdem' ? <HoldemGame /> : <BlackjackGame />}
      </Suspense>
    </div>
  )
}
