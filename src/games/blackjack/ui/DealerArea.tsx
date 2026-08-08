import { CardView } from '../../../shared/ui/CardView'
import { handTotal } from '../engine/hand'
import type { DealerState, Phase } from '../types'

export interface DealerAreaProps {
  dealer: DealerState
  phase: Phase
}

export function DealerArea({ dealer, phase }: DealerAreaProps) {
  const revealed = dealer.holeRevealed
  const visible = revealed ? dealer.cards : dealer.cards.slice(0, 1)
  const { total, soft } = handTotal(visible)
  const bust = revealed && total > 21
  const natural = revealed && dealer.cards.length === 2 && total === 21

  let readout = '—'
  if (dealer.cards.length > 0) {
    if (natural) readout = 'BJ'
    else if (soft && total <= 21) readout = `${total - 10}/${total}`
    else readout = String(total)
  }

  const status =
    phase === 'peek'
      ? 'Checking hole card…'
      : phase === 'dealerTurn'
        ? 'Dealer plays'
        : revealed
          ? 'Dealer'
          : 'Showing'

  return (
    <section className="dealer" aria-label="Dealer">
      <div className="dealer__label">
        <span className="smallcaps">{status}</span>
        <span
          className="dealer__total num"
          data-bust={bust ? 'true' : 'false'}
          data-natural={natural ? 'true' : 'false'}
        >
          {readout}
        </span>
      </div>

      <div className="dealer__cards">
        {dealer.cards.map((card, i) => (
          <CardView
            key={card.id}
            card={card}
            index={i}
            size="md"
            faceDown={i === 1 && !revealed}
          />
        ))}
        {dealer.cards.length === 0 && <div className="dealer__ghost" aria-hidden="true" />}
      </div>
    </section>
  )
}
