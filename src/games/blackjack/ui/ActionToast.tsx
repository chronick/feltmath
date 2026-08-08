export interface ActionToastProps {
  text: string
  matched: boolean
}

/** Transient feedback after each human decision (see BlackjackGame for timing). */
export function ActionToast({ text, matched }: ActionToastProps) {
  return (
    <div
      className="toast"
      data-ok={matched ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  )
}
