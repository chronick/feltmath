import { BulbIcon } from '../../../shared/ui/Icons'
import { Kbd } from '../../../shared/ui/Kbd'
import type { Action, ActionContext } from '../types'

export interface ActionBarProps {
  ctx: ActionContext
  onAction: (action: Action) => void
  onHint: () => void
  hintShown: boolean
  /** "Hard 16 vs 10" style caption, or the split-hand position */
  caption: string
}

interface Entry {
  action: Action
  label: string
  key: string
  enabled: boolean
  tone: 'primary' | 'secondary' | 'danger'
}

export function ActionBar({ ctx, onAction, onHint, hintShown, caption }: ActionBarProps) {
  const entries: Entry[] = [
    { action: 'hit', label: 'Hit', key: 'H', enabled: ctx.canHit, tone: 'primary' },
    { action: 'stand', label: 'Stand', key: 'S', enabled: ctx.canStand, tone: 'primary' },
    { action: 'double', label: 'Double', key: 'D', enabled: ctx.canDouble, tone: 'secondary' },
    { action: 'split', label: 'Split', key: 'P', enabled: ctx.canSplit, tone: 'secondary' },
    { action: 'surrender', label: 'Surrender', key: 'R', enabled: ctx.canSurrender, tone: 'danger' },
  ]

  return (
    <div className="actionbar">
      <div className="actionbar__head">
        <span className="actionbar__caption">{caption}</span>
        <button
          type="button"
          className="btn btn--quiet actionbar__hint"
          onClick={onHint}
          aria-pressed={hintShown}
        >
          <BulbIcon size={15} />
          Hint
          <Kbd>?</Kbd>
        </button>
      </div>

      <div className="actionbar__row" role="group" aria-label="Your move">
        {entries.map((entry) => (
          <button
            key={entry.action}
            type="button"
            className={`actbtn actbtn--${entry.tone}`}
            disabled={!entry.enabled}
            onClick={() => onAction(entry.action)}
          >
            {entry.label}
            <Kbd>{entry.key}</Kbd>
          </button>
        ))}
      </div>
    </div>
  )
}
