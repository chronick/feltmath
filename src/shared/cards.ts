// Shared card primitives — game-agnostic (blackjack today, hold'em etc. later).

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'

export const RANKS: readonly Rank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
]
export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']

export interface Card {
  rank: Rank
  suit: Suit
  /** unique per physical card in the shoe — stable React key for animations */
  id: string
}

/** Count of remaining unseen cards per rank. */
export type Composition = Record<Rank, number>

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}

export function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds'
}

/** Build `decks` interleaved 52-card decks with unique card ids (unshuffled). */
export function buildDecks(decks: number): Card[] {
  const cards: Card[] = []
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit, id: `${rank}-${suit}-${d}` })
      }
    }
  }
  return cards
}

export function emptyComposition(): Composition {
  return Object.fromEntries(RANKS.map((r) => [r, 0])) as Composition
}

export function fullComposition(decks: number): Composition {
  return Object.fromEntries(RANKS.map((r) => [r, 4 * decks])) as Composition
}

export function totalCards(comp: Composition): number {
  let n = 0
  for (const r of RANKS) n += comp[r]
  return n
}
