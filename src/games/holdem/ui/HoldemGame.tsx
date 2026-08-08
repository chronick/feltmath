import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BookIcon, GearIcon } from '../../../shared/ui/Icons'
import { Kbd } from '../../../shared/ui/Kbd'
import { useHotkeyLayout } from '../../../shared/ui/hotkeyLayout'
import { useHotkeys } from '../../../shared/ui/useHotkeys'
import type { HotkeyMap } from '../../../shared/ui/useHotkeys'
import {
  applyConfig,
  doPokerAction,
  holdemStep,
  humanHoldemSeat,
  needsHoldemStep,
  newHoldemGame,
  pokerActionsFor,
  potTotal,
  startHand,
} from '../engine/game'
import { equity, potOdds } from '../odds/equity'
import { holdemAdvice } from '../strategy/advice'
import { comboKeyOf, positionOf } from '../strategy/ranges'
import type {
  ComboKey,
  EquityReport,
  HoldemAdvice,
  HoldemConfig,
  HoldemEvent,
  HoldemState,
  PokerAction,
  Position,
  PotOddsReport,
} from '../types'
import { DEFAULT_HOLDEM } from '../types'
import { EquityPanel } from './EquityPanel'
import { HoldemSettings } from './HoldemSettings'
import { HoldemStats } from './HoldemStats'
import { holdemKeys } from './keys'
import { PokerActionBar } from './PokerActionBar'
import { PokerEventLog } from './PokerEventLog'
import { PokerHint } from './PokerHint'
import { PokerSettlement } from './PokerSettlement'
import { PokerTable } from './PokerTable'
import { RangesModal, type RangeMode } from './RangesModal'
import { blindsLabel, clampChips, configSummary, formatMoney, streetLabel } from './format'
import { loadHoldem, saveHoldem } from './persistence'
import './holdem.css'

// ---------------------------------------------------------------------------
// Reducer over the pure engine
// ---------------------------------------------------------------------------

type HoldemGameAction =
  | { type: 'step' }
  | { type: 'startHand' }
  | { type: 'act'; action: PokerAction }
  | { type: 'applyConfig'; config: HoldemConfig }

/**
 * Every case is phase-guarded and returns the *identical* state object when the
 * transition isn't legal. React bails out of re-rendering on an unchanged
 * reducer result, so a stray double dispatch is a genuine no-op.
 */
function reducer(state: HoldemState, action: HoldemGameAction): HoldemState {
  switch (action.type) {
    case 'step':
      return needsHoldemStep(state) ? holdemStep(state) : state
    case 'startHand':
      return state.phase === 'idle' || state.phase === 'settlement' ? startHand(state) : state
    case 'act':
      // The engine validates the action; the UI still refuses to speak out of
      // turn so a queued keypress can never act for an AI seat.
      if (state.phase !== 'betting') return state
      if (state.seats[state.actingIndex]?.kind !== 'human') return state
      return doPokerAction(state, action.action)
    case 'applyConfig':
      return state.phase === 'idle' || state.phase === 'settlement'
        ? applyConfig(state, action.config)
        : state
  }
}

/** Config, the human's stack and stats are restored; the deck is always fresh. */
function initState(): HoldemState {
  const saved = loadHoldem()
  // Entropy lives in the UI layer so the engine stays pure and deterministic.
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
  const base = newHoldemGame(saved?.config ?? DEFAULT_HOLDEM, seed)
  if (!saved) return base
  return {
    ...base,
    stats: saved.stats,
    seats: base.seats.map((seat) =>
      seat.kind === 'human' ? { ...seat, stack: saved.stack } : seat,
    ),
  }
}

// Automatic step cadence. Board cards and showdown reveals get a beat longer —
// those are the moments worth watching.
const STEP_MS = 450
const SLOW_STEP_MS = 600

function prefersWide(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches
}

/** Opponents still contesting the pot (dealt in, not folded, not sitting out). */
function liveOpponents(state: HoldemState, humanId: number): number {
  return state.seats.filter(
    (seat) => seat.id !== humanId && !seat.folded && !seat.out && seat.hole.length > 0,
  ).length
}

/** Deterministic equity seed: same decision point → same samples → stable panel. */
function equitySeed(state: HoldemState): number {
  return (
    (state.rngSeed ^
      Math.imul(state.handNumber + 1, 0x9e3779b1) ^
      Math.imul(state.board.length + 1, 0x85ebca6b)) >>>
    0
  )
}

