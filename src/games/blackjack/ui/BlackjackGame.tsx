import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BookIcon, GearIcon } from '../../../shared/ui/Icons'
import { useHotkeys } from '../../../shared/ui/useHotkeys'
import type { HotkeyMap } from '../../../shared/ui/useHotkeys'
import { CHIP_DENOMS } from '../../../shared/ui/ChipStack'
import {
  addChips,
  applyRules,
  availableActions,
  currentHand,
  currentSeat,
  declineInsurance,
  doAction,
  humanSeat,
  needsStep,
  newGame,
  nextRound,
  setBet,
  startRound,
  step,
  takeInsurance,
  unseenComposition,
} from '../engine/game'
import { handLabel } from '../engine/hand'
import { computeOdds } from '../odds'
import { basicStrategy } from '../strategy/basicStrategy'
import type {
  Action,
  GameState,
  HandState,
  OddsReport,
  RulesConfig,
  StrategyAdvice,
} from '../types'
import { DEFAULT_RULES } from '../types'
import { ActionBar } from './ActionBar'
import { ActionToast } from './ActionToast'
import { BettingControls } from './BettingControls'
import { BookModal } from './BookModal'
import { EventLog } from './EventLog'
import { HintCard } from './HintCard'
import { InsurancePrompt } from './InsurancePrompt'
import { OddsPanel } from './OddsPanel'
import { SettingsModal } from './SettingsModal'
import { SettlementBar } from './SettlementBar'
import { StatsBar } from './StatsBar'
import { Table } from './Table'
import { actionLabel, actionPast, formatMoney, rulesSummary } from './format'
import { loadSession, saveSession } from './persistence'
import './blackjack.css'

// ---------------------------------------------------------------------------
// Reducer over the pure engine
// ---------------------------------------------------------------------------

type GameAction =
  | { type: 'step' }
  | { type: 'setBet'; amount: number }
  | { type: 'addToBet'; amount: number }
  | { type: 'addChips'; amount: number }
  | { type: 'startRound' }
  | { type: 'act'; action: Action }
  | { type: 'insurance'; take: boolean }
  | { type: 'nextRound' }
  | { type: 'applyRules'; rules: RulesConfig }

/**
 * Every case is phase-guarded and returns the *identical* state object when the
 * transition isn't legal. React bails out of re-rendering on an unchanged
 * reducer result, so a stray double dispatch is a genuine no-op.
 */
function reducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'step':
      return needsStep(state) ? step(state) : state
    case 'setBet':
      return state.phase === 'betting' ? setBet(state, Math.max(0, action.amount)) : state
    case 'addToBet':
      // Additive form reads the LIVE bet inside the reducer, so back-to-back
      // dispatches (key repeat, double taps) can never work from a stale bet.
      return state.phase === 'betting'
        ? setBet(state, Math.max(0, humanSeat(state).pendingBet + action.amount))
        : state
    case 'addChips':
      return addChips(state, action.amount)
    case 'startRound':
      return state.phase === 'betting' ? startRound(state) : state
    case 'act':
      return state.phase === 'playerTurns' ? doAction(state, action.action) : state
    case 'insurance':
      if (state.phase !== 'insurance') return state
      return action.take ? takeInsurance(state) : declineInsurance(state)
    case 'nextRound':
      return state.phase === 'settlement' ? nextRound(state) : state
    case 'applyRules':
      return state.phase === 'betting' ? applyRules(state, action.rules) : state
  }
}

/** Rules, bankroll and stats are restored; the shoe is always fresh. */
function initState(): GameState {
  const saved = loadSession()
  // Entropy lives in the UI layer so the engine stays pure and deterministic.
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
  const base = newGame(saved?.rules ?? DEFAULT_RULES, seed)
  if (!saved) return base
  return {
    ...base,
    stats: saved.stats,
    seats: base.seats.map((seat) =>
      seat.kind === 'human' ? { ...seat, bankroll: saved.bankroll } : seat,
    ),
  }
}

// Automatic step cadence. Dealer draws run a touch quicker so the reveal
// doesn't drag once every player hand is already decided.
const STEP_MS = 500
const DEALER_STEP_MS = 350

const REBUY_AMOUNT = 1000
const TOAST_MS = 2500

function prefersWide(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches
}

// ---------------------------------------------------------------------------

