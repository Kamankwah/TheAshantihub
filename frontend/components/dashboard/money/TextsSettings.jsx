import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPatch } from '../../../apiClient.js'
import { useVendorTexts } from '../../../hooks/useVendorMoney.js'
import { formatAccra } from '../../../lib/bookingTerms.js'
import { walletMessage } from '../../wallet/walletErrors.js'
import { walletStyles } from '../../wallet/walletStyles.js'
import { D } from '../theme.js'
import { textKindWord } from './moneyWords.js'

// Which money texts the business gets, the daily-digest switch, and the recent
// texts as the server recorded them. The box shows only the server's value;
// the change is a plain apiPatch, guarded by a ref (set before the await) and
// disabled in flight so a double click posts once. No contact links: the
// number can only be changed through the server's own flow.
const s = walletStyles('dashboard')
const KEY = ['wallet', 'vendor', 'texts']
const when = (iso) => formatAccra(new Date(iso))

export default function TextsSettings() {
  const queryClient = useQueryClient()
  const { data, error, isLoading } = useVendorTexts()
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const inFlight = useRef(false)

  async function toggle() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setSaveError(null)
    try {
      const body = await apiPatch('/api/wallet/vendor/texts/', { daily_digest: !data.daily_digest })
      // Keep what the answer does not carry (a partial answer must not drop fields).
      queryClient.setQueryData(KEY, (old) => ({ ...(old || {}), ...body }))
    } catch (e) {
      setSaveError(e)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (isLoading) return <div style={s.note}>Loading…</div>
  if (error) return <div style={s.card}><div role="alert" style={s.error}>{walletMessage(error).text}</div></div>
  if (!data) return null
  const recent = data.recent || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        {data.order_texts && (
          <div style={s.value}>Texts for every paid sale and every release (orders, services, stays and tickets) always go to your number.</div>
        )}
        <div style={s.note}>Texts also go when a refund, a withdrawal or a low or below-zero balance touches your money, and when a booking's payment is put on hold.</div>
        {data.phone
          ? <div style={s.value}>{`Texts go to ${data.phone}.`}</div>
          : data.note && <div style={{ ...s.note, background: D.panelBg2, border: `1px solid ${D.cardBorder}`, borderRadius: 8, padding: '10px 12px' }}>{data.note}</div>}
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, color: D.text, fontSize: 15 }}>
          <input type="checkbox" checked={!!data.daily_digest} disabled={busy} onChange={toggle} style={{ width: 20, height: 20 }} />
          <span>Send me a daily summary text of the day before</span>
        </label>
        {saveError && <div role="alert" style={s.error}>{walletMessage(saveError).text}</div>}
      </div>

      <div style={{ ...s.card, minWidth: 0 }}>
        <div style={{ ...s.label, marginBottom: 10 }}>Recent texts</div>
        {recent.length === 0
          ? <div style={s.note}>No texts yet.</div>
          : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recent.map((t) => (
                <li key={t.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 10, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: D.text, fontSize: 14 }}>{textKindWord(t.kind)}</strong>
                    <span style={s.note}>{when(t.created_at)}</span>
                  </div>
                  <div style={{ ...s.value, overflowWrap: 'anywhere', margin: '4px 0' }}>{t.body}</div>
                  <div style={{ ...s.note, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>{t.status_label}</span>
                    {t.to && <span>To {t.to}</span>}
                    {t.sent_at && <span>{`Sent ${when(t.sent_at)}`}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  )
}
