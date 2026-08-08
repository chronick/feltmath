import type { ReactNode } from 'react'
import { CardView } from '../../../shared/ui/CardView'
import { ChipStack } from '../../../shared/ui/ChipStack'
import { potTotal } from '../engine/game'
import type { HoldemState, Position } from '../types'
import { PokerSeat } from './PokerSeat'
import { formatMoney, streetLabel } from './format'

export interface PokerTableProps {
  state: HoldemState
  /** seat id → position tag; null between hands, when positions mean nothing */
  positions: Record<number, Position> | null
  /** overlays rendered on the felt */
  children?: ReactNode
}

const BOARD_SLOTS = 5

function potLabel(index: number, count: number): string {
  if (index === 0) return count > 1 ? 'Main' : 'Pot'
  return `Side ${index}`
}

export function PokerTable({ state, positions, children }: PokerTableProps) {
  const aiSeats = state.seats.filter((seat) => seat.kind === 'ai')
  const human = state.seats.find((seat) => seat.kind === 'human')
  const acting = state.phase === 'betting' ? state.seats[state.actingIndex] : undefined
  const buttonSeat = state.seats[state.button]
  const pot = potTotal(state)
  const settled = state.phase === 'settlement'
  // Side pots only mean something inside a hand — never carry a stale set into
  // the next deal, whatever the engine leaves behind at idle.
  const sidePots = state.phase !== 'idle' && state.pots.length > 1 ? state.pots : []

  return (
    <section className="ptable" aria-label="Hold'em table">
      <div className="ptable__felt">
        <div className="ptable__oval" aria-hidden="true" />

        <div className="ptable__seats" data-count={aiSeats.length}>
          {aiSeats.map((seat) => (
            <PokerSeat
              key={seat.id}
              seat={seat}
              variant="ai"
              position={positions?.[seat.id]}
              isButton={buttonSeat?.id === seat.id}
              isActing={acting?.id === seat.id}
              showCards={seat.revealed}
              settled={settled}
            />
          ))}
        </div>

        <div className="ptable__center">
          <div className="ptable__board" role="group" aria-label="Community cards">
            {Array.from({ length: BOARD_SLOTS }, (_, i) => {
              const card = state.board[i]
              if (!card) return <span key={`slot-${i}`} className="ptable__slot" aria-hidden="true" />
              // index 0 for every board card: the board lies flat, no fan tilt
              return <CardView key={card.id} card={card} index={0} size="md" />
            })}
          </div>

          <div className="ptable__pot">
            <span className="smallcaps">{streetLabel(state.street)} pot</span>
            <ChipStack amount={pot} size="sm" maxChips={6} showTotal={false} />
            <strong className="ptable__potnum num">{formatMoney(pot)}</strong>
          </div>

          {sidePots.length > 0 && (
            <ul className="ptable__pots">
              {sidePots.map((entry, i) => (
                <li key={`pot-${i}`} className="ptable__potchip">
                  <span>{potLabel(i, sidePots.length)}</span>
                  <b className="num">{formatMoney(entry.amount)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>

        {human && (
          <div className="ptable__human">
            <PokerSeat
              seat={human}
              variant="human"
              position={positions?.[human.id]}
              isButton={buttonSeat?.id === human.id}
              isActing={acting?.id === human.id}
              showCards
              settled={settled}
            />
          </div>
        )}

        {children}
      </div>
    </section>
  )
}
