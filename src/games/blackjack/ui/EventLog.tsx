import { useEffect, useRef } from 'react'
import { ListIcon } from '../../../shared/ui/Icons'
import type { GameEvent } from '../types'
import { Panel } from './Panel'

export interface EventLogProps {
  events: GameEvent[]
  open: boolean
  onToggle: () => void
}

const MAX_ROWS = 8

export function EventLog({ events, open, onToggle }: EventLogProps) {
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
      summary={<span className="log__summary">{latest}</span>}
      open={open}
      onToggle={onToggle}
      className="panel--log"
    >
      {recent.length === 0 ? (
        <p className="log__empty">Round events show up here.</p>
      ) : (
        <ol className="log" ref={scrollRef}>
          {recent.map((event, index) => (
            <li className="log__row" key={`${events.length - recent.length + index}`} data-kind={event.kind}>
              <span className="log__kind">{event.kind}</span>
              <span className="log__text">{event.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
