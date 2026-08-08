import { ChevronIcon } from '../../../shared/ui/Icons'
import { formatPct } from '../odds'
import type { SessionStats } from '../types'
import { formatSignedMoney } from './format'

export interface StatsBarProps {
  stats: SessionStats
  open: boolean
  onToggle: () => void
}

interface Stat {
  label: string
  value: string
  tone?: 'win' | 'lose' | 'neutral'
}

export function StatsBar({ stats, open, onToggle }: StatsBarProps) {
  const bookMatch = stats.hintsTotal > 0 ? stats.hintsMatched / stats.hintsTotal : null
  const netTone = stats.net > 0 ? 'win' : stats.net < 0 ? 'lose' : 'neutral'

  const items: Stat[] = [
    { label: 'Rounds', value: String(stats.rounds) },
    { label: 'Hands', value: String(stats.handsPlayed) },
    { label: 'W / L / P', value: `${stats.handsWon}/${stats.handsLost}/${stats.handsPushed}` },
    { label: 'Blackjacks', value: String(stats.blackjacks) },
    { label: 'Net', value: formatSignedMoney(stats.net), tone: netTone },
    {
      label: 'Book match',
      value:
        bookMatch === null ? '—' : `${formatPct(bookMatch)} (${stats.hintsMatched}/${stats.hintsTotal})`,
    },
  ]

  return (
    <div className={`stats${open ? ' is-open' : ''}`}>
      <button type="button" className="stats__toggle" onClick={onToggle} aria-expanded={open}>
        <span className="smallcaps">Session</span>
        <span className="stats__peek num" data-tone={netTone}>
          {formatSignedMoney(stats.net)}
        </span>
        <span className="stats__peek stats__peek--dim num">
          {stats.handsWon}W · {stats.handsLost}L · {stats.handsPushed}P
        </span>
        <ChevronIcon dir={open ? 'up' : 'down'} size={16} />
      </button>

      {open && (
        <dl className="stats__grid">
          {items.map((item) => (
            <div className="stats__cell" key={item.label}>
              <dt className="smallcaps">{item.label}</dt>
              <dd className="num" data-tone={item.tone ?? 'neutral'}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
