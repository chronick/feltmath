import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../../shared/ui/Modal'
import { rfiChart, vsOpenChart } from '../strategy/ranges'
import type { ComboKey, Position, RangeAction } from '../types'

export type RangeMode = 'rfi' | 'vsOpen'

export interface RangesModalProps {
  /** tab to open on — the hero's position when known */
  position: Position
  /** RFI chart or the facing-an-open chart */
  mode: RangeMode
  /** cell to pulse — the hand actually held, when there is one */
  combo: ComboKey | null
  onClose: () => void
}

/** Poker grid order: aces top-left, deuces bottom-right. 'T' not '10'. */
const GRID_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const

const POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']

const MODES: { id: RangeMode; label: string }[] = [
  { id: 'rfi', label: 'Open (first in)' },
  { id: 'vsOpen', label: 'vs open' },
]

const LEGEND: { action: RangeAction; text: string }[] = [
  { action: 'raise', text: 'Raise' },
  { action: 'call', text: 'Call' },
  { action: 'mixed', text: 'Mixed' },
  { action: 'fold', text: 'Fold' },
]

/** row/col index → the standard 169-combo key (suited above the diagonal). */
function comboAt(row: number, col: number): ComboKey {
  const a = GRID_RANKS[row]
  const b = GRID_RANKS[col]
  if (row === col) return `${a}${a}`
  return row < col ? `${a}${b}s` : `${b}${a}o`
}

export function RangesModal({ position, mode, combo, onClose }: RangesModalProps) {
  const [tab, setTab] = useState<Position>(position)
  const [view, setView] = useState<RangeMode>(mode)
  const cells = useRef(new Map<ComboKey, HTMLElement>())

  const chart = useMemo(() => (view === 'rfi' ? rfiChart(tab) : vsOpenChart(tab)), [view, tab])

  // Only pulse the held hand on the chart the advice actually came from.
  const highlight = combo && tab === position && view === mode ? combo : null

  useEffect(() => {
    if (!highlight) return
    cells.current.get(highlight)?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [highlight, chart])

  return (
    <Modal title="Ranges" subtitle={chart.situation} onClose={onClose}>
      <div className="ranges">
        <div className="ranges__modes" role="tablist" aria-label="Range situation">
          {MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={view === entry.id}
              className={`ranges__mode${view === entry.id ? ' is-active' : ''}`}
              onClick={() => setView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="ranges__tabs" role="tablist" aria-label="Position">
          {POSITIONS.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={tab === entry}
              className={`ranges__tab${tab === entry ? ' is-active' : ''}`}
              onClick={() => setTab(entry)}
            >
              {entry}
            </button>
          ))}
        </div>

        <div className="ranges__scroll">
          <div className="ranges__grid" role="table" aria-label={`${tab} ${chart.situation}`}>
            {GRID_RANKS.map((_, row) => (
              <div className="ranges__row" key={`row-${row}`} role="row">
                {GRID_RANKS.map((__, col) => {
                  const key = comboAt(row, col)
                  const action: RangeAction = chart.cells[key] ?? 'fold'
                  const on = highlight === key
                  return (
                    <span
                      key={key}
                      role="cell"
                      className="ranges__cell"
                      data-action={action}
                      data-on={on ? 'true' : 'false'}
                      title={`${key}: ${action}`}
                      ref={(el) => {
                        if (el) cells.current.set(key, el)
                        else cells.current.delete(key)
                      }}
                    >
                      {key}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <ul className="ranges__legend">
          {LEGEND.map((item) => (
            <li key={item.action}>
              <i className="ranges__swatch" data-action={item.action} />
              {item.text}
            </li>
          ))}
        </ul>

        <p className="ranges__foot">
          Pairs run down the diagonal, suited hands sit above it, offsuit below. These are a solid
          6-max baseline to train against, not solver output — deviations against specific players
          are the next layer.
        </p>
      </div>
    </Modal>
  )
}
