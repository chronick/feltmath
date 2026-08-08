import type { CSSProperties } from 'react'

/**
 * Custom CSS properties aren't in React's CSSProperties type; this keeps the
 * cast in exactly one place instead of sprinkling `as CSSProperties` around.
 */
export function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties
}
