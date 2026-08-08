import { cssVars } from '../../../shared/ui/cssVars'
import type { CardSize } from '../../../shared/ui/CardView'
import type { Phase, SeatState } from '../types'
import { HandView } from './HandView'
import { formatMoney, formatSignedMoney } from './format'

export interface SeatViewProps {
  seat: SeatState
  /** this seat is the one acting right now */
  isActiveSeat: boolean
  phase: Phase
  variant: 'ai' | 'human'
  /** arc offset in px, 0 for the centre seat (AI row only) */
  arcOffset?: number
  cardSize?: CardSize
}

/** Chips won/lost this round, including the insurance side bet. */
export function seatRoundNet(seat: SeatState): number {
  let net = 0
  for (const hand of seat.hands) net += (hand.payout ?? 0) - hand.bet
  if (seat.insuranceBet > 0) {
    net += seat.insuranceResult === 'win' ? seat.insuranceBet * 2 : -seat.insuranceBet
  }
  return net
}

export function SeatView({
  seat,
  isActiveSeat,
  phase,
  variant,
  arcOffset = 0,
  cardSize,
}: SeatViewProps) {
  const size: CardSize = cardSize ?? (variant === 'human' ? 'lg' : 'sm')
  const settled = phase === 'settlement'
  const net = settled ? seatRoundNet(seat) : 0
  const hasHands = seat.hands.length > 0

  return (
    <div
      className={`seat seat--${variant}`}
      data-active={isActiveSeat ? 'true' : 'false'}
      style={cssVars({ '--arc': `${arcOffset}px` })}
    >
      <div className="seat__hands" data-hands={seat.hands.length}>
        {hasHands ? (
          seat.hands.map((hand, index) => (
            <HandView
              key={index}
              hand={hand}
              size={size}
              active={isActiveSeat && index === seat.activeHandIndex && !hand.finished}
              handIndex={index}
              handCount={seat.hands.length}
              settled={settled}
            />
          ))
        ) : (
          <div className="seat__empty">
            {seat.pendingBet > 0 ? 'Bet posted' : variant === 'human' ? 'Place your bet' : 'Waiting'}
          </div>
        )}
      </div>

      <div className="seat__plate">
        <span className="seat__name">{seat.name}</span>
        <span className="seat__bank num">{formatMoney(seat.bankroll)}</span>
        {seat.insuranceBet > 0 && (
          <span
            className="seat__ins"
            data-result={seat.insuranceResult ?? 'pending'}
            title="Insurance side bet"
          >
            INS {formatMoney(seat.insuranceBet)}
          </span>
        )}
        {settled && net !== 0 && (
          <span className="seat__net num" data-up={net > 0 ? 'true' : 'false'}>
            {formatSignedMoney(net)}
          </span>
        )}
      </div>
    </div>
  )
}
