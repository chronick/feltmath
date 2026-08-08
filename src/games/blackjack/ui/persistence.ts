import type { RulesConfig, SessionStats } from '../types'
import { DEFAULT_RULES } from '../types'

const STORAGE_KEY = 'bjt-v1'

export interface PersistedSession {
  rules: RulesConfig
  bankroll: number
  stats: SessionStats
}

const EMPTY_STATS: SessionStats = {
  rounds: 0,
  handsPlayed: 0,
  handsWon: 0,
  handsLost: 0,
  handsPushed: 0,
  blackjacks: 0,
  net: 0,
  hintsMatched: 0,
  hintsTotal: 0,
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function coerceRules(raw: unknown): RulesConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_RULES
  const r = raw as Record<string, unknown>
  const decks = num(r.decks, DEFAULT_RULES.decks)
  const validDecks: RulesConfig['decks'][] = [1, 2, 4, 6, 8]
  const doubleOnRaw = r.doubleOn
  const doubleOn: RulesConfig['doubleOn'] =
    doubleOnRaw === 'any2' || doubleOnRaw === '9to11' || doubleOnRaw === '10to11'
      ? doubleOnRaw
      : DEFAULT_RULES.doubleOn

  return {
    decks: validDecks.includes(decks as RulesConfig['decks'])
      ? (decks as RulesConfig['decks'])
      : DEFAULT_RULES.decks,
    dealerHitsSoft17: bool(r.dealerHitsSoft17, DEFAULT_RULES.dealerHitsSoft17),
    blackjackPayout: num(r.blackjackPayout, DEFAULT_RULES.blackjackPayout) === 1.2 ? 1.2 : 1.5,
    doubleAfterSplit: bool(r.doubleAfterSplit, DEFAULT_RULES.doubleAfterSplit),
    doubleOn,
    maxSplitHands: Math.min(4, Math.max(2, Math.round(num(r.maxSplitHands, DEFAULT_RULES.maxSplitHands)))),
    resplitAces: bool(r.resplitAces, DEFAULT_RULES.resplitAces),
    hitSplitAces: bool(r.hitSplitAces, DEFAULT_RULES.hitSplitAces),
    lateSurrender: bool(r.lateSurrender, DEFAULT_RULES.lateSurrender),
    insurance: bool(r.insurance, DEFAULT_RULES.insurance),
    penetration: Math.min(0.9, Math.max(0.5, num(r.penetration, DEFAULT_RULES.penetration))),
    aiPlayers: Math.min(6, Math.max(0, Math.round(num(r.aiPlayers, DEFAULT_RULES.aiPlayers)))),
  }
}

function coerceStats(raw: unknown): SessionStats {
  if (!raw || typeof raw !== 'object') return EMPTY_STATS
  const s = raw as Record<string, unknown>
  return {
    rounds: num(s.rounds, 0),
    handsPlayed: num(s.handsPlayed, 0),
    handsWon: num(s.handsWon, 0),
    handsLost: num(s.handsLost, 0),
    handsPushed: num(s.handsPushed, 0),
    blackjacks: num(s.blackjacks, 0),
    net: num(s.net, 0),
    hintsMatched: num(s.hintsMatched, 0),
    hintsTotal: num(s.hintsTotal, 0),
  }
}

/** Rules + bankroll + stats survive a reload; the shoe is always fresh. */
export function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      rules: coerceRules(parsed.rules),
      bankroll: Math.max(0, num(parsed.bankroll, 0)),
      stats: coerceStats(parsed.stats),
    }
  } catch {
    return null
  }
}

export function saveSession(session: PersistedSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* private mode / quota — persistence is a nicety, never a blocker */
  }
}
