import { useState } from 'react'
import { apiDownload } from '../../../apiClient.js'
import { walletMessage } from '../../wallet/walletErrors.js'
import { walletStyles } from '../../wallet/walletStyles.js'

// The CSV statement. A plain handler, no mutation hook; the button is
// disabled while the request is in flight so a double click downloads once.
// No Accept header is sent: the server answers 406 to "text/csv".
const s = walletStyles('dashboard')

export default function StatementDownload() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function download() {
    if (busy) return
    setBusy(true)
    setError(null)
    const params = new URLSearchParams()
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    const qs = params.toString() ? `?${params}` : ''
    const filename = dateFrom && dateTo ? `ashantihub-statement-${dateFrom}-to-${dateTo}.csv` : 'ashantihub-statement.csv'
    try {
      await apiDownload(`/api/wallet/vendor/statement/export/${qs}`, filename)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={s.value}>Your sales, bookings and withdrawals with the platform fee shown separately, as a CSV.</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 140px', minWidth: 0 }}>
          <span style={s.label}>From (optional)</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={s.field} />
        </label>
        <label style={{ flex: '1 1 140px', minWidth: 0 }}>
          <span style={s.label}>To (optional)</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={s.field} />
        </label>
      </div>
      {error && <div role="alert" style={s.error}>{walletMessage(error).text}</div>}
      <div>
        <button type="button" style={{ ...s.button, opacity: busy ? 0.6 : 1 }} disabled={busy} aria-busy={busy} onClick={download}>
          Download statement
        </button>
      </div>
    </div>
  )
}
