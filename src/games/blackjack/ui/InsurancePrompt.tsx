import { Kbd } from '../../../shared/ui/Kbd'
import { formatMoney } from './format'

export interface InsurancePromptProps {
  /** the main bet — insurance costs half of it */
  mainBet: number
  bankroll: number
  onTake: () => void
  onDecline: () => void
}

/** Insurance is exactly half the main wager, including half-chip amounts. */
export function insuranceCost(mainBet: number): number {
  return Number.isFinite(mainBet) ? Math.max(0, mainBet / 2) : 0
}

export function InsurancePrompt({ mainBet, bankroll, onTake, onDecline }: InsurancePromptProps) {
  const cost = insuranceCost(mainBet)
  const affordable = cost > 0 && cost <= bankroll

  return (
    <div className="insurance" role="dialog" aria-label="Insurance offered">
      <div className="insurance__card">
        <span className="smallcaps">Dealer shows an Ace</span>
        <h3 className="insurance__title">Insurance? Pays 2:1</h3>
        <p className="insurance__body">
          Costs {formatMoney(cost)} (half your bet) and only wins if the dealer has blackjack.
          The book says decline — it&apos;s a losing side bet unless you&apos;re counting.
        </p>
        <div className="insurance__actions">
          <button type="button" className="btn btn--ghost" onClick={onTake} disabled={!affordable}>
            Yes, insure
            <Kbd>Y</Kbd>
          </button>
          <button type="button" className="btn btn--gold" onClick={onDecline}>
            No thanks
            <Kbd>N</Kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
