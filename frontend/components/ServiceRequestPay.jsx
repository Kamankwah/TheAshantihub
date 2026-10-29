import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../apiClient.js'
import { useCanBuy } from '../hooks/useCanBuy.js'
import { useBookingPayment } from '../hooks/useBookingPayment.js'
import { apiErrorMessage } from '../lib/apiErrorMessage.js'
import PaymentMethodPicker from './wallet/PaymentMethodPicker.jsx'
import { walletStyles } from './wallet/walletStyles.js'

// Paying for an accepted service request: before the marketplace opens the
// button is greyed with "Opens <D Mon>" (useCanBuy); while the wallet ledger
// is on the customer picks mobile money or the AshantiHub wallet; mobile
// money opens PaymentComponent (a prop: components never import App.jsx) with
// the server's processing quote, the wallet posts once with no modal. Every
// amount shown is the server's string.
export default function ServiceRequestPay({ sr, PaymentComponent, onPaid }) {
  const s = walletStyles('dashboard')
  const queryClient = useQueryClient()
  const { canBuy, label: opensLabel } = useCanBuy()
  const pay = useBookingPayment({ amount: sr.agreed_price, enabled: canBuy })
  const [modal, setModal] = useState(false)
  const [error, setError] = useState(null)
  const [paid, setPaid] = useState(false) // the tab shows the paid line, which must survive this unmounting
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)

  const post = async (afterMoMo) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    let redirecting = false
    try {
      const res = await apiPost(`/api/services/requests/${sr.id}/pay/`, pay.body)
      if (res?.mode === 'redirect') {
        // The in-flight guard stays set while the browser leaves, and the modal closes.
        redirecting = true
        setModal(false)
        window.location.href = res.checkout_url
        return
      }
      setModal(false)
      setPaid(true)
      queryClient.invalidateQueries({ queryKey: ['wallet'] })
      onPaid && onPaid(res)
    } catch (err) {
      const code = err?.body?.code
      if ((err?.status === 409 && (code === 'insufficient_funds' || code === 'ledger_off')) || (err?.status === 403 && code === 'not_open')) {
        setModal(false)
        setError(err.body.detail || apiErrorMessage(err, 'We could not take the payment.'))
      } else if (afterMoMo) {
        setError("Payment went through but we couldn't start the job — please contact support.")
      } else {
        setError(apiErrorMessage(err, 'We could not take the payment. Try again.'))
      }
    } finally {
      if (!redirecting) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }

  const start = () => {
    if (!canBuy || !pay.ready || busy) return
    if (pay.method === 'wallet' && pay.ledgerOn) post(false)
    else setModal(true)
  }

  if (paid) return null

  const walletPay = pay.ledgerOn && pay.method === 'wallet'
  const checking = canBuy && pay.state === 'unknown' && !pay.problem
  const label = !canBuy
    ? opensLabel
    : walletPay
      ? `Pay GH₵ ${sr.agreed_price} from your AshantiHub wallet`
      : <>💳 Pay GHS {sr.agreed_price} to start</>
  const disabled = !canBuy || !pay.ready || busy

  return (
    <div style={{ marginTop: 10 }}>
      {canBuy && pay.ledgerOn && (
        <PaymentMethodPicker value={pay.method} onChange={pay.setMethod} amount={sr.agreed_price} tone="dashboard" />
      )}
      {checking && <div role="status" style={s.note}>Checking payment options…</div>}
      {canBuy && pay.problem && <div role="alert" style={s.error}>{pay.problem}</div>}
      {!checking && (
        <button type="button" onClick={start} disabled={disabled} aria-disabled={disabled} style={{ ...s.button, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
          {label}
        </button>
      )}
      {error && <div role="alert" style={{ ...s.error, marginTop: 8 }}>{error}</div>}
      {modal && PaymentComponent && (
        <PaymentComponent
          amount={parseFloat(sr.agreed_price) || 0}
          {...(pay.ledgerOn ? { processing: pay.processing } : {})}
          onSuccess={() => post(true)}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  )
}
