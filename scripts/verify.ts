// Executable verification probe: odds math vs published values + engine fuzz.
// Run: npx esbuild scripts/verify.ts --bundle --platform=node --format=esm \
//        --outfile=/tmp/verify.mjs && node /tmp/verify.mjs

import { fullComposition, RANKS } from '../src/shared/cards'
import type { Rank } from '../src/shared/cards'
import { DEFAULT_RULES } from '../src/games/blackjack/types'
import type { RulesConfig } from '../src/games/blackjack/types'
import { computeOdds, dealerDistribution } from '../src/games/blackjack/odds'
import { basicStrategy } from '../src/games/blackjack/strategy/basicStrategy'
import {
  addChips, availableActions, doAction, declineInsurance, humanSeat, needsStep,
  newGame, nextRound, setBet, startRound, step, unseenComposition,
} from '../src/games/blackjack/engine/game'
import type { GameState } from '../src/games/blackjack/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++
    console.log(`FAIL  ${label} ${detail}`)
  } else {
    console.log(`ok    ${label} ${detail}`)
  }
}
function close(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol
}

// --- negative control: prove the probe can fail -----------------------------
{
  let fired = false
  try {
    if (!close(0.5, 0.6, 0.001)) fired = true
  } catch {
    fired = true
  }
  if (!fired) {
    console.log('FAIL  negative control did not fire — probe is broken')
    process.exit(2)
  }
  console.log('ok    negative control fires')
}

// --- odds: dealer distributions ---------------------------------------------
const rules: RulesConfig = { ...DEFAULT_RULES } // 6 decks, H17
const s17: RulesConfig = { ...rules, dealerHitsSoft17: false }
const comp = fullComposition(6)

// Distribution sums to 1 for every upcard, both rule sets, both conditionings.
for (const r of ['2', '5', '6', '7', '9', '10', 'K', 'A'] as Rank[]) {
  for (const rc of [rules, s17]) {
    for (const cond of [false, true]) {
      const d = dealerDistribution(r, comp, rc, cond)
      const sum = d.p17 + d.p18 + d.p19 + d.p20 + d.p21 + d.pBlackjack + d.pBust
      check(`sum=1 up=${r} ${rc.dealerHitsSoft17 ? 'H17' : 'S17'} cond=${cond}`,
        close(sum, 1, 1e-9), sum.toFixed(12))
    }
  }
}

// Published infinite-deck reference points.
const bust6s17 = dealerDistribution('6', comp, s17, false).pBust
check('bust 6-up S17 ≈ 42.3%', close(bust6s17, 0.4232, 0.005), (bust6s17 * 100).toFixed(2) + '%')

const bust10 = dealerDistribution('10', comp, s17, true).pBust
check('bust ten-up post-peek ≈ 23.0%', close(bust10, 0.2298, 0.005), (bust10 * 100).toFixed(2) + '%')

const bustAh17 = dealerDistribution('A', comp, rules, true).pBust
check('bust A-up post-peek H17 ≈ 20.1%', close(bustAh17, 0.2007, 0.006), (bustAh17 * 100).toFixed(2) + '%')

const dCond = dealerDistribution('A', comp, rules, true)
check('conditioned pBlackjack = 0', dCond.pBlackjack === 0)
const dUncond = dealerDistribution('A', comp, rules, false)
check('unconditioned pBlackjack ≈ 4/13', close(dUncond.pBlackjack, 4 / 13, 1e-9),
  dUncond.pBlackjack.toFixed(4))

// --- odds: 16 vs 10 EVs (Wizard of Odds infinite-deck, post-peek) -----------
{
  const cards = [
    { rank: '10', suit: 'spades', id: 't1' },
    { rank: '6', suit: 'hearts', id: 't2' },
  ] as never
  const ctx = { canHit: true, canStand: true, canDouble: true, canSplit: false, canSurrender: true }
  const report = computeOdds(cards, '10', comp, s17, ctx)
  const ev = (a: string) => report.evs.find((e) => e.action === a)?.ev ?? NaN
  check('16v10 stand ≈ −0.5404', close(ev('stand'), -0.540430, 0.002), ev('stand').toFixed(6))
  check('16v10 hit ≈ −0.5398', close(ev('hit'), -0.539826, 0.002), ev('hit').toFixed(6))
  check('16v10 best is surrender (−0.5)', report.best === 'surrender', report.best)
}

