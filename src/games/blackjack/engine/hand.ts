// Blackjack hand math — pure functions over cards, no game state.

import type { Card, Rank } from '../../../shared/cards'

/**
 * Pip value of a rank. Aces count 1 here; `handTotal` promotes one ace to 11
 * when that keeps the hand at or under 21.
 */
export function cardValue(rank: Rank): number {
  switch (rank) {
    case 'A':
      return 1
    case '10':
    case 'J':
    case 'Q':
    case 'K':
      return 10
    default:
      return Number(rank)
  }
}

/**
 * Best total for a hand plus whether it is soft (an ace is counted as 11).
 * Only one ace can ever be soft, so this is a single +10 promotion.
 */
export function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0
  let aces = 0
  for (const card of cards) {
    total += cardValue(card.rank)
    if (card.rank === 'A') aces++
  }
  const soft = aces > 0 && total + 10 <= 21
  return { total: soft ? total + 10 : total, soft }
}

/** Natural 21: exactly two cards totalling 21, and not the product of a split. */
export function isBlackjack(cards: Card[], fromSplit: boolean): boolean {
  return !fromSplit && cards.length === 2 && handTotal(cards).total === 21
}

/**
 * Display label: "Soft 18", "Hard 16", "Blackjack", "Bust (23)".
 *
 * The contract signature has no split flag, so any two-card 21 labels as
 * "Blackjack". Game logic must use `isBlackjack(cards, hand.fromSplit)` — a
 * two-card 21 off a split pays even money, not 3:2.
 */
export function handLabel(cards: Card[]): string {
  const { total, soft } = handTotal(cards)
  if (cards.length === 2 && total === 21) return 'Blackjack'
  if (total > 21) return `Bust (${total})`
  return `${soft ? 'Soft' : 'Hard'} ${total}`
}
