import type { ReactNode } from 'react'
import { cssVars } from '../../../shared/ui/cssVars'
import type { GameState } from '../types'
import { DealerArea } from './DealerArea'
import { SeatView } from './SeatView'

export interface TableProps {
  state: GameState
  /** overlays rendered on the felt: insurance prompt, toast */
  children?: ReactNode
}

function Shoe({ remaining, total, reshufflePending }: { remaining: number; total: number; reshufflePending: boolean }) {
  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
  return (
    <div className="shoe" title={`${remaining} cards left in the shoe`}>
      <div className="shoe__body" aria-hidden="true">
        <span className="shoe__fill" style={cssVars({ '--fill': `${Math.round(pct * 100)}%` })} />
      </div>
      <span className="shoe__meta num">
        {remaining}
        <i>cards</i>
      </span>
      {reshufflePending && <span className="shoe__flag">shuffle next</span>}
    </div>
  )
}

export function Table({ state, children }: TableProps) {
  const aiSeats = state.seats.filter((seat) => seat.kind === 'ai')
  const human = state.seats.find((seat) => seat.kind === 'human')
  const activeSeat = state.phase === 'playerTurns' ? state.seats[state.activeSeatIndex] : undefined
  const shoeTotal = state.rules.decks * 52
  const centre = (aiSeats.length - 1) / 2

  return (
    <section className="table" aria-label="Blackjack table">
      <div className="table__felt">
        <div className="table__arcline" aria-hidden="true" />

        <div className="table__top">
          <DealerArea dealer={state.dealer} phase={state.phase} />
          <Shoe
            remaining={state.shoe.length}
            total={shoeTotal}
            reshufflePending={state.reshufflePending}
          />
        </div>

        {aiSeats.length > 0 && (
          <div className="table__ai" data-count={aiSeats.length}>
            {aiSeats.map((seat, i) => (
              <SeatView
                key={seat.id}
                seat={seat}
                variant="ai"
                phase={state.phase}
                isActiveSeat={activeSeat?.id === seat.id}
                arcOffset={-Math.round(Math.abs(i - centre) * 11)}
              />
            ))}
          </div>
        )}

        {human && (
          <div className="table__human">
            <SeatView
              seat={human}
              variant="human"
              phase={state.phase}
              isActiveSeat={activeSeat?.id === human.id}
            />
          </div>
        )}

        {children}
      </div>
    </section>
  )
}
