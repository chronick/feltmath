import { BookIcon, CloseIcon } from '../../../shared/ui/Icons'
import type { StrategyAdvice } from '../types'
import { actionLabel } from './format'

export interface HintCardProps {
  advice: StrategyAdvice
  onShowBook: () => void
  onDismiss: () => void
}

export function HintCard({ advice, onShowBook, onDismiss }: HintCardProps) {
  const constrained = advice.bookAction !== advice.action

  return (
    <div className="hint" role="note">
      <div className="hint__top">
        <span className="hint__action">{actionLabel(advice.action).toUpperCase()}</span>
        <span className="hint__situation">{advice.situation}</span>
        <button
          type="button"
          className="btn btn--icon hint__close"
          onClick={onDismiss}
          aria-label="Hide hint"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <p className="hint__why">{advice.explanation}</p>

      {constrained && (
        <p className="hint__note">
          Book action here is <b>{actionLabel(advice.bookAction).toLowerCase()}</b>, which this
          hand can&apos;t do — {actionLabel(advice.action).toLowerCase()} is the fallback.
        </p>
      )}

      <button type="button" className="btn btn--quiet hint__book" onClick={onShowBook}>
        <BookIcon size={15} />
        Show in book
      </button>
    </div>
  )
}
