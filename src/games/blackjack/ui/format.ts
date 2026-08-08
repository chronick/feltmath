import type { Action, HandOutcome, RulesConfig } from '../types'

const MINUS = '−' // true minus sign — lines up with tabular numerals

/** Money, never rendered negative for bankrolls (free-play can't go below 0). */
export function formatMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0
  return `$${safe.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/** Signed money for deltas: "+$120" / "−$45" / "$0". */
export function formatSignedMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0
  if (safe === 0) return '$0'
  const abs = Math.abs(safe)
  const sign = safe > 0 ? '+' : MINUS
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

// NOTE: percentage and EV formatting live in `../odds` (formatPct / formatEV)
// so the numbers the odds engine produces are rendered by the module that
// owns them. Don't add a second implementation here.

export function actionLabel(action: Action): string {
  switch (action) {
    case 'hit':
      return 'Hit'
    case 'stand':
      return 'Stand'
    case 'double':
      return 'Double'
    case 'split':
      return 'Split'
    case 'surrender':
      return 'Surrender'
  }
}

/** Past tense for the post-action toast: "you stood", "you doubled". */
export function actionPast(action: Action): string {
  switch (action) {
    case 'hit':
      return 'hit'
    case 'stand':
      return 'stood'
    case 'double':
      return 'doubled'
    case 'split':
      return 'split'
    case 'surrender':
      return 'surrendered'
  }
}

export function outcomeLabel(outcome: HandOutcome): string {
  switch (outcome) {
    case 'win':
      return 'Win'
    case 'lose':
      return 'Lose'
    case 'push':
      return 'Push'
    case 'blackjack':
      return 'Blackjack'
    case 'bust':
      return 'Bust'
    case 'surrender':
      return 'Surrender'
  }
}

/** win / lose / neutral — drives badge colour. */
export function outcomeTone(outcome: HandOutcome): 'win' | 'lose' | 'push' {
  switch (outcome) {
    case 'win':
    case 'blackjack':
      return 'win'
    case 'push':
      return 'push'
    case 'lose':
    case 'bust':
    case 'surrender':
      return 'lose'
  }
}

/** "6 decks · H17 · 3:2 · DAS · LS" — shown in the book modal and top bar. */
export function rulesSummary(rules: RulesConfig): string {
  const parts: string[] = [
    `${rules.decks} deck${rules.decks === 1 ? '' : 's'}`,
    rules.dealerHitsSoft17 ? 'H17' : 'S17',
    rules.blackjackPayout === 1.5 ? '3:2' : '6:5',
    rules.doubleAfterSplit ? 'DAS' : 'no DAS',
  ]
  if (rules.doubleOn === '9to11') parts.push('D9-11')
  if (rules.doubleOn === '10to11') parts.push('D10-11')
  if (rules.lateSurrender) parts.push('LS')
  return parts.join(' · ')
}
