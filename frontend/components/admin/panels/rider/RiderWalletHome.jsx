import { RIDER_WALLET_BASE } from '../../../../hooks/useRiderWallet.js'
import AddDestinationForm from '../../../wallet/AddDestinationForm.jsx'
import DestinationsList from '../../../wallet/DestinationsList.jsx'
import WithdrawForm from '../../../wallet/WithdrawForm.jsx'
import WithdrawalHistory from '../../../wallet/WithdrawalHistory.jsx'
import { accraWhen, percentFromBp } from '../../../wallet/riderMoney.js'
import { formatGhs, signedGhs } from '../../../wallet/walletMoney.js'
import { walletStyles } from '../../../wallet/walletStyles.js'

const TONE = 'dashboard'

// The third-party rider's Wallet tab. `summary` is useRiderWallet().data, owned by the
// parent; the wallet children own their own hooks on the rider base path. Every figure
// and sentence about money comes from the server.
export default function RiderWalletHome({ summary, onNavigate, onChanged }) {
  const s = walletStyles(TONE)
  const changed = () => { if (onChanged) onChanged() }
  if (!summary) return null

  const count = summary.withdrawals_per_day != null && summary.withdrawals_today != null
  const used = count && Number(summary.withdrawals_today) >= Number(summary.withdrawals_per_day)
  const resets = accraWhen(summary.withdrawals_reset_at)
  const awaiting = Number(summary.awaiting_release) || 0

  const refusalAction = (code) => (code === 'id_required' && onNavigate ? (
    <div style={{ marginTop: 8 }}>
      <button type="button" style={s.ghost} onClick={() => onNavigate('dr-documents')}>Open Documents &amp; vehicle</button>
    </div>
  ) : null)

  const heading = { margin: '24px 0 8px', fontSize: 16, fontWeight: 700, color: s.value.color }

  return (
    <div>
      <section style={s.card} aria-label="Your balance">
        <div style={s.label}>Your balance</div>
        <div style={{ ...s.amount, fontSize: 32 }}>{signedGhs(summary.balance)}</div>
        {summary.balance_note && <div style={{ ...s.note, marginTop: 8 }}>{summary.balance_note}</div>}
      </section>

      <section style={{ ...s.card, marginTop: 16 }} aria-label="Commission held">
        <div style={s.label}>Commission held</div>
        <div style={{ ...s.amount, fontSize: 22 }}>{formatGhs(summary.reserve)}</div>
        {summary.reserve_note && <div style={{ ...s.note, marginTop: 8 }}>{summary.reserve_note}</div>}
        <div style={{ ...s.note, marginTop: 8 }}>
          AshantiHub&apos;s commission on orders paid now: {percentFromBp(summary.commission_bp)} of each delivery fee.
        </div>
        {summary.company_name ? <div style={{ ...s.note, marginTop: 4 }}>Rider company: {summary.company_name}</div> : null}
      </section>

      {awaiting > 0 && (
        <div style={{ ...s.note, marginTop: 16 }}>
          {awaiting} delivered {awaiting === 1 ? 'order waits' : 'orders wait'} for Support&apos;s call to the customer. You are paid for each once Support confirms it.
        </div>
      )}

      <h3 style={heading}>Withdraw</h3>
      <div style={s.note}>Money goes only to a payout number in your own name, once your Ghana Card is approved.</div>

      <h3 style={heading}>Your payout numbers</h3>
      <DestinationsList tone={TONE} basePath={RIDER_WALLET_BASE} onChanged={changed} />
      <div style={{ marginTop: 12 }}>
        <AddDestinationForm tone={TONE} basePath={RIDER_WALLET_BASE} onDone={changed} refusalAction={refusalAction} />
      </div>

      {count && (
        <div style={{ ...s.note, marginTop: 16 }}>
          Withdrawals today: <span style={s.amount}>{summary.withdrawals_today}</span> of <span style={s.amount}>{summary.withdrawals_per_day}</span>.
          {resets ? ` The count starts again at ${resets}.` : ''}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        {used ? (
          <div style={s.card}>
            <div style={s.value}>
              You have made today&apos;s {summary.withdrawals_per_day} withdrawals.{resets ? ` You can withdraw again from ${resets}.` : ''}
            </div>
          </div>
        ) : (
          <WithdrawForm tone={TONE} basePath={RIDER_WALLET_BASE} onDone={changed} refusalAction={refusalAction} />
        )}
      </div>

      <h3 style={heading}>Your withdrawals</h3>
      <WithdrawalHistory tone={TONE} basePath={RIDER_WALLET_BASE} onChanged={changed} />
    </div>
  )
}
