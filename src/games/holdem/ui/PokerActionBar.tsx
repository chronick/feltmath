import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { BulbIcon } from '../../../shared/ui/Icons'
import { Kbd } from '../../../shared/ui/Kbd'
import type { PokerAction, PokerActionContext } from '../types'
import { clampChips, formatBB, formatMoney, roundToBB } from './format'
import type { HoldemKeys } from './keys'

export interface PokerActionBarProps {
  ctx: PokerActionContext
  /** active hotkey bindings — drives the key labels on the buttons */
  keys: HoldemKeys
  bigBlind: number
  /** the human's chips already in front on this street — drives pot-raise math */
  streetCommit: number
  /** chips behind, for the "(all-in)" tag on a call that covers the stack */
  stack: number
  caption: string
  /** the sizing tray is showing (presets + slider + confirm) */
  sizingOpen: boolean
  /** current bet/raise-to amount, always legal */
  sizeTo: number
  onSize: (to: number) => void
  onOpenSizing: () => void
  onCloseSizing: () => void
  /** confirm the sizing; pass an explicit amount when it isn't committed yet */
  onConfirm: (to?: number) => void
  onAction: (action: PokerAction) => void
  onHint: () => void
  hintShown: boolean
  /** focused by the R hotkey so arrow keys size the bet */
  sizeRef: RefObject<HTMLInputElement | null>
}

interface Preset {
  id: string
  label: string
  fraction: number
}

const PRESETS: Preset[] = [
  { id: 'third', label: '⅓ pot', fraction: 1 / 3 },
  { id: 'half', label: '½ pot', fraction: 1 / 2 },
  { id: 'twothirds', label: '⅔ pot', fraction: 2 / 3 },
  { id: 'pot', label: 'Pot', fraction: 1 },
]

