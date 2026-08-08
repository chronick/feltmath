import { CardView, type CardSize } from '../../../shared/ui/CardView'
import { ChipStack } from '../../../shared/ui/ChipStack'
import type { HoldemSeatState, Position } from '../types'
import { formatMoney, positionName } from './format'

export interface PokerSeatProps {
  seat: HoldemSeatState
  variant: 'ai' | 'human'
  /** BTN / SB / BB / UTG / HJ / CO — omitted between hands */
  position?: Position
  /** this seat has the dealer button */
  isButton: boolean
  /** action is on this seat right now */
  isActing: boolean
  /** hole cards face up: always for the human, at showdown for AI seats */
  showCards: boolean
  /** the pot has been awarded — win badges are final */
  settled: boolean
  cardSize?: CardSize
}

export function PokerSeat({
  seat,
  variant,
  position,
  isButton,
  isActing,
  showCards,
  settled,
  cardSize,
}: PokerSeatProps) {
  const size: CardSize = cardSize ?? (variant === 'human' ? 'md' : 'sm')
  const dealt = seat.hole.length > 0
  const rank = showCards ? seat.handRank : undefined
  const title = position ? `${seat.name} — ${positionName(position)}` : seat.name

  return (
    <div
      className={`pseat pseat--${variant}`}
      data-acting={isActing ? 'true' : 'false'}
      data-folded={seat.folded ? 'true' : 'false'}
      data-out={seat.out ? 'true' : 'false'}
    >
      <div className="pseat__cards">
        {dealt ? (
          seat.hole.map((card, i) => (
            <CardView key={card.id} card={card} index={i} size={size} faceDown={!showCards} />
          ))
        ) : (
          <>
            <span className="pseat__ghost" aria-hidden="true" />
            <span className="pseat__ghost" aria-hidden="true" />
          </>
        )}

        {settled && seat.won > 0 && (
          <span className="pseat__won num">+{formatMoney(seat.won)}</span>
        )}
      </div>

      {rank && <span className="pseat__rank">{rank.label}</span>}

      <div className="pseat__plate" title={title}>
        {isButton && (
          <span className="pseat__puck" role="img" aria-label="Dealer button">
            D
          </span>
        )}
        <span className="pseat__name">{seat.name}</span>
        {position && <span className="pseat__pos">{position}</span>}
        <span className="pseat__stack num">{formatMoney(seat.stack)}</span>
      </div>

      <div className="pseat__status">
        {seat.out ? (
          <span className="pseat__tag">Sitting out</span>
        ) : seat.folded ? (
          <span className="pseat__tag">Folded</span>
        ) : seat.allIn ? (
          <span className="pseat__tag pseat__tag--gold">All-in</span>
        ) : null}

        {seat.streetCommit > 0 && (
          <ChipStack amount={seat.streetCommit} size="sm" maxChips={4} showTotal />
        )}
      </div>
    </div>
  )
}
