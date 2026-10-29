import { D } from '../theme.js'
import { formatGhs, ghsToPesewas } from '../../wallet/walletMoney.js'
import { walletStyles } from '../../wallet/walletStyles.js'

// The lifetime platform-fee cap, as the server sent it: {limit, used, remaining}.
// The only arithmetic is the bar's fill width, from two server strings parsed
// to whole pesewas. Owner-only: fees are never shown to a customer.
export default function FeeCapMeter({ feeCap }) {
  const s = walletStyles('dashboard')
  if (!feeCap) return null
  const amount = (value) => <span data-amount style={s.amount}>{formatGhs(value)}</span>

  if (feeCap.limit === null || feeCap.limit === undefined) {
    return (
      <div style={s.card}>
        <div style={s.value}>No lifetime cap on platform fees. Fees so far: {amount(feeCap.used)}.</div>
      </div>
    )
  }

  const limit = ghsToPesewas(feeCap.limit)
  const used = ghsToPesewas(feeCap.used)
  const known = limit !== null && limit > 0 && used !== null
  const percent = known ? Math.min(used / limit, 1) * 100 : 0
  return (
    <div style={s.card}>
      <div style={s.value}>
        Platform fees so far: {amount(feeCap.used)} of your {amount(feeCap.limit)} lifetime cap. {amount(feeCap.remaining)} left.
      </div>
      {known && (
        <div
          role="meter"
          aria-label="Lifetime fee cap used"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={`GH₵ ${feeCap.used} of GH₵ ${feeCap.limit}`}
          style={{ marginTop: 12, height: 10, borderRadius: 5, background: D.panelBg2, overflow: 'hidden' }}
        >
          <div style={{ width: `${percent}%`, height: '100%', background: D.blue }} />
        </div>
      )}
      {feeCap.remaining === '0.00' && (
        <div style={{ ...s.note, marginTop: 10 }}>You have reached your cap: no more platform fees are taken.</div>
      )}
    </div>
  )
}