export function BlackjackGame() {
  const [state, dispatch] = useReducer(reducer, undefined, initState)

  // --- automatic stepper --------------------------------------------------
  // The effect is keyed on the state object itself, so it re-arms exactly once
  // per engine step. StrictMode's double-invoke is neutralised twice over:
  // the cleanup cancels the first timer, and `steppedFor` refuses to dispatch
  // twice for the same state identity.
  const steppedFor = useRef<GameState | null>(null)
  useEffect(() => {
    if (!needsStep(state)) return
    const delay = state.phase === 'dealerTurn' ? DEALER_STEP_MS : STEP_MS
    const timer = setTimeout(() => {
      if (steppedFor.current === state) return
      steppedFor.current = state
      dispatch({ type: 'step' })
    }, delay)
    return () => clearTimeout(timer)
  }, [state])

  // --- derived engine reads ----------------------------------------------
  const human = humanSeat(state)
  const actions = useMemo(() => availableActions(state), [state])
  const hand = currentHand(state)
  const upcard = state.dealer.cards[0]
  const anyAction =
    actions.canHit || actions.canStand || actions.canDouble || actions.canSplit || actions.canSurrender
  const decisionPending = state.phase === 'playerTurns' && anyAction && !!hand && !!upcard

  const advice = useMemo<StrategyAdvice | null>(() => {
    if (!decisionPending || !hand || !upcard) return null
    return basicStrategy(hand.cards, upcard.rank, state.rules, actions)
  }, [decisionPending, hand, upcard, state.rules, actions])

  const odds = useMemo<OddsReport | null>(() => {
    if (!decisionPending || !hand || !upcard) return null
    return computeOdds(hand.cards, upcard.rank, unseenComposition(state), state.rules, actions)
    // `state` drives unseenComposition; the rest are its own inputs.
  }, [decisionPending, hand, upcard, state, actions])

  // --- UI state -----------------------------------------------------------
  const [hintFor, setHintFor] = useState<HandState | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string; matched: boolean } | null>(null)
  const [bookOpen, setBookOpen] = useState(false)
  const [bookHighlight, setBookHighlight] = useState<StrategyAdvice['cell'] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [stagedRules, setStagedRules] = useState<RulesConfig | null>(null)
  const [oddsOpen, setOddsOpen] = useState(prefersWide)
  const [logOpen, setLogOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)

  const hintShown = decisionPending && hintFor !== null && hintFor === hand

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  // Rules changed mid-round get staged, then flushed on the next betting phase.
  useEffect(() => {
    if (state.phase === 'betting' && stagedRules) {
      dispatch({ type: 'applyRules', rules: stagedRules })
      setStagedRules(null)
    }
  }, [state.phase, stagedRules])

  // Persist only when the chips are actually at rest — mid-round the bankroll
  // has live wagers deducted from it and would restore short.
  useEffect(() => {
    if (state.phase !== 'betting' && state.phase !== 'settlement') return
    saveSession({
      rules: stagedRules ?? state.rules,
      bankroll: humanSeat(state).bankroll,
      stats: state.stats,
    })
  }, [state, stagedRules])

  // --- handlers -----------------------------------------------------------
  // Monotonic id so back-to-back toasts always remount and replay the animation.
  const toastId = useRef(0)

  const handleAction = (action: Action) => {
    if (advice) {
      const matched = advice.action === action
      const book = actionLabel(advice.action).toUpperCase()
      toastId.current += 1
      setToast({
        id: toastId.current,
        matched,
        text: matched
          ? `Book says ${book} — you ${actionPast(action)} ✓`
          : `✗ Book says ${book} — you ${actionPast(action)}`,
      })
    }
    setHintFor(null)
    dispatch({ type: 'act', action })
  }

  const openBookAtHint = () => {
    if (advice) setBookHighlight(advice.cell)
    setBookOpen(true)
  }

  const handleApplyRules = (rules: RulesConfig) => {
    if (state.phase === 'betting') dispatch({ type: 'applyRules', rules })
    else setStagedRules(rules)
    setSettingsOpen(false)
  }

  // --- hotkeys --------------------------------------------------------------
  // Rebuilt every render (cheap); useHotkeys reads it through a ref. Modals
  // own the keyboard while open: settings gets nothing (form fields + Esc),
  // the book keeps only its own toggle.
  const hotkeys = useMemo<HotkeyMap>(() => {
    if (settingsOpen) return {}
    if (bookOpen) return { b: () => setBookOpen(false) }

    const map: HotkeyMap = {
      b: () => {
        setBookHighlight(null)
        setBookOpen(true)
      },
    }

    if (state.phase === 'betting') {
      map.enter = map.space = () => dispatch({ type: 'startRound' })
      map.c = () => dispatch({ type: 'setBet', amount: 0 })
      // 1..4 = chip denominations in on-screen order (small → large);
      // CHIP_DENOMS itself is declared large → small.
      const denomsAscending = [...CHIP_DENOMS].reverse()
      denomsAscending.forEach((denom, i) => {
        map[String(i + 1)] = () => dispatch({ type: 'addToBet', amount: denom })
      })
    } else if (state.phase === 'insurance') {
      map.y = () => dispatch({ type: 'insurance', take: true })
      map.n = () => dispatch({ type: 'insurance', take: false })
    } else if (state.phase === 'settlement') {
      map.enter = map.space = () => dispatch({ type: 'nextRound' })
    } else if (decisionPending) {
      const act = (a: Action, allowed: boolean) => {
        if (allowed) map[a === 'split' ? 'p' : a[0]] = () => handleAction(a)
      }
      act('hit', actions.canHit)
      act('stand', actions.canStand)
      act('double', actions.canDouble)
      act('split', actions.canSplit)
      act('surrender', actions.canSurrender)
      map['?'] = map['/'] = () => setHintFor((current) => (current === hand ? null : hand))
    }
    return map
    // handleAction/hand/actions all derive from state; the ref pattern makes
    // stale closures impossible anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, bookOpen, state, decisionPending, actions, hand])
  useHotkeys(hotkeys)

  // --- copy ---------------------------------------------------------------
  const acting = currentSeat(state)
  let status = ''
  if (state.phase === 'dealing') status = 'Dealing…'
  else if (state.phase === 'peek') status = 'Dealer checks the hole card…'
  else if (state.phase === 'dealerTurn') status = 'Dealer plays…'
  else if (state.phase === 'playerTurns' && !decisionPending) {
    status = acting && acting.kind === 'ai' ? `${acting.name} is playing…` : 'Resolving hand…'
  } else if (state.phase === 'insurance') status = 'Insurance decision'

  // `advice.situation` already speaks the book's language ("Hard 16 vs 10",
  // where any ten-value upcard reads as 10); fall back to the raw hand label.
  const situation =
    advice?.situation ?? (hand && upcard ? `${handLabel(hand.cards)} vs ${upcard.rank}` : 'Your move')
  const caption =
    human.hands.length > 1
      ? `${situation} · Hand ${human.activeHandIndex + 1} of ${human.hands.length}`
      : situation

  const activeBet = hand?.bet ?? human.pendingBet
  const insuranceMainBet = human.hands[0]?.bet ?? human.pendingBet

  return (
    <div className="bj">
      <div className="bj__bar">
        <div className="bj__bank">
          <span className="smallcaps">Bankroll</span>
          <strong className="num">{formatMoney(human.bankroll)}</strong>
        </div>
        <div className="bj__rules">
          <span className="bj__round num">Round {state.round}</span>
          <span className="bj__rulesline">{rulesSummary(state.rules)}</span>
          {stagedRules && <span className="bj__staged">rules queued</span>}
        </div>
        <div className="bj__tools">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => {
              setBookHighlight(null)
              setBookOpen(true)
            }}
            aria-label="Open the strategy book"
          >
            <BookIcon />
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Table rules and settings"
          >
            <GearIcon />
          </button>
        </div>
      </div>

      <StatsBar stats={state.stats} open={statsOpen} onToggle={() => setStatsOpen((v) => !v)} />

      <div className="bj__body">
        <div className="bj__stage">
          <Table state={state}>
            {state.phase === 'insurance' && (
              <InsurancePrompt
                mainBet={insuranceMainBet}
                bankroll={human.bankroll}
                onTake={() => dispatch({ type: 'insurance', take: true })}
                onDecline={() => dispatch({ type: 'insurance', take: false })}
              />
            )}
            {toast && <ActionToast key={toast.id} text={toast.text} matched={toast.matched} />}
          </Table>
        </div>

        <div className="bj__dock">
          <OddsPanel
            odds={odds}
            open={oddsOpen}
            onToggle={() => setOddsOpen((v) => !v)}
            bet={activeBet}
          />
          <EventLog events={state.events} open={logOpen} onToggle={() => setLogOpen((v) => !v)} />
        </div>
      </div>

      <div className="bj__controls">
        {hintShown && advice && (
          <HintCard advice={advice} onShowBook={openBookAtHint} onDismiss={() => setHintFor(null)} />
        )}

        {state.phase === 'betting' && (
          <BettingControls
            bankroll={human.bankroll}
            pendingBet={human.pendingBet}
            onAddChip={(denom) => dispatch({ type: 'addToBet', amount: denom })}
            onRemoveChip={(denom) => dispatch({ type: 'addToBet', amount: -denom })}
            onClear={() => dispatch({ type: 'setBet', amount: 0 })}
            onDeal={() => dispatch({ type: 'startRound' })}
            onRebuy={() => dispatch({ type: 'addChips', amount: REBUY_AMOUNT })}
          />
        )}

        {decisionPending && (
          <ActionBar
            ctx={actions}
            caption={caption}
            hintShown={hintShown}
            onHint={() => setHintFor((current) => (current === hand ? null : hand))}
            onAction={handleAction}
          />
        )}

        {state.phase === 'settlement' && (
          <SettlementBar seat={human} onNext={() => dispatch({ type: 'nextRound' })} />
        )}

        {status && (
          <p className="bj__status" role="status" aria-live="polite">
            <span className="bj__spinner" aria-hidden="true" />
            {status}
          </p>
        )}
      </div>

      {/* The book always reflects the rules actually in play — staged changes
          aren't governing this hand, and the advice was derived from these. */}
      {bookOpen && (
        <BookModal
          rules={state.rules}
          highlight={bookHighlight}
          onClose={() => setBookOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          rules={stagedRules ?? state.rules}
          canApplyNow={state.phase === 'betting'}
          onApply={handleApplyRules}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
