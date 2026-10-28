import { useVendorWalletOverview } from '../../../hooks/useWallet.js'
import BalanceSummary from '../../wallet/BalanceSummary.jsx'
import { formatGhs } from '../../wallet/walletMoney.js'
import { walletStyles } from '../../wallet/walletStyles.js'
import FeeCapMeter from './FeeCapMeter.jsx'
import WhenYouGetPaid from './WhenYouGetPaid.jsx'

// The Money tab's first sub-tab. Every figure is what the server sent.
export default function MoneyOverview({ onOpenPayouts }) {
  const s = walletStyles('dashboard')
  const { data } = useVendorWalletOverview()
  const showWithdrawing = data?.withdrawing != null && data.withdrawing !== '0.00'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <BalanceSummary tone="dashboard" />
      {data && (
        <div style={s.card}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <span style={s.label}>Can be withdrawn now</span>
              <div data-amount style={{ ...s.amount, fontSize: 18 }}>{formatGhs(data.withdrawable)}</div>
            </div>
            {showWithdrawing && (
              <div>
                <span style={s.label}>On its way to your payout number</span>
                <div data-amount style={{ ...s.amount, fontSize: 18 }}>{formatGhs(data.withdrawing)}</div>
              </div>
            )}
            <div>
              <span style={s.label}>Sales waiting to be released</span>
              <div style={{ ...s.value, fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{data.awaiting_call}</div>
            </div>
          </div>
        </div>
      )}
      {data && <FeeCapMeter feeCap={data.fee_cap} />}
      <div>
        <button type="button" style={s.ghost} onClick={() => onOpenPayouts()}>Withdraw or manage payout numbers</button>
      </div>
      <WhenYouGetPaid />
    </div>
  )
}
