import { useState, type ReactNode } from 'react'
import { Modal } from '../../../shared/ui/Modal'
import type { RulesConfig } from '../types'
import { rulesSummary } from './format'

export interface SettingsModalProps {
  rules: RulesConfig
  /** true during the betting phase — otherwise changes are staged */
  canApplyNow: boolean
  onApply: (rules: RulesConfig) => void
  onClose: () => void
}

interface Option<T> {
  value: T
  label: string
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set__row">
      <div className="set__label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set__control">{children}</div>
    </div>
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Option<T>[]
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`seg__btn${option.value === value ? ' is-active' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      data-on={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
      <span className="toggle__text">{checked ? 'On' : 'Off'}</span>
    </button>
  )
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  label: string
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <span className="stepper__value num">{value}</span>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  )
}

const DECK_OPTIONS: Option<RulesConfig['decks']>[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 6, label: '6' },
  { value: 8, label: '8' },
]

const PAYOUT_OPTIONS: Option<RulesConfig['blackjackPayout']>[] = [
  { value: 1.5, label: '3:2' },
  { value: 1.2, label: '6:5' },
]

const DOUBLE_OPTIONS: Option<RulesConfig['doubleOn']>[] = [
  { value: 'any2', label: 'Any 2' },
  { value: '9to11', label: '9–11' },
  { value: '10to11', label: '10–11' },
]

export function SettingsModal({ rules, canApplyNow, onApply, onClose }: SettingsModalProps) {
  const [draft, setDraft] = useState<RulesConfig>(rules)
  const patch = (next: Partial<RulesConfig>) => setDraft((current) => ({ ...current, ...next }))

  return (
    <Modal
      title="Table rules"
      subtitle={rulesSummary(draft)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--gold" onClick={() => onApply(draft)}>
            {canApplyNow ? 'Apply' : 'Apply next hand'}
          </button>
        </>
      }
    >
      <div className="set">
        {!canApplyNow && (
          <p className="set__notice">
            A hand is in play — these changes are staged and take effect on the next deal.
          </p>
        )}

        <Row label="Decks" hint="Shoe size">
          <Segmented
            label="Decks"
            value={draft.decks}
            options={DECK_OPTIONS}
            onChange={(decks) => patch({ decks })}
          />
        </Row>

        <Row label="Dealer hits soft 17" hint="H17 · worse for the player">
          <Toggle
            label="Dealer hits soft 17"
            checked={draft.dealerHitsSoft17}
            onChange={(dealerHitsSoft17) => patch({ dealerHitsSoft17 })}
          />
        </Row>

        <Row label="Blackjack pays" hint="6:5 costs about 1.4% of edge">
          <Segmented
            label="Blackjack payout"
            value={draft.blackjackPayout}
            options={PAYOUT_OPTIONS}
            onChange={(blackjackPayout) => patch({ blackjackPayout })}
          />
        </Row>

        <Row label="Double after split" hint="DAS">
          <Toggle
            label="Double after split"
            checked={draft.doubleAfterSplit}
            onChange={(doubleAfterSplit) => patch({ doubleAfterSplit })}
          />
        </Row>

        <Row label="Ten-value pairs" hint="House rule">
          <span className="smallcaps">Same rank only</span>
        </Row>

        <Row label="Double on" hint="Which two-card totals may double">
          <Segmented
            label="Double on"
            value={draft.doubleOn}
            options={DOUBLE_OPTIONS}
            onChange={(doubleOn) => patch({ doubleOn })}
          />
        </Row>

        <Row label="Re-split aces">
          <Toggle
            label="Re-split aces"
            checked={draft.resplitAces}
            onChange={(resplitAces) => patch({ resplitAces })}
          />
        </Row>

        <Row label="Hit split aces" hint="Off = one card each">
          <Toggle
            label="Hit split aces"
            checked={draft.hitSplitAces}
            onChange={(hitSplitAces) => patch({ hitSplitAces })}
          />
        </Row>

        <Row label="Late surrender" hint="Fold for half your bet">
          <Toggle
            label="Late surrender"
            checked={draft.lateSurrender}
            onChange={(lateSurrender) => patch({ lateSurrender })}
          />
        </Row>

        <Row label="Offer insurance" hint="Prompt when the dealer shows an ace">
          <Toggle
            label="Offer insurance"
            checked={draft.insurance}
            onChange={(insurance) => patch({ insurance })}
          />
        </Row>

        <Row label="AI players" hint="Companions at the table, 0–6">
          <Stepper
            label="AI players"
            value={draft.aiPlayers}
            min={0}
            max={6}
            onChange={(aiPlayers) => patch({ aiPlayers })}
          />
        </Row>

        <Row label="Penetration" hint="How deep the shoe is dealt before a shuffle">
          <div className="slider">
            <input
              type="range"
              min={50}
              max={90}
              step={5}
              value={Math.round(draft.penetration * 100)}
              onChange={(event) => patch({ penetration: Number(event.target.value) / 100 })}
              aria-label="Penetration percent"
            />
            <span className="slider__value num">{Math.round(draft.penetration * 100)}%</span>
          </div>
        </Row>
      </div>
    </Modal>
  )
}
