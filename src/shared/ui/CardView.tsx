import type { Card } from '../cards'
import { SUIT_SYMBOL, isRedSuit } from '../cards'
import { cssVars } from './cssVars'
import './cards.css'

export type CardSize = 'sm' | 'md' | 'lg'

const FACE_RANKS = new Set(['J', 'Q', 'K'])

const SUIT_NAME: Record<Card['suit'], string> = {
  spades: 'spades',
  hearts: 'hearts',
  diamonds: 'diamonds',
  clubs: 'clubs',
}

export interface CardViewProps {
  card: Card
  /** render the back until the hole card is revealed (animates a 3D flip) */
  faceDown?: boolean
  size?: CardSize
  /** position in the hand — drives fan tilt and overlap */
  index?: number
  /** skip the deal-in animation (e.g. cards restored, not dealt) */
  noDeal?: boolean
}

/**
 * A single playing card. The wrapper owns the deal-in animation (keyed by the
 * card's stable `id` in the parent), the inner element owns the 3D flip so the
 * two never fight over `transform`.
 */
export function CardView({ card, faceDown = false, size = 'md', index = 0, noDeal = false }: CardViewProps) {
  const symbol = SUIT_SYMBOL[card.suit]
  const red = isRedSuit(card.suit)
  const isFace = FACE_RANKS.has(card.rank)
  const label = faceDown ? 'Face-down card' : `${card.rank} of ${SUIT_NAME[card.suit]}`

  return (
    <div
      className={`pcard${noDeal ? ' pcard--static' : ''}`}
      data-size={size}
      data-down={faceDown ? 'true' : 'false'}
      style={cssVars({ '--i': index })}
      role="img"
      aria-label={label}
    >
      <div className="pcard__inner">
        <div className="pcard__face pcard__front" data-red={red ? 'true' : 'false'}>
          <span className="pcard__corner pcard__corner--tl" aria-hidden="true">
            <b>{card.rank}</b>
            <i>{symbol}</i>
          </span>

          {isFace ? (
            <span className="pcard__monogram" aria-hidden="true">
              <b>{card.rank}</b>
              <i>{symbol}</i>
            </span>
          ) : (
            <span className="pcard__pip" aria-hidden="true">
              {symbol}
            </span>
          )}

          <span className="pcard__corner pcard__corner--br" aria-hidden="true">
            <b>{card.rank}</b>
            <i>{symbol}</i>
          </span>
        </div>

        <div className="pcard__face pcard__back" aria-hidden="true">
          <span className="pcard__backmark">♠</span>
        </div>
      </div>
    </div>
  )
}