/**
 * Pot awards for the hand on screen. Scans back to the most recent 'hand'
 * event, so this reads right whether or not the engine keeps a running log.
 */
function handAwards(events: HoldemEvent[]): HoldemEvent[] {
  let start = 0
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'hand') {
      start = i
      break
    }
  }
  return events.slice(start).filter((event) => event.kind === 'award')
}

interface RangeFocus {
  position: Position
  combo: ComboKey | null
  mode: RangeMode
}

// ---------------------------------------------------------------------------

export function HoldemGame() {
  const [state, dispatch] = useReducer(reducer, undefined, initState)

  // --- derived engine reads ----------------------------------------------
  const human = humanHoldemSeat(state)
  const ctx = useMemo(() => pokerActionsFor(state), [state])
  const humanTurn =
    state.phase === 'betting' && state.seats[state.actingIndex]?.kind === 'human'
  const pot = potTotal(state)

  // Unique per decision point: sizing and the hint reset themselves whenever
  // the action moves, with no effect to keep in sync.
  const decisionId = `${state.handNumber}:${state.street}:${state.actingIndex}:${state.events.length}`

  // --- automatic stepper --------------------------------------------------
  // The effect is keyed on the state object itself, so it re-arms exactly once
  // per engine step. StrictMode's double-invoke is neutralised twice over:
  // the cleanup cancels the first timer, and `steppedFor` refuses to dispatch
  // twice for the same state identity.
  const steppedFor = useRef<HoldemState | null>(null)
  useEffect(() => {
    if (humanTurn || !needsHoldemStep(state)) return
    const dramatic = state.phase === 'streetDeal' || state.phase === 'showdown'
    const timer = setTimeout(
      () => {
        if (steppedFor.current === state) return
        steppedFor.current = state
        dispatch({ type: 'step' })
      },
      dramatic ? SLOW_STEP_MS : STEP_MS,
    )
    return () => clearTimeout(timer)
  }, [state, humanTurn])

  // --- trainer reads (human's turn only — equity is the expensive one) -----
  const opponents = useMemo(() => liveOpponents(state, human.id), [state, human.id])

  const equityReport = useMemo<EquityReport | null>(() => {
    if (!humanTurn || human.hole.length < 2) return null
    return equity(
      human.hole,
      state.board,
      opponents,
      state.config.equitySamples,
      equitySeed(state),
    )
    // `state` carries board + seed; the rest are its own inputs.
  }, [humanTurn, human.hole, opponents, state])

  const oddsReport = useMemo<PotOddsReport | null>(() => {
    if (!humanTurn || !ctx.canCall || ctx.callAmount <= 0) return null
    return potOdds(ctx.callAmount, ctx.potSize)
  }, [humanTurn, ctx])

  const advice = useMemo<HoldemAdvice | null>(
    () => (humanTurn ? holdemAdvice(state, ctx) : null),
    [humanTurn, state, ctx],
  )

  const positions = useMemo<Record<number, Position> | null>(() => {
    if (state.phase === 'idle') return null
    const map: Record<number, Position> = {}
    for (const seat of state.seats) {
      if (!seat.out) map[seat.id] = positionOf(state, seat.id)
    }
    return map
  }, [state])

  // --- UI state -----------------------------------------------------------
  const [sizing, setSizing] = useState<{ id: string; to: number } | null>(null)
  const [hintFor, setHintFor] = useState<string | null>(null)
  const [rangesOpen, setRangesOpen] = useState(false)
  const [rangeFocus, setRangeFocus] = useState<RangeFocus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [stagedConfig, setStagedConfig] = useState<HoldemConfig | null>(null)
  const [equityOpen, setEquityOpen] = useState(prefersWide)
  const [logOpen, setLogOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const sizeRef = useRef<HTMLInputElement>(null)

  const canAggress = ctx.canBet || ctx.canRaise
  const sizingOpen = humanTurn && canAggress && sizing !== null && sizing.id === decisionId
  const sizeTo = sizingOpen ? clampChips(sizing.to, ctx.minTo, ctx.maxTo) : ctx.minTo
  const hintShown = humanTurn && hintFor === decisionId

  // Config changed mid-hand gets staged, then flushed once the chips are at rest.
  useEffect(() => {
    if (!stagedConfig) return
    if (state.phase === 'idle' || state.phase === 'settlement') {
      dispatch({ type: 'applyConfig', config: stagedConfig })
      setStagedConfig(null)
    }
  }, [state.phase, stagedConfig])

  // Persist only between hands — mid-hand the stack has live commits deducted
  // from it and would restore short.
  useEffect(() => {
    if (state.phase !== 'idle' && state.phase !== 'settlement') return
    saveHoldem({
      config: stagedConfig ?? state.config,
      stack: humanHoldemSeat(state).stack,
      stats: state.stats,
    })
  }, [state, stagedConfig])

  // --- handlers -----------------------------------------------------------
  const act = (action: PokerAction) => {
    setSizing(null)
    setHintFor(null)
    dispatch({ type: 'act', action })
  }

  const openSizingAt = (to: number) => {
    if (!canAggress) return
    setSizing({ id: decisionId, to: clampChips(to, ctx.minTo, ctx.maxTo) })
    // The tray mounts in this same (discrete) commit, so the ref is live by the
    // next frame — focusing the slider makes arrow keys size the bet.
    requestAnimationFrame(() => sizeRef.current?.focus())
  }

  /** Bet, raise or shove — one decision point for the button and the Enter key. */
  const confirmSizing = (to?: number) => {
    if (!sizingOpen) return
    const target = clampChips(to ?? sizeTo, ctx.minTo, ctx.maxTo)
    if (target >= ctx.maxTo) act({ type: 'allin' })
    else if (ctx.canBet) act({ type: 'bet', to: target })
    else if (ctx.canRaise) act({ type: 'raise', to: target })
  }

  const heroPosition: Position = positions?.[human.id] ?? 'BTN'
  const heroCombo = human.hole.length === 2 ? comboKeyOf(human.hole) : null
  const defaultMode: RangeMode =
    state.street === 'preflop' && state.currentBet > state.config.bigBlind ? 'vsOpen' : 'rfi'

  const openRanges = (focus?: RangeFocus) => {
    setRangeFocus(focus ?? { position: heroPosition, combo: heroCombo, mode: defaultMode })
    setRangesOpen(true)
  }

  const openRangesFromHint = () => {
    if (advice?.chart) {
      openRanges({ position: advice.chart.position, combo: advice.chart.combo, mode: defaultMode })
    } else {
      openRanges()
    }
  }

  const handleApplyConfig = (config: HoldemConfig) => {
    if (state.phase === 'idle' || state.phase === 'settlement') {
      dispatch({ type: 'applyConfig', config })
    } else {
      setStagedConfig(config)
    }
    setSettingsOpen(false)
  }

  // --- hotkeys --------------------------------------------------------------
  // Rebuilt every render (cheap); useHotkeys reads it through a ref. Modals own
  // the keyboard while open: settings gets nothing (form fields + Esc), the
  // ranges book keeps only its own toggle.
  const layout = useHotkeyLayout()
  const keys = holdemKeys(layout)
  const hotkeys = useMemo<HotkeyMap>(() => {
    if (settingsOpen) return {}
    if (rangesOpen) return { b: () => setRangesOpen(false) }

    const map: HotkeyMap = { b: () => openRanges() }

    if (state.phase === 'idle' || state.phase === 'settlement') {
      map.enter = map.space = () => dispatch({ type: 'startHand' })
    } else if (humanTurn) {
      if (ctx.canFold) map[keys.fold.code] = () => act({ type: 'fold' })
      if (ctx.canCheck) map[keys.checkCall.code] = () => act({ type: 'check' })
      else if (ctx.canCall) map[keys.checkCall.code] = () => act({ type: 'call' })
      if (canAggress) {
        // The raise key arms the sizing tray (and focuses it); the all-in key
        // jumps it to the shove. Enter is always the commit — nothing bets a
        // stack on one keystroke.
        map[keys.raise.code] = () => openSizingAt(sizingOpen ? sizeTo : ctx.minTo)
        map[keys.allin.code] = () => openSizingAt(ctx.maxTo)
        map.enter = () => confirmSizing()
      }
      map['?'] = map['/'] = () =>
        setHintFor((current) => (current === decisionId ? null : decisionId))
    }

    return map
    // Handlers all read live state through the render closure; the map is
    // rebuilt on every render so nothing here can go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, rangesOpen, state, humanTurn, ctx, sizingOpen, sizeTo, decisionId, keys])
  useHotkeys(hotkeys)

  // --- copy ---------------------------------------------------------------
  const acting = state.phase === 'betting' ? state.seats[state.actingIndex] : undefined
  const nextCard =
    state.board.length === 0 ? 'flop' : state.board.length === 3 ? 'turn' : 'river'

  let status = ''
  if (state.phase === 'posting') status = 'Posting blinds…'
  else if (state.phase === 'dealing') status = 'Dealing…'
  else if (state.phase === 'streetDeal') status = `Dealing the ${nextCard}…`
  else if (state.phase === 'showdown') status = 'Showdown…'
  else if (state.phase === 'betting' && !humanTurn) {
    status = acting ? `${acting.name} is thinking…` : 'Action…'
  }

  const caption = `${streetLabel(state.street)} · ${positions?.[human.id] ?? 'Your turn'} · Pot ${formatMoney(pot)}`
  const awards = handAwards(state.events)
  const stranded = state.phase === 'settlement' && human.stack <= 0 && !state.config.topUp

  return (
    <div className="he">
      <div className="he__bar">
        <div className="he__stack">
          <span className="smallcaps">Stack</span>
          <strong className="num">{formatMoney(human.stack)}</strong>
        </div>
        <div className="he__meta">
          <span className="he__hand num">
            {state.handNumber > 0 ? `Hand ${state.handNumber}` : 'Table open'} ·{' '}
            {blindsLabel(state.config)}
          </span>
          <span className="he__metaline">{configSummary(state.config)}</span>
          {stagedConfig && <span className="he__staged">table queued</span>}
        </div>
        <div className="he__tools">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => openRanges()}
            aria-label="Open the preflop ranges"
          >
            <BookIcon />
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Table settings"
          >
            <GearIcon />
          </button>
        </div>
      </div>

      <HoldemStats stats={state.stats} open={statsOpen} onToggle={() => setStatsOpen((v) => !v)} />

      <div className="he__body">
        <div className="he__stage">
          <PokerTable state={state} positions={positions} />
        </div>

        <div className="he__dock">
          <EquityPanel
            report={equityReport}
            odds={oddsReport}
            open={equityOpen}
            onToggle={() => setEquityOpen((v) => !v)}
          />
          <PokerEventLog
            events={state.events}
            open={logOpen}
            onToggle={() => setLogOpen((v) => !v)}
          />
        </div>
      </div>

      <div className="he__controls">
        {hintShown && advice && (
          <PokerHint
            advice={advice}
            onShowRanges={openRangesFromHint}
            onDismiss={() => setHintFor(null)}
          />
        )}

        {state.phase === 'idle' && (
          <div className="pstart">
            <p className="pstart__line">
              {configSummary(state.config)} — you sit with {formatMoney(human.stack)}.
            </p>
            <button
              type="button"
              className="btn btn--gold pstart__btn"
              onClick={() => dispatch({ type: 'startHand' })}
              autoFocus
            >
              Start hand
              <Kbd>⏎</Kbd>
            </button>
          </div>
        )}

        {humanTurn && (
          <PokerActionBar
            ctx={ctx}
            keys={keys}
            bigBlind={state.config.bigBlind}
            streetCommit={human.streetCommit}
            stack={human.stack}
            caption={caption}
            sizingOpen={sizingOpen}
            sizeTo={sizeTo}
            onSize={(to) => setSizing({ id: decisionId, to })}
            onOpenSizing={() => openSizingAt(ctx.minTo)}
            onCloseSizing={() => setSizing(null)}
            onConfirm={confirmSizing}
            onAction={act}
            onHint={() => setHintFor((current) => (current === decisionId ? null : decisionId))}
            hintShown={hintShown}
            sizeRef={sizeRef}
          />
        )}

        {state.phase === 'settlement' && (
          <PokerSettlement
            human={human}
            awards={awards}
            stranded={stranded}
            onNext={() => dispatch({ type: 'startHand' })}
          />
        )}

        {status && (
          <p className="he__status" role="status" aria-live="polite">
            <span className="he__spinner" aria-hidden="true" />
            {status}
          </p>
        )}
      </div>

      {rangesOpen && rangeFocus && (
        <RangesModal
          position={rangeFocus.position}
          mode={rangeFocus.mode}
          combo={rangeFocus.combo}
          onClose={() => setRangesOpen(false)}
        />
      )}

      {settingsOpen && (
        <HoldemSettings
          config={stagedConfig ?? state.config}
          canApplyNow={state.phase === 'idle' || state.phase === 'settlement'}
          onApply={handleApplyConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
