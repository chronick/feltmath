import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../../shared/ui/Modal'
import { cssVars } from '../../../shared/ui/cssVars'
import { bookTables } from '../strategy/book'
import type { BookCode, BookTable, RulesConfig, StrategyAdvice } from '../types'
import { rulesSummary } from './format'

export interface BookModalProps {
  rules: RulesConfig
  /** cell to scroll to and pulse — set when opened from a hint */
  highlight: StrategyAdvice['cell'] | null
  onClose: () => void
}

type TabId = 'hard' | 'soft' | 'pairs'

const TABS: { id: TabId; label: string }[] = [
  { id: 'hard', label: 'Hard' },
  { id: 'soft', label: 'Soft' },
  { id: 'pairs', label: 'Pairs' },
]

const CODE_TONE: Record<BookCode, string> = {
  H: 'h',
  S: 's',
  D: 'd',
  Ds: 'd',
  P: 'p',
  Ph: 'p',
  Rh: 'r',
  Rs: 'r',
}

const LEGEND: { code: BookCode; text: string }[] = [
  { code: 'H', text: 'Hit' },
  { code: 'S', text: 'Stand' },
  { code: 'D', text: 'Double, else hit' },
  { code: 'Ds', text: 'Double, else stand' },
  { code: 'P', text: 'Split' },
  { code: 'Ph', text: 'Split if DAS, else hit' },
  { code: 'Rh', text: 'Surrender, else hit' },
  { code: 'Rs', text: 'Surrender, else stand' },
]

function Grid({
  table,
  tab,
  highlight,
  registerCell,
}: {
  table: BookTable
  tab: TabId
  highlight: StrategyAdvice['cell'] | null
  registerCell: (key: string, el: HTMLElement | null) => void
}) {
  const active = highlight && highlight.table === tab ? highlight : null

  return (
    <div
      className="book__grid"
      style={cssVars({ '--cols': table.cols.length })}
      role="table"
      aria-label={`${tab} totals basic strategy`}
    >
      <div className="book__row book__row--head" role="row">
        <span className="book__corner" role="columnheader">
          vs
        </span>
        {table.cols.map((col) => (
          <span
            className="book__col"
            key={col}
            role="columnheader"
            data-on={active?.col === col ? 'true' : 'false'}
          >
            {col}
          </span>
        ))}
      </div>

      {table.rows.map((row, r) => (
        <div className="book__row" key={row} role="row">
          <span className="book__rowlabel" role="rowheader" data-on={active?.row === row ? 'true' : 'false'}>
            {row}
          </span>
          {table.cols.map((col, c) => {
            const code = table.cells[r]?.[c] ?? 'H'
            const on = active?.row === row && active?.col === col
            return (
              <span
                key={col}
                role="cell"
                className="book__cell"
                data-tone={CODE_TONE[code]}
                data-on={on ? 'true' : 'false'}
                ref={(el) => {
                  registerCell(`${tab}|${row}|${col}`, el)
                }}
                title={`${row} vs ${col}: ${code}`}
              >
                {code}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function BookModal({ rules, highlight, onClose }: BookModalProps) {
  const tables = useMemo(() => bookTables(rules), [rules])
  const [tab, setTab] = useState<TabId>(highlight?.table ?? 'hard')
  const cells = useRef(new Map<string, HTMLElement>())

  const registerCell = (key: string, el: HTMLElement | null) => {
    if (el) cells.current.set(key, el)
    else cells.current.delete(key)
  }

  useEffect(() => {
    if (!highlight || highlight.table !== tab) return
    const el = cells.current.get(`${tab}|${highlight.row}|${highlight.col}`)
    el?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [highlight, tab])

  const table = tables[tab]

  return (
    <Modal title="The book" subtitle={rulesSummary(rules)} onClose={onClose}>
      <div className="book">
        <div className="book__tabs" role="tablist" aria-label="Strategy tables">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`book__tab${tab === entry.id ? ' is-active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="book__scroll">
          <Grid table={table} tab={tab} highlight={highlight} registerCell={registerCell} />
        </div>

        <ul className="book__legend">
          {LEGEND.map((item) => (
            <li key={item.code}>
              <i className="book__swatch" data-tone={CODE_TONE[item.code]}>
                {item.code}
              </i>
              {item.text}
            </li>
          ))}
        </ul>

        <p className="book__foot">
          Rows are your hand, columns are the dealer&apos;s upcard. This chart is generated from
          the rules currently in play, so it already accounts for{' '}
          {rules.dealerHitsSoft17 ? 'the dealer hitting soft 17' : 'the dealer standing on soft 17'}
          {rules.doubleAfterSplit ? ' and doubling after a split' : ' and no doubling after a split'}.
        </p>
      </div>
    </Modal>
  )
}
