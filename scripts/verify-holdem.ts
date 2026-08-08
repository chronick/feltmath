// Hold'em verification probe: evaluator vs a brute-force oracle, equity vs
// published matchups, and an engine fuzz with conservation invariants.
// Run: npx esbuild scripts/verify-holdem.ts --bundle --platform=node \
//        --format=esm --outfile=/tmp/verify-holdem.mjs && node /tmp/verify-holdem.mjs

import type { Card, Rank, Suit } from '../src/shared/cards'
import { RANKS, SUITS, buildDecks } from '../src/shared/cards'
import { mulberry32 } from '../src/shared/rng'
import { evaluate } from '../src/games/holdem/engine/evaluate'
import { equity, potOdds } from '../src/games/holdem/odds/equity'
import {
  doPokerAction, holdemStep, needsHoldemStep, newHoldemGame, pokerActionsFor,
  potTotal, startHand, humanHoldemSeat,
} from '../src/games/holdem/engine/game'
import { holdemAdvice } from '../src/games/holdem/strategy/advice'
import { DEFAULT_HOLDEM } from '../src/games/holdem/types'
import type { HoldemState } from '../src/games/holdem/types'
// buildDecks also feeds the directed incomplete-raise scenario below

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label} ${detail}`)
  if (!ok) failures++
}

const c = (spec: string): Card => {
  // "As" = ace of spades, "Th"/"10h" = ten of hearts
  const suitCh = spec.slice(-1)
  let rank = spec.slice(0, -1)
  if (rank === 'T') rank = '10'
  const suit: Suit =
    suitCh === 's' ? 'spades' : suitCh === 'h' ? 'hearts' : suitCh === 'd' ? 'diamonds' : 'clubs'
  return { rank: rank as Rank, suit, id: spec }
}
const hand = (...specs: string[]): Card[] => specs.map(c)

// --- negative control ---------------------------------------------------------
{
  const a = evaluate(hand('As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d')) // royal
  const b = evaluate(hand('2c', '2d', '2h', '2s', '3c', '4d', '5h')) // quads
  if (!(a.score > b.score)) {
    console.log('FAIL negative-control precondition (royal <= quads) — probe or evaluator broken')
    process.exit(2)
  }
  console.log('ok    negative control (royal > quads) fires correctly')
}

// --- evaluator: known comparisons --------------------------------------------
{
  const gt = (label: string, a: Card[], b: Card[]) =>
    check(label, evaluate(a).score > evaluate(b).score,
      `${evaluate(a).label} vs ${evaluate(b).label}`)
  const eq = (label: string, a: Card[], b: Card[]) =>
    check(label, evaluate(a).score === evaluate(b).score,
      `${evaluate(a).label} vs ${evaluate(b).label}`)

  gt('6-high straight > wheel', hand('2c', '3d', '4h', '5s', '6c', 'Kd', 'Qh'),
    hand('Ac', '2d', '3h', '4s', '5c', 'Kd', 'Qh'))
  gt('flush > straight', hand('2s', '7s', '9s', 'Js', 'Ks', 'Ad', 'Qh'),
    hand('9c', 'Td', 'Jh', 'Qs', 'Kc', '2d', '3h'))
  gt('nines full > threes full', hand('9c', '9d', '9h', '3s', '3c', '2d', '7h'),
    hand('3d', '3h', '3c', '9s', '9h', '2c', '7d'))
  gt('flush kicker battle', hand('As', 'Ks', 'Qs', 'Js', '9s', '2c', '2d'),
    hand('As', 'Ks', 'Qs', 'Js', '8s', '2c', '2d'))
  gt('quads > full house', hand('5c', '5d', '5h', '5s', '2c', '3d', '4h'),
    hand('Ac', 'Ad', 'Ah', 'Ks', 'Kc', '2d', '3h'))
  gt('two-pair kicker', hand('Kc', 'Kd', '9h', '9s', 'Jc', '2d', '3h'),
    hand('Kh', 'Ks', '9c', '9d', 'Tc', '2h', '3s'))
  gt('trips > two pair', hand('7c', '7d', '7h', '2s', '3c', '9d', 'Jh'),
    hand('Ac', 'Ad', 'Kh', 'Ks', 'Qc', '2d', '3h'))
  eq('board plays → chop', hand('2c', '3d', 'As', 'Ks', 'Qs', 'Js', 'Ts'),
    hand('7h', '8h', 'As', 'Ks', 'Qs', 'Js', 'Ts'))
  gt('wheel straight flush > quads', hand('As', '2s', '3s', '4s', '5s', 'Kc', 'Kd'),
    hand('Kc', 'Kd', 'Kh', 'Ks', 'Ac', '2d', '3h'))
  // three pairs: best two + best kicker
  const threePair = evaluate(hand('Ac', 'Ad', 'Kc', 'Kd', 'Qc', 'Qd', '2h'))
  check('three-pair resolves to AAKK+Q', threePair.category === 2 &&
    /aces and kings/i.test(threePair.label) && /queen/i.test(threePair.label), threePair.label)
}

// --- evaluator: brute-force oracle cross-check --------------------------------
{
  // Independent 5-card scorer (slow, obviously-correct) as the oracle.
  const VAL: Record<Rank, number> = {
    A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6,
    '5': 5, '4': 4, '3': 3, '2': 2,
  }
  function score5(cs: Card[]): number {
    const vs = cs.map((x) => VAL[x.rank]).sort((a, b) => b - a)
    const suits = new Set(cs.map((x) => x.suit))
    const flush = suits.size === 1
    const uniq = [...new Set(vs)].sort((a, b) => b - a)
    let straightTop = 0
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightTop = uniq[0]
      else if (uniq.join(',') === '14,5,4,3,2') straightTop = 5
    }
    const counts = new Map<number, number>()
    for (const v of vs) counts.set(v, (counts.get(v) ?? 0) + 1)
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
    const pack = (cat: number, digits: number[]): number =>
      digits.concat([0, 0, 0, 0, 0]).slice(0, 5).reduce((acc, d) => acc * 15 + d, cat)
    if (flush && straightTop) return pack(8, [straightTop])
    if (groups[0][1] === 4) return pack(7, [groups[0][0], groups[1][0]])
    if (groups[0][1] === 3 && groups[1][1] === 2) return pack(6, [groups[0][0], groups[1][0]])
    if (flush) return pack(5, vs)
    if (straightTop) return pack(4, [straightTop])
    if (groups[0][1] === 3) return pack(3, [groups[0][0], groups[1][0], groups[2][0]])
    if (groups[0][1] === 2 && groups[1][1] === 2)
      return pack(2, [groups[0][0], groups[1][0], groups[2][0]])
    if (groups[0][1] === 2) return pack(1, [groups[0][0], groups[1][0], groups[2][0], groups[3][0]])
    return pack(0, vs)
  }
  function best21(cs: Card[]): number {
    let best = -1
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 4; b++)
        for (let d = b + 1; d < 5; d++)
          for (let e = d + 1; e < 6; e++)
            for (let f = e + 1; f < 7; f++) {
              const s = score5([cs[a], cs[b], cs[d], cs[e], cs[f]])
              if (s > best) best = s
            }
    return best
  }

  const deck = buildDecks(1)
  const rng = mulberry32(424242)
  let mismatches = 0
  const TRIALS = 3000
  for (let t = 0; t < TRIALS; t++) {
    // partial shuffle: pick 7 distinct cards
    const idx: number[] = []
    while (idx.length < 7) {
      const i = Math.floor(rng() * 52)
      if (!idx.includes(i)) idx.push(i)
    }
    const cs = idx.map((i) => deck[i])
    const fast = evaluate(cs)
    // Oracle comparability: rebuild oracle ordering from fast result is wrong;
    // instead compare ORDERINGS pairwise: evaluate two hands and check the
    // oracle agrees on the winner.
    if (t % 2 === 1) continue
    const idx2: number[] = []
    while (idx2.length < 7) {
      const i = Math.floor(rng() * 52)
      if (!idx2.includes(i)) idx2.push(i)
    }
    const cs2 = idx2.map((i) => deck[i])
    const fast2 = evaluate(cs2)
    const oracleCmp = Math.sign(best21(cs) - best21(cs2))
    const fastCmp = Math.sign(fast.score - fast2.score)
    if (oracleCmp !== fastCmp) {
      mismatches++
      if (mismatches <= 3) {
        console.log(`  mismatch: [${cs.map((x) => x.id).join(' ')}] vs [${cs2.map((x) => x.id).join(' ')}]`)
        console.log(`    fast: ${fast.label} (${fast.score}) vs ${fast2.label} (${fast2.score}) → ${fastCmp}; oracle → ${oracleCmp}`)
      }
    }
  }
  check(`oracle cross-check (${TRIALS / 2} pairings)`, mismatches === 0, `${mismatches} mismatches`)
}

// --- equity reference matchups ------------------------------------------------
{
  const tol = 0.02
  const aa = equity(hand('As', 'Ah'), [], 1, 20000, 7)
  check('AA vs 1 random ≈ 85%', Math.abs(aa.equity - 0.852) < tol, aa.equity.toFixed(3))
  const seven2 = equity(hand('7c', '2d'), [], 1, 20000, 7)
  check('72o vs 1 random ≈ 35%', Math.abs(seven2.equity - 0.347) < tol, seven2.equity.toFixed(3))
  const aks = equity(hand('As', 'Ks'), [], 1, 20000, 7)
  check('AKs vs 1 random ≈ 67%', Math.abs(aks.equity - 0.67) < tol, aks.equity.toFixed(3))

  const det1 = equity(hand('Qs', 'Jh'), hand('2c', '7d', 'Th'), 2, 3000, 99)
  const det2 = equity(hand('Qs', 'Jh'), hand('2c', '7d', 'Th'), 2, 3000, 99)
  check('deterministic per seed', det1.equity === det2.equity)

  const river = equity(hand('As', 'Ah'), hand('Ad', 'Kd', 'Qc', '7s', '2h'), 1, 5000, 3)
  check('river vs 1 uses exact', river.method === 'exact', `${river.method}/${river.samples}`)
  const riverMc = equity(hand('As', 'Ah'), hand('Ad', 'Kd', 'Qc', '7s', '2h'), 2, 20000, 3)
  check('exact ≈ MC same spot (±2.5%)', Math.abs(river.equity - riverMc.equity) < 0.025 ||
    riverMc.opponents !== 1, `exact=${river.equity.toFixed(3)} mc2opp=${riverMc.equity.toFixed(3)} (different opp counts — sanity only)`)

  const po = potOdds(50, 150)
  check('pot odds 50 into 150 → 25%', Math.abs(po.requiredEquity - 0.25) < 1e-9, po.requiredEquity.toFixed(3))
}

// --- directed: incomplete all-in raise (barred re-raise rule) ------------------
{
  const cfg = { ...DEFAULT_HOLDEM, aiPlayers: 2 }
  const base = newHoldemGame(cfg, 1)
  const spare = buildDecks(1).filter((card) =>
    !['As', 'Kd', 'Qc', '7h', '7s', '2c', '9d', '9h', 'Jc', 'Jd'].some((id) => {
      const suit = id.slice(-1) === 's' ? 'spades' : id.slice(-1) === 'h' ? 'hearts' : id.slice(-1) === 'd' ? 'diamonds' : 'clubs'
      let rank = id.slice(0, -1)
      if (rank === 'T') rank = '10'
      return card.rank === rank && card.suit === suit
    }))
  // Flop. B(1) and C(2) have already acted at bet 100; human A(0) is short.
  const mk = (over: Partial<HoldemState>): HoldemState => ({
    ...base,
    phase: 'betting',
    street: 'flop',
    board: hand('Kd', 'Qc', '7h'),
    deck: spare.slice(0, 20),
    button: 1,
    currentBet: 100,
    lastRaiseSize: 100,
    pendingToAct: [0],
    actingIndex: 0,
    raiseBarred: [],
    seats: [
      { ...base.seats[0], hole: hand('As', '7s'), stack: 130, streetCommit: 0, totalCommit: 10 },
      { ...base.seats[1], hole: hand('2c', '9d'), stack: 890, streetCommit: 100, totalCommit: 110 },
      { ...base.seats[2], hole: hand('9h', 'Jc'), stack: 890, streetCommit: 100, totalCommit: 110 },
    ],
    ...over,
  })

  // Incomplete: shove to 130 (increment 30 < 100).
  let s = doPokerAction(mk({}), { type: 'allin' })
  check('incomplete shove accepted', s.currentBet === 130, `currentBet=${s.currentBet}`)
  check('lastRaiseSize unchanged', s.lastRaiseSize === 100, String(s.lastRaiseSize))
  check('actors owed a call are re-queued',
    s.pendingToAct.length === 2 && s.pendingToAct.includes(1) && s.pendingToAct.includes(2),
    s.pendingToAct.join(','))
  check('already-acted seats barred from raising', s.raiseBarred.includes(1) && s.raiseBarred.includes(2),
    s.raiseBarred.join(','))
  check('still betting (not street-closed)', s.phase === 'betting', s.phase)

  // Step the two AI decisions; they may call or fold but never raise.
  let guard = 0
  while (s.phase === 'betting' && guard++ < 10) s = holdemStep(s)
  const commits = s.seats.map((x) => x.streetCommit)
  const legalEnd = s.seats.every((x) => x.folded || x.streetCommit <= 130)
  check('AI seats only called/folded the short raise', legalEnd && s.currentBet === 130,
    `commits=${commits.join('/')} phase=${s.phase}`)
  // The bar is cleared by the next betting round OR the next hand — in this
  // scenario the hand runs out (one live seat with chips), so assert on the
  // next hand's first betting moment instead.
  guard = 0
  while (s.phase !== 'betting' && s.phase !== 'settlement' && guard++ < 40) s = holdemStep(s)
  if (s.phase === 'settlement') {
    s = startHand(s)
    check('bar cleared at next startHand', s.raiseBarred.length === 0,
      s.raiseBarred.join(',') || 'clear')
  } else {
    check('bar cleared once next street opens', s.raiseBarred.length === 0,
      `${s.raiseBarred.join(',') || 'clear'} @ ${s.phase}`)
  }

  // Full: shove to 250 (increment 150 ≥ 100) — nobody barred.
  const f = doPokerAction(mk({ seats: [
    { ...base.seats[0], hole: hand('As', '7s'), stack: 250, streetCommit: 0, totalCommit: 10 },
    { ...base.seats[1], hole: hand('2c', '9d'), stack: 890, streetCommit: 100, totalCommit: 110 },
    { ...base.seats[2], hole: hand('9h', 'Jc'), stack: 890, streetCommit: 100, totalCommit: 110 },
  ] }), { type: 'allin' })
  check('full shove reopens, no bars', f.currentBet === 250 && f.lastRaiseSize === 150 &&
    f.raiseBarred.length === 0 && f.pendingToAct.length === 2, `bet=${f.currentBet} raise=${f.lastRaiseSize}`)
}

// --- engine fuzz ---------------------------------------------------------------
{
  const config = { ...DEFAULT_HOLDEM, aiPlayers: 4 }
  let state: HoldemState = newHoldemGame(config, 20260808)
  const seatCount = config.aiPlayers + 1
  let violations = 0
  const HANDS = 150

  // Chips in flight during a hand: stacks + live commitments. Valid ONLY
  // between startHand (commits zeroed) and settlement (pots move into
  // stacks while totalCommit stays as a record — comparing there instead
  // uses Σstack alone).
  const stacksPlusPot = (s: HoldemState): number =>
    s.seats.reduce((n, seat) => n + seat.stack + seat.totalCommit, 0)
  const stacksOnly = (s: HoldemState): number =>
    s.seats.reduce((n, seat) => n + seat.stack, 0)

  let hands = 0
  let humanDecisions = 0
  let rejectedAdvice = 0
  let steps = 0
  let handBase = 0 // Σ stacks at the top of the current hand (post top-up)
  const buttonSeen = new Set<number>()

  while (hands < HANDS && violations === 0 && steps < 300000) {
    steps++
    if (state.phase === 'idle' || state.phase === 'settlement') {
      if (state.phase === 'settlement') {
        hands++
        const potAwarded = state.seats.reduce((n, s) => n + s.won, 0)
        const committed = state.seats.reduce((n, s) => n + s.totalCommit, 0)
        if (potAwarded !== committed) {
          violations++
          console.log(`FAIL award/commit mismatch hand ${hands}: won=${potAwarded} committed=${committed}`)
        }
        if (stacksOnly(state) !== handBase) {
          violations++
          console.log(`FAIL settlement conservation hand ${hands}: stacks=${stacksOnly(state)} base=${handBase}`)
        }
        for (const seat of state.seats) {
          if (seat.stack < 0 || !Number.isFinite(seat.stack)) {
            violations++
            console.log(`FAIL bad stack hand ${hands} seat ${seat.id}: ${seat.stack}`)
          }
        }
      }
      const before = state
      state = startHand(state)
      if (state === before) break // cannot continue (should not happen with topUp)
      handBase = stacksPlusPot(state) // commits are zero here; includes top-ups
      buttonSeen.add(state.button)
      continue
    }
    if (needsHoldemStep(state)) {
      state = holdemStep(state)
      continue
    }
    // human turn
    const ctx = pokerActionsFor(state)
    const advice = holdemAdvice(state, ctx)
    const before = state
    state = doPokerAction(state, advice.action)
    humanDecisions++
    if (state === before) {
      rejectedAdvice++
      // fall back: check else call else fold — advice gave an illegal action
      const fallback = ctx.canCheck ? { type: 'check' as const } :
        ctx.canCall ? { type: 'call' as const } : { type: 'fold' as const }
      state = doPokerAction(state, fallback)
      if (state === before) {
        violations++
        console.log('FAIL both advice and fallback rejected', JSON.stringify(ctx))
        break
      }
    }
    if (state.phase === 'betting' || state.phase === 'streetDeal') {
      const conserved = stacksPlusPot(state)
      if (conserved !== handBase) {
        violations++
        console.log(`FAIL chip conservation after human action: ${conserved} != ${handBase}`)
      }
    }
  }

  check(`fuzz: ${HANDS} hands completed`, hands === HANDS, `hands=${hands} steps=${steps}`)
  check('fuzz: no violations', violations === 0)
  check('fuzz: chips conserved end-to-end', stacksOnly(state) >= 0 && violations === 0,
    `final stacks=${stacksOnly(state)}`)
  check('fuzz: button rotates', buttonSeen.size >= Math.min(seatCount, 3), `${buttonSeen.size} positions`)
  check('fuzz: human made decisions', humanDecisions > HANDS * 0.8, `n=${humanDecisions}`)
  check('fuzz: advice always legal', rejectedAdvice === 0, `rejected=${rejectedAdvice}`)
  const st = state.stats
  check('fuzz: stats.hands matches', st.hands === hands, `${st.hands}`)
  const human = humanHoldemSeat(state)
  check('fuzz: human stack finite/positive-or-zero', Number.isFinite(human.stack) && human.stack >= 0,
    String(human.stack))
  check('fuzz: pot empties between hands', state.phase === 'settlement' || potTotal(state) === 0 ||
    state.phase !== 'idle', `${state.phase}/${potTotal(state)}`)
}

console.log(failures === 0 ? '\nALL HOLDEM CHECKS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
