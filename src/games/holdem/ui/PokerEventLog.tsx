import { useEffect, useRef } from 'react'
import { ListIcon } from '../../../shared/ui/Icons'
import type { HoldemEvent } from '../types'
import { Panel } from './Panel'

export interface PokerEventLogProps {
  events: HoldemEvent[]
  open: boolean
  onToggle: () => void
}

const MAX_ROWS = 10

export function PokerEventLog({ events, open, onToggle }: PokerEventLogProps) {
  const scrollRef = useRef<HTMLOListElement>(null)
  const recent = events.slice(-MAX_ROWS)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events, open])

  const latest = events.length > 0 ? events[events.length - 1].text : 'No action yet'

  return (
    <Panel
      title="Log"
      icon={<ListIcon size={16} />}
      summary={<span className="plog__summary">{latest}</span>}
      open={open}
      onToggle={onToggle}
      className="hpanel--log"
    >
      {recent.length === 0 ? (
        <p className="plog__empty">Hand events show up here.</p>
      ) : (
        <ol className="plog" ref={scrollRef}>
          {recent.map((event, index) => (
            <li
              className="plog__row"
              key={`${events.length - recent.length + index}`}
              data-kind={event.kind}
            >
              <span className="plog__kind">{event.kind}</span>
              <span className="plog__text">{event.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