export function PokerActionBar({
  ctx,
  keys,
  bigBlind,
  streetCommit,
  stack,
  caption,
  sizingOpen,
  sizeTo,
  onSize,
  onOpenSizing,
  onCloseSizing,
  onConfirm,
  onAction,
  onHint,
  hintShown,
  sizeRef,
}: PokerActionBarProps) {
  // The typed amount lives here as free text so a half-finished number never
  // gets clamped out from under the caret; it commits on Enter or blur.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    setDraft(null)
  }, [sizeTo, sizingOpen])

  const canAggress = ctx.canBet || ctx.canRaise
  const raiseWord = ctx.canBet ? 'Bet' : 'Raise'
  const callIsAllIn = ctx.canCall && ctx.callAmount >= stack
  const isAllIn = sizeTo >= ctx.maxTo
  const sliderLocked = ctx.maxTo <= ctx.minTo

  /**
   * Presets and typed amounts land on the big-blind ladder; the slider keeps
   * its own ladder (min + n×BB) so dragging never fights a re-snap.
   */
  const clampTo = (raw: number) => roundToBB(raw, bigBlind, ctx.minTo, ctx.maxTo)

  /**
   * Raising to f× pot: call first, then put in f of the pot that call creates.
   * With no bet outstanding callAmount is 0 and this collapses to f× the pot.
   */
  const presetValue = (fraction: number) =>
    clampTo(streetCommit + ctx.callAmount + fraction * (ctx.potSize + ctx.callAmount))

  const commitDraft = (): number => {
    if (draft === null) return sizeTo
    const parsed = Number(draft.replace(/[^0-9.]/g, ''))
    setDraft(null)
    if (!Number.isFinite(parsed) || parsed <= 0) return sizeTo
    const next = clampTo(parsed)
    onSize(next)
    return next
  }

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onConfirm(commitDraft())
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
      onCloseSizing()
    }
  }

  // The parent decides bet vs raise vs all-in from the amount — one place,
  // so the button and the Enter key can never disagree.
  const confirm = () => onConfirm(sizeTo)

  // Picking a preset hands focus back to the slider, so Enter always confirms
  // from wherever the sizing conversation left off (mouse or keyboard).
  const pick = (value: number) => {
    onSize(value)
    sizeRef.current?.focus()
  }

  return (
    <div className="pact">
      <div className="pact__head">
        <span className="pact__caption">{caption}</span>
        <button
          type="button"
          className="btn btn--quiet pact__hint"
          onClick={onHint}
          aria-pressed={hintShown}
        >
          <BulbIcon size={15} />
          Hint
          <Kbd>?</Kbd>
        </button>
      </div>

      <div className="pact__row" role="group" aria-label="Your move">
        <button
          type="button"
          className="pactbtn pactbtn--fold"
          disabled={!ctx.canFold}
          onClick={() => onAction({ type: 'fold' })}
        >
          Fold
          <Kbd>{keys.fold.label}</Kbd>
        </button>

        {ctx.canCheck || !ctx.canCall ? (
          <button
            type="button"
            className="pactbtn pactbtn--check"
            disabled={!ctx.canCheck}
            onClick={() => onAction({ type: 'check' })}
          >
            Check
            <Kbd>{keys.checkCall.label}</Kbd>
          </button>
        ) : (
          <button
            type="button"
            className="pactbtn pactbtn--call"
            onClick={() => onAction({ type: 'call' })}
          >
            <span className="pactbtn__main">Call {formatMoney(ctx.callAmount)}</span>
            {callIsAllIn && <em className="pactbtn__note">all-in</em>}
            <Kbd>{keys.checkCall.label}</Kbd>
          </button>
        )}

        <button
          type="button"
          className="pactbtn pactbtn--raise"
          disabled={!canAggress}
          aria-expanded={sizingOpen}
          onClick={sizingOpen ? onCloseSizing : onOpenSizing}
        >
          <span className="pactbtn__main">{raiseWord}</span>
          <Kbd>{keys.raise.label}</Kbd>
        </button>
      </div>

      {sizingOpen && canAggress && (
        <div className="psize">
          <div className="psize__presets" role="group" aria-label="Bet size presets">
            {PRESETS.map((preset) => {
              const value = presetValue(preset.fraction)
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="preset"
                  data-on={sizeTo === value ? 'true' : 'false'}
                  onClick={() => pick(value)}
                >
                  {preset.label}
                  <i className="num">{formatMoney(value)}</i>
                </button>
              )
            })}
            <button
              type="button"
              className="preset preset--allin"
              data-on={isAllIn ? 'true' : 'false'}
              onClick={() => pick(ctx.maxTo)}
            >
              All-in
              <i className="num">{formatMoney(ctx.maxTo)}</i>
              <Kbd>{keys.allin.label}</Kbd>
            </button>
          </div>

          <div className="psize__row">
            <input
              ref={sizeRef}
              className="psize__slider"
              type="range"
              min={ctx.minTo}
              max={Math.max(ctx.minTo, ctx.maxTo)}
              step={Math.max(1, Math.round(bigBlind))}
              value={sizeTo}
              disabled={sliderLocked}
              onChange={(event) =>
                onSize(clampChips(Number(event.target.value), ctx.minTo, ctx.maxTo))
              }
              onKeyDown={onFieldKey}
              aria-label={`${raiseWord} amount`}
            />

            <span className="psize__amount">
              <i aria-hidden="true">$</i>
              <input
                className="psize__input num"
                type="number"
                inputMode="numeric"
                min={ctx.minTo}
                max={ctx.maxTo}
                step={Math.max(1, Math.round(bigBlind))}
                value={draft ?? String(sizeTo)}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitDraft}
                onKeyDown={onFieldKey}
                aria-label={`${raiseWord} amount in chips`}
              />
            </span>

            <span className="psize__bb num">{formatBB(sizeTo, bigBlind)}</span>
          </div>

          <button type="button" className="btn btn--gold psize__confirm" onClick={confirm}>
            {ctx.canBet ? `Bet ${formatMoney(sizeTo)}` : `Raise to ${formatMoney(sizeTo)}`}
            {isAllIn && <em className="psize__allin">all-in</em>}
            <Kbd>⏎</Kbd>
          </button>

          <p className="psize__meta num">
            Min {formatMoney(ctx.minTo)} · Max {formatMoney(ctx.maxTo)} · steps of{' '}
            {formatMoney(bigBlind)}
          </p>
        </div>
      )}
    </div>
  )
}
