import { BlackjackGame } from './games/blackjack/ui/BlackjackGame'

/**
 * Thin multi-game shell. Today there is exactly one game; when hold'em lands
 * this list grows and the labels become real switcher buttons.
 */
interface GameEntry {
  id: string
  label: string
}

const GAMES: GameEntry[] = [{ id: 'blackjack', label: 'Blackjack' }]

export default function App() {
  const active = GAMES[0]

  return (
    <div className="app">
      <header className="appbar">
        <span className="appbar__mark" aria-hidden="true">
          ♠
        </span>
        <nav className="appbar__games" aria-label="Games">
          {GAMES.map((game) => (
            <span
              key={game.id}
              className={`appbar__game${game.id === active.id ? ' is-active' : ''}`}
              aria-current={game.id === active.id ? 'page' : undefined}
            >
              {game.label}
            </span>
          ))}
        </nav>
        <span className="appbar__tag">Trainer</span>
      </header>

      <BlackjackGame />
    </div>
  )
}
