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

/**
 * Glassy dark collapsible panel for the dock (equity + log). Same shape as the
 * blackjack panel, own class names so hold'em never depends on blackjack.css.
 */
export function Panel({ title, icon, summary, open, onToggle, children, className }: PanelProps) {
  return (
    <section className={`hpanel${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button type="button" className="hpanel__head" onClick={onToggle} aria-expanded={open}>
        {icon && <span className="hpanel__icon">{icon}</span>}
        <span className="hpanel__title">{title}</span>
        {summary !== undefined && <span className="hpanel__summary">{summary}</span>}
        <span className="hpanel__chev">
          <ChevronIcon dir={open ? 'up' : 'down'} size={16} />
        </span>
      </button>
      {open && <div className="hpanel__body">{children}</div>}
    </section>
  )
}
