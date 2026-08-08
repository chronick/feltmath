import { useState, type ReactNode } from 'react'
import { Modal } from '../../../shared/ui/Modal'
import {
  setHotkeyLayout,
  useHotkeyLayout,
  type HotkeyLayout,
} from '../../../shared/ui/hotkeyLayout'
import { monteCarloMargin95 } from '../odds/equity'
import type { HoldemConfig } from '../types'
import { blindsLabel, configSummary, formatCount, formatMoney } from './format'

export interface HoldemSettingsProps {
  config: HoldemConfig
  /** true between hands — otherwise the change is staged for the next deal */
  canApplyNow: boolean
  onApply: (config: HoldemConfig) => void
  onClose: () => void
}

interface Option<T> {
  value: T
  label: string
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="hset__row">
      <div className="hset__label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="hset__control">{children}</div>
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
    <div className="hseg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`hseg__btn${option.value === value ? ' is-active' : ''}`}
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
      className="htoggle"
      data-on={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
    >
      <span className="htoggle__knob" />
      <span className="htoggle__text">{checked ? 'On' : 'Off'}</span>
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
    <div className="hstepper" role="group" aria-label={label}>
      <button
        type="button"
        className="hstepper__btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <span className="hstepper__value num">{value}</span>
      <button
        type="button"
        className="hstepper__btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  )
}

/** Blind ladders, small → big. The key is "sb/bb" so one control sets both. */
const BLIND_OPTIONS: Option<string>[] = [
  { value: '1/2', label: '$1/$2' },
  { value: '5/10', label: '$5/$10' },
  { value: '25/50', label: '$25/$50' },
]

const BUYIN_OPTIONS: Option<number>[] = [
  { value: 50, label: '50 bb' },
  { value: 100, label: '100 bb' },
  { value: 200, label: '200 bb' },
]

const SAMPLE_OPTIONS: Option<number>[] = [
  { value: 1000, label: '1k' },
  { value: 5000, label: '5k' },
  { value: 10000, label: '10k' },
]

const LAYOUT_OPTIONS: Option<HotkeyLayout>[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'ergonomic', label: 'Ergo' },
]

function blindKey(config: HoldemConfig): string {
  return `${config.smallBlind}/${config.bigBlind}`
}

/** Buy-in is edited in big blinds so it stays sane across blind levels. */
function buyInBB(config: HoldemConfig): number {
  const bb = Math.round(config.buyIn / Math.max(1, config.bigBlind))
  const nearest = BUYIN_OPTIONS.reduce((best, option) =>
    Math.abs(option.value - bb) < Math.abs(best.value - bb) ? option : best,
  )
  return nearest.value
}

export function HoldemSettings({ config, canApplyNow, onApply, onClose }: HoldemSettingsProps) {
  const [draft, setDraft] = useState<HoldemConfig>(config)
  const patch = (next: Partial<HoldemConfig>) => setDraft((current) => ({ ...current, ...next }))
  const layout = useHotkeyLayout()
  const depthBB = buyInBB(draft)
  const sampleMargin = monteCarloMargin95(draft.equitySamples) * 100

  const setBlinds = (key: string) => {
    const [sb, bb] = key.split('/').map(Number)
    if (!Number.isFinite(sb) || !Number.isFinite(bb)) return
    // keep the buy-in at the same depth in big blinds when the level changes
    const depth = Math.round(draft.buyIn / Math.max(1, draft.bigBlind))
    patch({ smallBlind: sb, bigBlind: bb, buyIn: Math.max(bb * 10, depth * bb) })
  }

  return (
    <Modal
      title="Table"
      subtitle={configSummary(draft)}
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
      <div className="hset">
        {!canApplyNow && (
          <p className="hset__notice">
            A hand is in play — these changes are staged and take effect on the next deal.
          </p>
        )}

        <Row label="Opponents" hint="AI seats, 1–5 (6-max including you)">
          <Stepper
            label="AI players"
            value={draft.aiPlayers}
            min={1}
            max={5}
            onChange={(aiPlayers) => patch({ aiPlayers })}
          />
        </Row>

        <Row label="Blinds" hint={`Currently ${blindsLabel(draft)}`}>
          <Segmented
            label="Blind level"
            value={blindKey(draft)}
            options={BLIND_OPTIONS}
            onChange={setBlinds}
          />
        </Row>

        <Row label="Buy-in" hint={`${formatMoney(draft.buyIn)} at these blinds · charts use a 100 bb baseline`}>
          <Segmented
            label="Buy-in depth"
            value={depthBB}
            options={BUYIN_OPTIONS}
            onChange={(bb) => patch({ buyIn: bb * draft.bigBlind })}
          />
        </Row>

        {depthBB !== 100 && (
          <p className="hset__notice">
            Preflop charts and sizing are calibrated for 100 bb. At {depthBB} bb, treat them as a
            baseline: shorter stacks reduce implied odds; deeper stacks increase positional and
            reverse-implied-odds effects.
          </p>
        )}

        <Row label="Auto top-up" hint="Rebuy short stacks back to the buy-in between hands">
          <Toggle
            label="Auto top-up"
            checked={draft.topUp}
            onChange={(topUp) => patch({ topUp })}
          />
        </Row>

        <Row
          label="Equity samples"
          hint={`${formatCount(draft.equitySamples)} random-hand runs · approx. 95% margin ±${sampleMargin.toFixed(1)} points`}
        >
          <Segmented
            label="Equity samples"
            value={draft.equitySamples}
            options={SAMPLE_OPTIONS}
            onChange={(equitySamples) => patch({ equitySamples })}
          />
        </Row>

        <Row
          label="Hotkey layout"
          hint={
            layout === 'ergonomic'
              ? 'Space check/call · F fold · D bet/raise · A all-in — applies now, both games'
              : 'Letters match the actions (F, C, R, A) — applies now, both games'
          }
        >
          <Segmented
            label="Hotkey layout"
            value={layout}
            options={LAYOUT_OPTIONS}
            onChange={setHotkeyLayout}
          />
        </Row>
      </div>
    </Modal>
  )
}
