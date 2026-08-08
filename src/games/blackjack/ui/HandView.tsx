import { CardView, type CardSize } from '../../../shared/ui/CardView'
import { ChipStack } from '../../../shared/ui/ChipStack'
import { handLabel, handTotal, isBlackjack } from '../engine/hand'
import type { HandState } from '../types'
import { formatSignedMoney, outcomeLabel, outcomeTone } from './format'

export interface HandViewProps {
  hand: HandState
  size?: CardSize
  /** the hand currently acting (human or AI) — gets the glow ring */
  active?: boolean
  /** show the wagered chips under the cards */
  showBet?: boolean
  /** "Hand 2 of 3" tag when a seat has split */
  handIndex?: number
  handCount?: number
  /** the round has been paid out — only then is the chip delta final */
  settled?: boolean
}

export function HandView({
  hand,
  size = 'md',
  active = false,
  showBet = true,
  handIndex = 0,
  handCount = 1,
  settled = false,
}: HandViewProps) {
  const { total, soft } = handTotal(hand.cards)
  const natural = isBlackjack(hand.cards, hand.fromSplit)
  const bust = total > 21
  const outcome = hand.outcome
  // A hand can be marked 'bust' mid-round, long before payouts exist — showing
  // a delta then would be a guess, so wait for a payout or for settlement.
  const showDelta = outcome !== undefined && (settled || hand.payout !== undefined)
  const delta = (hand.payout ?? 0) - hand.bet
  const tone = outcome ? outcomeTone(outcome) : null

  let totalText = String(total)
  if (natural) totalText = 'BJ'
  else if (soft && total <= 21) totalText = `${total - 10}/${total}`

  return (
    <div
      className="hand"
      data-active={active ? 'true' : 'false'}
      data-tone={tone ?? 'none'}
      data-win={tone === 'win' ? 'true' : 'false'}
    >
      <div className="hand__cards">
        {hand.cards.map((card, i) => (
          <CardView key={card.id} card={card} index={i} size={size} />
        ))}

        {outcome && (
          <span className={`hand__badge hand__badge--${tone}`}>
            <b>{outcomeLabel(outcome).toUpperCase()}</b>
            {showDelta && <i className="num">{formatSignedMoney(delta)}</i>}
          </span>
        )}
      </div>

      <div className="hand__foot">
        {hand.cards.length > 0 && (
          <span
            className="hand__total num"
            data-bust={bust ? 'true' : 'false'}
            data-natural={natural ? 'true' : 'false'}
            title={handLabel(hand.cards)}
          >
            {totalText}
          </span>
        )}

        {handCount > 1 && (
          <span className="hand__tag">
            {handIndex + 1}/{handCount}
          </span>
        )}

        {hand.doubled && <span className="hand__tag hand__tag--gold">2×</span>}

        {showBet && hand.bet > 0 && (
          <ChipStack amount={hand.bet} size="sm" maxChips={5} showTotal />
        )}
      </div>
    </div>
  )
}
