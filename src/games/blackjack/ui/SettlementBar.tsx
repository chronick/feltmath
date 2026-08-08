import type { SeatState } from '../types'
import { formatSignedMoney, outcomeLabel, outcomeTone } from './format'
import { seatRoundNet } from './SeatView'

export interface SettlementBarProps {
  seat: SeatState
  onNext: () => void
}

export function SettlementBar({ seat, onNext }: SettlementBarProps) {
  const net = seatRoundNet(seat)
  const tone = net > 0 ? 'win' : net < 0 ? 'lose' : 'push'

  return (
    <div className="settle">
      <div className="settle__results">
        {seat.hands.map((hand, index) => {
          const outcome = hand.outcome
          if (!outcome) return null
          const delta = (hand.payout ?? 0) - hand.bet
          return (
            <span key={index} className={`settle__chip settle__chip--${outcomeTone(outcome)}`}>
              {seat.hands.length > 1 && <i className="settle__idx">H{index + 1}</i>}
              <b>{outcomeLabel(outcome).toUpperCase()}</b>
              <em className="num">{formatSignedMoney(delta)}</em>
            </span>
          )
        })}

        {seat.insuranceBet > 0 && (
          <span
            className={`settle__chip settle__chip--${seat.insuranceResult === 'win' ? 'win' : 'lose'}`}
          >
            <b>INSURANCE</b>
            <em className="num">
              {formatSignedMoney(
                seat.insuranceResult === 'win' ? seat.insuranceBet * 2 : -seat.insuranceBet,
              )}
            </em>
          </span>
        )}
      </div>

      <div className="settle__foot">
        <span className={`settle__net num settle__net--${tone}`}>
          Round {formatSignedMoney(net)}
        </span>
        <button type="button" className="btn btn--gold settle__next" onClick={onNext} autoFocus>
          Next hand
        </button>
      </div>
    </div>
  )
}
