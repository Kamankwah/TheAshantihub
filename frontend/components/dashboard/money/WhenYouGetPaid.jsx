import { useBookingTerms } from '../../../hooks/useBookingTerms.js'
import { hoursText } from '../../../lib/bookingTerms.js'
import { walletStyles } from '../../wallet/walletStyles.js'

// When each kind of sale is paid out. Every hour figure is the server's
// (booking-terms); nothing is shown while they are off, loading or failed.
export default function WhenYouGetPaid() {
  const s = walletStyles('dashboard')
  const { data: terms, isLoading, isError } = useBookingTerms()
  if (isLoading || isError || !terms || terms.enabled === false) return null
  return (
    <div style={s.card}>
      <span style={s.label}>When you get paid</span>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li style={s.value}>Product orders: after AshantiHub Support calls the customer and the order matches what was bought.</li>
        <li style={s.value}>Services: when the customer accepts, or {hoursText(terms.service_auto_accept_hours)} after you mark the job done.</li>
        <li style={s.value}>Stays: {hoursText(terms.stay_issue_window_hours)} after the guest's check-in time ({terms.stay_check_in_time}).</li>
        <li style={s.value}>Event tickets: {hoursText(terms.event_release_delay_hours)} after the end of the event day.</li>
      </ul>
      <div style={{ ...s.note, marginTop: 10 }}>
        A problem reported before then holds the money until AshantiHub Support settles it. The platform fee is taken at release.
      </div>
    </div>
  )
}
