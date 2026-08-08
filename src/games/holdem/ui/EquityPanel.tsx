import { ChartIcon } from '../../../shared/ui/Icons'
import { cssVars } from '../../../shared/ui/cssVars'
import type { EquityReport, PotOddsReport } from '../types'
import { Panel } from './Panel'
import { formatCount, formatMoney, formatPct } from './format'

export interface EquityPanelProps {
  report: EquityReport | null
  /** set only when there are chips to call */
  odds: PotOddsReport | null
  open: boolean
  onToggle: () => void
}

function pct(value: number): string {
  return `${Math.max(0, Math.min(100, value * 100))}%`
}

export function EquityPanel({ report, odds, open, onToggle }: EquityPanelProps) {
  const summary = report ? (
    <span className="eqp__summarytag num">{formatPct(report.equity)}</span>
  ) : (
    <span className="eqp__summarytag eqp__summarytag--idle">idle</span>
  )

  const ahead = report && odds ? report.equity >= odds.requiredEquity : false
  const edge = report && odds ? (report.equity - odds.requiredEquity) * 100 : 0

  return (
    <Panel
      title="Equity"
      icon={<ChartIcon size={16} />}
      summary={summary}
      open={open}
      onToggle={onToggle}
      className="hpanel--equity"
    >
      {!report ? (
        <p className="eqp__empty">Equity appears when the action is on you.</p>
      ) : (
        <div className="eqp">
          <div className="eqp__block">
            <div className="eqp__headline">
              <strong className="eqp__big num">{formatPct(report.equity)}</strong>
              <span className="eqp__vs">
                vs {report.opponents} opponent{report.opponents === 1 ? '' : 's'}
              </span>
            </div>

            <div
              className="eqbar"
              role="img"
              aria-label={`Win ${formatPct(report.win)}, tie ${formatPct(report.tie)}`}
            >
              <span className="eqbar__seg eqbar__seg--win" style={cssVars({ '--w': pct(report.win) })} />
              <span className="eqbar__seg eqbar__seg--tie" style={cssVars({ '--w': pct(report.tie) })} />
            </div>

            <ul className="eqp__legend">
              <li>
                <i className="hdot hdot--win" />
                Win <b className="num">{formatPct(report.win)}</b>
              </li>
              <li>
                <i className="hdot hdot--tie" />
                Tie <b className="num">{formatPct(report.tie)}</b>
              </li>
            </ul>
          </div>

          <div className="eqp__made">{report.madeHand}</div>

          {odds && (
            <div className="eqp__block">
              <div className="eqp__blockhead">
                <span className="smallcaps">Pot odds</span>
                <span className="eqp__caption num">
                  call {formatMoney(odds.toCall)} → {formatMoney(odds.potAfterCall)}
                </span>
              </div>

              <div className="oddsbar" data-ahead={ahead ? 'true' : 'false'}>
                <span className="oddsbar__fill" style={cssVars({ '--w': pct(report.equity) })} />
                <span
                  className="oddsbar__mark"
                  style={cssVars({ '--l': pct(odds.requiredEquity) })}
                  aria-hidden="true"
                />
              </div>

              <div className="oddsbar__keys">
                <span className="num">
                  You <b>{formatPct(report.equity)}</b>
                </span>
                <span className="num">
                  Need <b>{formatPct(odds.requiredEquity)}</b>
                </span>
              </div>

              <p className="eqp__verdict" data-ahead={ahead ? 'true' : 'false'}>
                {ahead
                  ? `Ahead of the price by ${edge.toFixed(0)} points — the call is +EV on raw equity.`
                  : `Behind the price by ${Math.abs(edge).toFixed(0)} points — you need more than the hand has.`}
              </p>
            </div>
          )}

          <p className="eqp__foot">
            {report.method === 'exact'
              ? 'exact enumeration'
              : `${formatCount(report.samples)} samples · Monte Carlo`}
          </p>
        </div>
      )}
    </Panel>
  )
}
