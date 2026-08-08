import './kbd.css'

/**
 * Keyboard-shortcut chip shown inside buttons. Hidden on touch-only devices
 * (no keyboard, no clutter) via the hover media query in kbd.css.
 */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="kbd" aria-hidden="true">
      {children}
    </kbd>
  )
}
