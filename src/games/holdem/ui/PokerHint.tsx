import { BookIcon, CloseIcon } from '../../../shared/ui/Icons'
import { Kbd } from '../../../shared/ui/Kbd'
import type { HoldemAdvice } from '../types'
import { formatPct, pokerActionLabel } from './format'

export interface PokerHintProps {
  advice: HoldemAdvice
  /** opens the ranges modal at advice.chart — preflop only */
  onShowRanges: () => void
  onDismiss: () => void
}

export function PokerHint({ advice, onShowRanges, onDismiss }: PokerHintProps) {
  const hasNumbers = advice.equity !== undefined || advice.requiredEquity !== undefined

  return (
    <div className="phint" role="note">
      <div className="phint__top">
        <span className="phint__action">{pokerActionLabel(advice.action).toUpperCase()}</span>
        <span className="phint__situation">{advice.situation}</span>
        <button
          type="button"
          className="btn btn--icon phint__close"
          onClick={onDismiss}
          aria-label="Hide hint"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <p className="phint__why">{advice.explanation}</p>

      {hasNumbers && (
        <p className="phint__nums num">
          {advice.equity !== undefined && (
            <span>
              Equity <b>{formatPct(advice.equity)}</b>
            </span>
          )}
          {advice.requiredEquity !== undefined && (
            <span>
              Price <b>{formatPct(advice.requiredEquity)}</b>
            </span>
          )}
        </p>
      )}

      {advice.chart && (
        <button type="button" className="btn btn--quiet phint__book" onClick={onShowRanges}>
          <BookIcon size={15} />
          Show range
          <Kbd>B</Kbd>
        </button>
      )}
    </div>
  )
}
