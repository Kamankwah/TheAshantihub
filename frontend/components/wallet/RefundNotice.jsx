import { walletStyles } from './walletStyles.js'

// The notice inside a refund row (kind order_refund or booking_refund,
// direction in): where the money went, and for which order when there is one.
// It states nothing the row does not carry: no reason, no processing-charge
// claim, no date promise. Exported for Plan 4's order pages.
//
// OPEN GAP (spec gate (xvi), recorded in docs by Task 10): dispute and
// delivery refunds send the customer no notification, so this statement row is
// the only notice until the backend notifies.
export default function RefundNotice({ line, tone = 'light' }) {
  const s = walletStyles(tone)
  const text = line?.order
    ? `Refunded to your AshantiHub wallet for order #${line.order}`
    : 'Refunded to your AshantiHub wallet'
  return <div style={s.note}>{text}</div>
}
