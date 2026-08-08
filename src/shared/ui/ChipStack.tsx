import './chips.css'

/** Denominations the trainer bets in, largest first (canonical 5/25/100/500). */
export const CHIP_DENOMS: readonly number[] = [500, 100, 25, 5]

interface ChipPalette {
  body: string
  edge: string
  spot: string
  text: string
}

const PALETTES: Record<number, ChipPalette> = {
  5: { body: '#c0392b', edge: '#8b2a20', spot: '#f6f1e6', text: '#fff8ee' },
  25: { body: '#16794f', edge: '#0e5437', spot: '#f6f1e6', text: '#f2fff8' },
  100: { body: '#2c3e50', edge: '#1a2733', spot: '#e9eef3', text: '#eef4fa' },
  500: { body: '#7d4fa8', edge: '#553477', spot: '#f2ebf8', text: '#f8f2ff' },
}

const FALLBACK: ChipPalette = { body: '#8a6d1f', edge: '#5d4913', spot: '#f6efd8', text: '#fff6dd' }

/**
 * Greedy decomposition into chips. The 5/25/100/500 ladder is canonical, so
 * greedy is exact for any multiple of 5 — which is every bet the UI can build.
 */
export function chipBreakdown(amount: number): number[] {
  const out: number[] = []
  let left = Math.max(0, Math.floor(amount))
  for (const denom of CHIP_DENOMS) {
    while (left >= denom) {
      out.push(denom)
      left -= denom
    }
  }
  return out
}

export interface ChipProps {
  denom: number
  /** pixel diameter */
  size?: number
}

/** A single casino chip, drawn as inline SVG (no icon library). */
export function Chip({ denom, size = 34 }: ChipProps) {
  const p = PALETTES[denom] ?? FALLBACK
  const spots = [0, 45, 90, 135, 180, 225, 270, 315]
  const fontSize = denom >= 100 ? 17 : 21

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`$${denom} chip`}
      focusable="false"
    >
      <circle cx="32" cy="32" r="31" fill={p.edge} />
      {spots.map((deg) => (
        <rect
          key={deg}
          x="27.5"
          y="0.75"
          width="9"
          height="8.5"
          rx="1.6"
          fill={p.spot}
          opacity="0.92"
          transform={`rotate(${deg} 32 32)`}
        />
      ))}
      <circle cx="32" cy="32" r="24.5" fill={p.body} stroke="rgba(0,0,0,.32)" strokeWidth="1" />
      <circle
        cx="32"
        cy="32"
        r="19"
        fill="none"
        stroke="rgba(255,255,255,.42)"
        strokeWidth="1.4"
        strokeDasharray="3.6 3.6"
      />
      <text
        x="32"
        y="32"
        textAnchor="middle"
        dominantBaseline="central"
        fill={p.text}
        fontSize={fontSize}
        fontWeight="800"
        fontFamily="var(--font)"
      >
        {denom}
      </text>
    </svg>
  )
}

export interface ChipStackProps {
  amount: number
  size?: 'sm' | 'md'
  /** show the numeric total alongside the chips */
  showTotal?: boolean
  /** when set, each chip becomes a button that removes that denomination */
  onRemove?: (denom: number) => void
  /** cap on rendered coins before collapsing into a "+n" marker */
  maxChips?: number
  className?: string
}

/**
 * A wagered stack. Chips are keyed per (denomination, ordinal) so removing one
 * chip doesn't restart the toss animation for every other chip in the stack.
 */
export function ChipStack({
  amount,
  size = 'md',
  showTotal = true,
  onRemove,
  maxChips = 10,
  className,
}: ChipStackProps) {
  const chips = chipBreakdown(amount)
  const visible = chips.slice(0, maxChips)
  const hidden = chips.length - visible.length
  const px = size === 'sm' ? 22 : 32
  const seen = new Map<number, number>()

  return (
    <div className={`chipstack chipstack--${size}${className ? ` ${className}` : ''}`}>
      {chips.length > 0 && (
        <span className="chipstack__row">
          {visible.map((denom) => {
            const ordinal = (seen.get(denom) ?? 0) + 1
            seen.set(denom, ordinal)
            const key = `${denom}-${ordinal}`
            if (!onRemove) {
              return (
                <span key={key} className="chipstack__slot" data-clickable="false">
                  <Chip denom={denom} size={px} />
                </span>
              )
            }
            return (
              <button
                key={key}
                type="button"
                className="chipstack__slot"
                data-clickable="true"
                onClick={() => onRemove(denom)}
                title={`Remove $${denom}`}
                aria-label={`Remove $${denom} chip from bet`}
              >
                <Chip denom={denom} size={px} />
              </button>
            )
          })}
          {hidden > 0 && <span className="chipstack__more">+{hidden}</span>}
        </span>
      )}
      {showTotal && (
        <span key={amount} className="chipstack__total num">
          ${amount.toLocaleString('en-US')}
        </span>
      )}
    </div>
  )
}
