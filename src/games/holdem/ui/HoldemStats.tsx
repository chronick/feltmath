import { ChevronIcon } from '../../../shared/ui/Icons'
import type { HoldemStats as Stats } from '../types'
import { formatPct, formatSignedMoney } from './format'

export interface HoldemStatsProps {
  stats: Stats
  open: boolean
  onToggle: () => void
}

interface Cell {
  label: string
  value: string
  tone?: 'win' | 'lose' | 'neutral'
}

function rate(part: number, whole: number): string {
  return whole > 0 ? formatPct(part / whole) : '—'
}

export function HoldemStats({ stats, open, onToggle }: HoldemStatsProps) {
  const netTone = stats.net > 0 ? 'win' : stats.net < 0 ? 'lose' : 'neutral'

  const items: Cell[] = [
    { label: 'Hands', value: String(stats.hands) },
    { label: 'Won', value: `${stats.handsWon} · ${rate(stats.handsWon, stats.hands)}` },
    { label: 'Net', value: formatSignedMoney(stats.net), tone: netTone },
    { label: 'VPIP', value: rate(stats.vpipHands, stats.hands) },
    { label: 'Showdowns', value: String(stats.showdowns) },
    { label: 'SD won', value: rate(stats.showdownsWon, stats.showdowns) },
  ]

  return (
    <div className={`hstats${open ? ' is-open' : ''}`}>
      <button type="button" className="hstats__toggle" onClick={onToggle} aria-expanded={open}>
        <span className="smallcaps">Session</span>
        <span className="hstats__peek num" data-tone={netTone}>
          {formatSignedMoney(stats.net)}
        </span>
        <span className="hstats__peek hstats__peek--dim num">
          {stats.hands} hands · {rate(stats.vpipHands, stats.hands)} VPIP
        </span>
        <ChevronIcon dir={open ? 'up' : 'down'} size={16} />
      </button>

      {open && (
        <dl className="hstats__grid">
          {items.map((item) => (
            <div className="hstats__cell" key={item.label}>
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
