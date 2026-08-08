import type { ReactNode } from 'react'
import { ChevronIcon } from '../../../shared/ui/Icons'

export interface PanelProps {
  title: string
  icon?: ReactNode
  /** short right-aligned summary shown in the header, visible when collapsed */
  summary?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
}

/** Glassy dark collapsible panel — odds dock, event log. */
export function Panel({ title, icon, summary, open, onToggle, children, className }: PanelProps) {
  return (
    <section className={`panel${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button type="button" className="panel__head" onClick={onToggle} aria-expanded={open}>
        {icon && <span className="panel__icon">{icon}</span>}
        <span className="panel__title">{title}</span>
        {summary !== undefined && <span className="panel__summary">{summary}</span>}
        <span className="panel__chev">
          <ChevronIcon dir={open ? 'up' : 'down'} size={16} />
        </span>
      </button>
      {open && <div className="panel__body">{children}</div>}
    </section>
  )
}
