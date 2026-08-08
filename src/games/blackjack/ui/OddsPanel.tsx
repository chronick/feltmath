import { ChartIcon } from '../../../shared/ui/Icons'
import { cssVars } from '../../../shared/ui/cssVars'
import type { OddsReport } from '../types'
import { Panel } from './Panel'
import { actionLabel, formatEV, formatMoney, formatPct } from './format'

export interface OddsPanelProps {
  odds: OddsReport | null
  open: boolean
  onToggle: () => void
  /** the active hand's wager — used only for the "per $N" caption */
  bet: number
}

interface DistRow {
  label: string
  p: number
  tone: 'made' | 'gold' | 'bust'
}

function distributionRows(odds: OddsReport): DistRow[] {
  const d = odds.dealer
  const rows: DistRow[] = [
    { label: '17', p: d.p17, tone: 'made' },
    { label: '18', p: d.p18, tone: 'made' },
    { label: '19', p: d.p19, tone: 'made' },
    { label: '20', p: d.p20, tone: 'made' },
    { label: '21', p: d.p21, tone: 'made' },
  ]
  if (d.pBlackjack > 0) rows.push({ label: 'BJ', p: d.pBlackjack, tone: 'gold' })
  rows.push({ label: 'Bust', p: d.pBust, tone: 'bust' })
  return rows
}

export function OddsPanel({ odds, open, onToggle, bet }: OddsPanelProps) {
  const summary = odds ? (
    <span className="odds__summarytag">{actionLabel(odds.best)}</span>
  ) : (
    <span className="odds__summarytag odds__summarytag--idle">idle</span>
  )

  return (
    <Panel
      title="Odds"
      icon={<ChartIcon size={16} />}
      summary={summary}
      open={open}
      onToggle={onToggle}
      className="panel--odds"
    >
      {!odds ? (
        <p className="odds__empty">Odds appear when it&apos;s your call.</p>
      ) : (
        <div className="odds">
          <div className="odds__block">
            <div className="odds__blockhead">
              <span className="smallcaps">Dealer finishes on</span>
            </div>
            <ul className="dist">
              {distributionRows(odds).map((row) => (
                <li className="dist__row" key={row.label} data-tone={row.tone}>
                  <span className="dist__label num">{row.label}</span>
                  <span className="dist__track">
                    <span
                      className="dist__fill"
                      style={cssVars({ '--w': `${Math.max(0, Math.min(100, row.p * 100))}%` })}
                    />
                  </span>
                  <span className="dist__val num">{formatPct(row.p)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="odds__block">
            <div className="odds__blockhead">
              <span className="smallcaps">If you stand now</span>
            </div>
            <div className="split" role="img" aria-label={`Win ${formatPct(odds.standWin)}, push ${formatPct(odds.standPush)}, lose ${formatPct(odds.standLose)}`}>
              <span
                className="split__seg split__seg--win"
                style={cssVars({ '--w': `${odds.standWin * 100}%` })}
              />
              <span
                className="split__seg split__seg--push"
                style={cssVars({ '--w': `${odds.standPush * 100}%` })}
              />
              <span
                className="split__seg split__seg--lose"
                style={cssVars({ '--w': `${odds.standLose * 100}%` })}
              />
            </div>
            <ul className="split__legend">
              <li>
                <i className="dot dot--win" />
                Win <b className="num">{formatPct(odds.standWin)}</b>
              </li>
              <li>
                <i className="dot dot--push" />
                Push <b className="num">{formatPct(odds.standPush)}</b>
              </li>
              <li>
                <i className="dot dot--lose" />
                Lose <b className="num">{formatPct(odds.standLose)}</b>
              </li>
            </ul>
          </div>

          <div className="odds__block">
            <div className="odds__blockhead">
              <span className="smallcaps">Expected value</span>
              <span className="odds__caption">per $1 · bet {formatMoney(bet)}</span>
            </div>
            <ul className="evlist">
              {odds.evs.map((entry) => {
                const clamped = Math.max(-1, Math.min(1, entry.ev))
                const half = Math.abs(clamped) * 50
                const left = clamped >= 0 ? 50 : 50 - half
                const best = entry.action === odds.best
                return (
                  <li
                    className="evrow"
                    key={entry.action}
                    data-best={best ? 'true' : 'false'}
                    data-available={entry.available ? 'true' : 'false'}
                  >
                    <span className="evrow__name">{actionLabel(entry.action)}</span>
                    <span className="evrow__track">
                      <span className="evrow__zero" />
                      <span
                        className="evrow__fill"
                        data-up={clamped >= 0 ? 'true' : 'false'}
                        style={cssVars({ '--l': `${left}%`, '--w': `${half}%` })}
                      />
                    </span>
                    <span className="evrow__ev num" data-up={entry.ev >= 0 ? 'true' : 'false'}>
                      {formatEV(entry.ev)}
                    </span>
                    {/* always rendered so every row keeps the same track width */}
                    <span className="evrow__best" data-on={best ? 'true' : 'false'}>
                      best
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  )
}
