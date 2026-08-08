import { Kbd } from '../../../shared/ui/Kbd'
import type { HoldemEvent, HoldemSeatState } from '../types'
import { formatSignedMoney } from './format'

export interface PokerSettlementProps {
  human: HoldemSeatState
  /** award events from the engine — one per pot, in pot order */
  awards: HoldemEvent[]
  /** the human is broke and auto top-up is off */
  stranded: boolean
  onNext: () => void
}

export function PokerSettlement({ human, awards, stranded, onNext }: PokerSettlementProps) {
  const net = human.won - human.totalCommit
  const tone = net > 0 ? 'win' : net < 0 ? 'lose' : 'push'

  return (
    <div className="psettle">
      {awards.length > 0 && (
        <div className="psettle__awards">
          {awards.map((event, index) => (
            <span
              key={index}
              className="psettle__badge"
              data-mine={event.seatId === human.id ? 'true' : 'false'}
            >
              {event.text}
            </span>
          ))}
        </div>
      )}

      <div className="psettle__foot">
        <span className={`psettle__net num psettle__net--${tone}`}>Hand {formatSignedMoney(net)}</span>
        <button type="button" className="btn btn--gold psettle__next" onClick={onNext} autoFocus>
          Next hand
          <Kbd>⏎</Kbd>
        </button>
      </div>

      {stranded && (
        <p className="psettle__warn">
          You&apos;re out of chips — turn on auto top-up in the table settings to rebuy.
        </p>
      )}
    </div>
  )
}
