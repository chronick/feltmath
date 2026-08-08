import type { HoldemConfig, HoldemStats } from '../types'
import { DEFAULT_HOLDEM } from '../types'

const STORAGE_KEY = 'bjt-holdem-v1'

export interface PersistedHoldem {
  config: HoldemConfig
  /** the human's chips at rest (between hands) */
  stack: number
  stats: HoldemStats
}

export const EMPTY_HOLDEM_STATS: HoldemStats = {
  hands: 0,
  handsWon: 0,
  net: 0,
  vpipHands: 0,
  showdowns: 0,
  showdownsWon: 0,
}

/** Sample counts the settings modal offers — anything else falls back. */
export const EQUITY_SAMPLE_OPTIONS: readonly number[] = [1000, 5000, 10000]

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function coerceConfig(raw: unknown): HoldemConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_HOLDEM
  const c = raw as Record<string, unknown>

  const smallBlind = Math.max(1, Math.round(num(c.smallBlind, DEFAULT_HOLDEM.smallBlind)))
  const bigBlind = Math.max(smallBlind + 1, Math.round(num(c.bigBlind, DEFAULT_HOLDEM.bigBlind)))
  const samples = Math.round(num(c.equitySamples, DEFAULT_HOLDEM.equitySamples))

  return {
    aiPlayers: Math.min(5, Math.max(1, Math.round(num(c.aiPlayers, DEFAULT_HOLDEM.aiPlayers)))),
    smallBlind,
    bigBlind,
    buyIn: Math.max(bigBlind * 10, Math.round(num(c.buyIn, DEFAULT_HOLDEM.buyIn))),
    topUp: bool(c.topUp, DEFAULT_HOLDEM.topUp),
    equitySamples: EQUITY_SAMPLE_OPTIONS.includes(samples)
      ? samples
      : DEFAULT_HOLDEM.equitySamples,
  }
}

function coerceStats(raw: unknown): HoldemStats {
  if (!raw || typeof raw !== 'object') return EMPTY_HOLDEM_STATS
  const s = raw as Record<string, unknown>
  return {
    hands: num(s.hands, 0),
    handsWon: num(s.handsWon, 0),
    net: num(s.net, 0),
    vpipHands: num(s.vpipHands, 0),
    showdowns: num(s.showdowns, 0),
    showdownsWon: num(s.showdownsWon, 0),
  }
}

/** Config + the human's stack + stats survive a reload; the deck is always fresh. */
export function loadHoldem(): PersistedHoldem | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      config: coerceConfig(parsed.config),
      stack: Math.max(0, num(parsed.stack, 0)),
      stats: coerceStats(parsed.stats),
    }
  } catch {
    return null
  }
}

export function saveHoldem(session: PersistedHoldem): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* private mode / quota — persistence is a nicety, never a blocker */
  }
}