// --- strategy spot checks ----------------------------------------------------
{
  const mk = (a: Rank, b: Rank) =>
    [{ rank: a, suit: 'spades', id: 'x1' }, { rank: b, suit: 'hearts', id: 'x2' }] as never
  const full = { canHit: true, canStand: true, canDouble: true, canSplit: true, canSurrender: true }
  const noDouble = { ...full, canDouble: false }
  const cases: Array<[string, Rank, Rank, Rank, typeof full, RulesConfig, string]> = [
    ['11 vs A doubles under H17', '6', '5', 'A', full, rules, 'double'],
    ['11 vs A hits under S17', '6', '5', 'A', full, s17, 'hit'],
    ['8,8 vs 10 splits', '8', '8', '10', full, rules, 'split'],
    ['A,7 vs 9 hits', 'A', '7', '9', full, rules, 'hit'],
    ['A,7 vs 2 H17 doubles', 'A', '7', '2', full, rules, 'double'],
    ['A,7 vs 2 H17 no-double stands', 'A', '7', '2', noDouble, rules, 'stand'],
    ['16 vs 9 surrenders', '10', '6', '9', { ...full, canSplit: false }, rules, 'surrender'],
    ['9,9 vs 7 stands', '9', '9', '7', full, rules, 'stand'],
    ['12 vs 2 hits', '10', '2', '2', { ...full, canSplit: false }, rules, 'hit'],
    ['12 vs 4 stands', '10', '2', '4', { ...full, canSplit: false }, rules, 'stand'],
    ['A,2 vs 5 doubles', 'A', '2', '5', full, rules, 'double'],
    ['A,2 vs 4 hits', 'A', '2', '4', full, rules, 'hit'],
    ['A,6 vs 2 hits (H17)', 'A', '6', '2', full, rules, 'hit'],
    ['A,6 vs 3 doubles', 'A', '6', '3', full, rules, 'double'],
    ['A,8 vs 6 H17 doubles', 'A', '8', '6', full, rules, 'double'],
    ['A,8 vs 6 S17 stands', 'A', '8', '6', full, s17, 'stand'],
    ['A,8 vs 5 stands', 'A', '8', '5', full, rules, 'stand'],
  ]
  for (const [label, a, b, up, ctx, rc, want] of cases) {
    const advice = basicStrategy(mk(a, b), up, rc, ctx)
    check(label, advice.action === want, `got ${advice.action}`)
  }
}

// --- engine fuzz: autoplay 300 rounds by the book ----------------------------
{
  const fuzzRules: RulesConfig = { ...DEFAULT_RULES, aiPlayers: 3 }
  let state: GameState = newGame(fuzzRules, 12345)
  const shoeSize = 52 * fuzzRules.decks
  let violations = 0
  let steps = 0

  const cardsInPlay = (s: GameState): number => {
    let n = s.shoe.length + s.discard.length + s.dealer.cards.length
    for (const seat of s.seats) for (const h of seat.hands) n += h.cards.length
    return n
  }

  const assertInvariants = (s: GameState, where: string): void => {
    if (cardsInPlay(s) !== shoeSize) {
      violations++
      console.log(`FAIL  card conservation at ${where}: ${cardsInPlay(s)} != ${shoeSize}`)
    }
    for (const seat of s.seats) {
      if (!Number.isFinite(seat.bankroll)) {
        violations++
        console.log(`FAIL  bankroll NaN at ${where} seat ${seat.id}`)
      }
    }
    if (s.seats[0].kind !== 'ai' && fuzzRules.aiPlayers > 0) {
      // human sits middle with 3 AI → index 2 of 4 seats; seat 0 must be AI
      violations++
      console.log(`FAIL  seat layout at ${where}`)
    }
  }

  let rounds = 0
  let humanActions = 0
  const human = () => humanSeat(state)
  // keep the human solvent for the fuzz
  while (rounds < 300 && violations === 0 && steps < 200000) {
    steps++
    if (state.phase === 'betting') {
      if (human().bankroll < 50) {
        state = setBet(state, 10)
        const before = human().bankroll
        state = addChips(state, 1000)
        if (human().bankroll !== before + 1000) {
          violations++
          console.log('FAIL  addChips did not credit')
        }
      } else {
        state = setBet(state, 10 + (rounds % 3) * 15)
      }
      state = startRound(state)
      if (state.phase !== 'dealing') {
        violations++
        console.log(`FAIL  startRound did not advance (bet ${human().pendingBet}, bank ${human().bankroll})`)
        break
      }
      continue
    }
    if (state.phase === 'insurance') {
      state = declineInsurance(state)
      continue
    }
    if (state.phase === 'settlement') {
      assertInvariants(state, `settlement r${state.round}`)
      rounds++
      state = nextRound(state)
      continue
    }
    if (needsStep(state)) {
      state = step(state)
      continue
    }
    // human decision: play by the book
    const ctx = availableActions(state)
    const seat = human()
    const hand = seat.hands[seat.activeHandIndex]
    const up = state.dealer.cards[0].rank
    const advice = basicStrategy(hand.cards, up, state.rules, ctx)
    const before = state
    state = doAction(state, advice.action)
    humanActions++
    if (state === before) {
      violations++
      console.log(`FAIL  doAction(${advice.action}) was a no-op`, JSON.stringify(ctx))
      break
    }
  }

  check('fuzz: 300 rounds completed', rounds === 300, `rounds=${rounds} steps=${steps}`)
  check('fuzz: no invariant violations', violations === 0)
  check('fuzz: human made decisions', humanActions > 200, `actions=${humanActions}`)
  const st = state.stats
  check('fuzz: stats add up', st.handsWon + st.handsLost + st.handsPushed === st.handsPlayed,
    `${st.handsWon}W/${st.handsLost}L/${st.handsPushed}P of ${st.handsPlayed}`)
  check('fuzz: book-match 100%', st.hintsTotal > 0 && st.hintsMatched === st.hintsTotal,
    `${st.hintsMatched}/${st.hintsTotal}`)
  const wr = st.handsWon / st.handsPlayed
  check('fuzz: win rate sane (0.38–0.48)', wr > 0.38 && wr < 0.48, wr.toFixed(3))
  // unseenComposition sanity at rest
  const uc = unseenComposition(state)
  const total = RANKS.reduce((n, r) => n + uc[r], 0)
  check('fuzz: unseen = shoe size at betting', total === state.shoe.length,
    `${total} vs ${state.shoe.length}`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
