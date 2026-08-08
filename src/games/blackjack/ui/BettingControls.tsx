import { CHIP_DENOMS, Chip, ChipStack } from '../../../shared/ui/ChipStack'
import { Kbd } from '../../../shared/ui/Kbd'
import { MIN_BET } from '../types'
import { formatMoney } from './format'

export interface BettingControlsProps {
  bankroll: number
  pendingBet: number
  onAddChip: (denom: number) => void
  onRemoveChip: (denom: number) => void
  onClear: () => void
  onDeal: () => void
  onRebuy: () => void
}

/** Below this the "+1000" free-play rebuy button appears. */
const LOW_BANKROLL = 100

export function BettingControls({
  bankroll,
  pendingBet,
  onAddChip,
  onRemoveChip,
  onClear,
  onDeal,
  onRebuy,
}: BettingControlsProps) {
  const available = Math.max(0, bankroll - pendingBet)
  const canDeal = pendingBet >= MIN_BET && pendingBet <= bankroll
  const broke = bankroll < MIN_BET
  const showRebuy = bankroll < LOW_BANKROLL

  return (
    <div className="betting">
      <div className="betting__chips" role="group" aria-label="Add chips to your bet">
        {[...CHIP_DENOMS].reverse().map((denom) => (
          <button
            key={denom}
            type="button"
            className="betting__chip"
            onClick={() => onAddChip(denom)}
            disabled={denom > available}
            aria-label={`Bet $${denom} more`}
          >
            <Chip denom={denom} size={46} />
          </button>
        ))}
      </div>

      <div className="betting__wager">
        <div className="betting__wagerhead">
          <span className="smallcaps">Your bet</span>
          {pendingBet > 0 && (
            <button type="button" className="btn btn--quiet" onClick={onClear}>
              Clear
              <Kbd>C</Kbd>
            </button>
          )}
        </div>

        {pendingBet > 0 ? (
          <ChipStack amount={pendingBet} onRemove={onRemoveChip} maxChips={9} />
        ) : (
          <p className="betting__hint">
            Tap chips to wager. Minimum {formatMoney(MIN_BET)}. Tap a wagered chip to take it back.
          </p>
        )}
      </div>

      <div className="betting__actions">
        {showRebuy && (
          <button
            type="button"
            className={`btn ${broke ? 'btn--gold' : 'btn--ghost'}`}
            onClick={onRebuy}
          >
            Rebuy +{formatMoney(1000)}
          </button>
        )}
        <button type="button" className="btn btn--gold betting__deal" onClick={onDeal} disabled={!canDeal}>
          Deal
          <Kbd>⏎</Kbd>
        </button>
      </div>

      {broke && (
        <p className="betting__warn">
          Out of chips — this is free play, take a rebuy and keep training.
        </p>
      )}
    </div>
  )
}
