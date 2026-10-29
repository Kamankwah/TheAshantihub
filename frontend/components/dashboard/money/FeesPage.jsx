import { useState } from 'react'
import { useVendorFees } from '../../../hooks/useVendorMoney.js'
import { formatGhs, isPlausibleAmount } from '../../wallet/walletMoney.js'
import { walletMessage } from '../../wallet/walletErrors.js'
import { walletStyles } from '../../wallet/walletStyles.js'
import { D } from '../theme.js'
import FeeCapMeter from './FeeCapMeter.jsx'

// Platform fees, owner-only: the approved schedule per category, the lifetime
// cap, and a quote the SERVER works out (nothing is calculated here). Typing
// sends nothing; only "Work it out" stores {amount, category} and asks.
const s = walletStyles('dashboard')
const cell = { padding: '8px 10px', textAlign: 'left', borderBottom: `1px solid ${D.divider}`, fontSize: 13, color: D.text }
const head = { ...cell, fontSize: 12, fontWeight: 700, color: D.textDim }
const money = (value) => <span data-amount style={s.amount}>{formatGhs(value)}</span>

function Bands({ bands }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th scope="col" style={head}>From</th>
            <th scope="col" style={head}>To</th>
            <th scope="col" style={head}>Fee</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b, i) => (
            <tr key={i}>
              <td style={cell}>{money(b.from)}</td>
              <td style={cell}>{b.to === null || b.to === undefined ? 'and above' : money(b.to)}</td>
              <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{b.fee}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CategoryCard({ c }) {
  const hasBands = Array.isArray(c.bands) && c.bands.length > 0
  return (
    <section data-category={c.category} style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 16, color: D.text }}>{c.label}</h3>
      <div style={s.note}>{c.applies_to}</div>
      {c.charged === false && <div style={s.note}>Not charged yet.</div>}
      {hasBands ? (
        <>
          {c.in_force_from && <div style={s.note}>In force since {c.in_force_from.slice(0, 10)}</div>}
          <Bands bands={c.bands} />
        </>
      ) : (
        <div style={s.note}>No fees are set for this category.</div>
      )}
      {c.next && (
        <div>
          <div style={{ ...s.value, fontWeight: 700, marginBottom: 6 }}>From {c.next.from.slice(0, 10)}:</div>
          <Bands bands={c.next.bands} />
        </div>
      )}
    </section>
  )
}

function QuoteLine({ quote }) {
  if (quote === null) return <div style={s.note}>No fees are set for this category yet.</div>
  if (!quote) return null
  return (
    <div data-testid="fee-quote" style={s.value}>
      On a {money(quote.amount)} sale paid now: platform fee {money(quote.fee)}, you get {money(quote.you_receive)}. Your lifetime cap is counted.
      {quote.charged === false && <> Not charged yet.</>}
    </div>
  )
}

export default function FeesPage() {
  const { data, error, isLoading } = useVendorFees({})
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [stored, setStored] = useState(null)
  const answer = useVendorFees({ amount: stored?.amount, category: stored?.category, enabled: Boolean(stored) })

  if (isLoading) return <div style={s.note}>Loading…</div>
  if (error) return <div role="alert" style={s.error}>{walletMessage(error).text}</div>
  if (!data) return null

  const categories = data.categories || []
  const chosen = category || categories[0]?.category || ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {data.fee_base && <div style={s.note}>{data.fee_base}</div>}
      <FeeCapMeter feeCap={data.fee_cap} />
      {categories.map((c) => <CategoryCard key={c.category} c={c} />)}

      <div style={s.card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: D.text }}>Work out a fee</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 160px', minWidth: 0 }}>
            <span style={s.label}>Sale amount (GH₵)</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={s.field} />
          </label>
          <label style={{ flex: '1 1 160px', minWidth: 0 }}>
            <span style={s.label}>Category</span>
            <select value={chosen} onChange={(e) => setCategory(e.target.value)} style={s.field}>
              {categories.map((c) => <option key={c.category} value={c.category}>{c.label}</option>)}
            </select>
          </label>
          <button
            type="button" style={{ ...s.button, opacity: isPlausibleAmount(amount) ? 1 : 0.5 }}
            disabled={!isPlausibleAmount(amount)}
            onClick={() => setStored({ amount, category: chosen })}
          >Work it out</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {stored && answer.isLoading && <div style={s.note}>Working it out…</div>}
          {stored && answer.error && <div role="alert" style={s.error}>{walletMessage(answer.error).text}</div>}
          {stored && answer.data && !answer.error && <QuoteLine quote={answer.data.quote} />}
        </div>
      </div>
    </div>
  )
}
