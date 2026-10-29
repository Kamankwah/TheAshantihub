import { C, tint } from '../../theme.js'
import { walletStyles } from '../wallet/walletStyles.js'

// One saved address, read-only. Recipient, GhanaPost code, landmark, phone and
// the Default tag; `children` carry the actions or selection state.
export default function AddressCard({ address, children, ringed = false }) {
  const s = walletStyles('light')
  return (
    <article
      style={{ ...s.card, padding: 16, display: 'grid', gap: 4, boxShadow: ringed ? `0 0 0 2px ${C.ink}` : 'none' }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{address.recipient_name}</strong>
        <span style={{ ...s.note }}>{address.label}</span>
        {address.is_default && (
          <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: tint(C.trust, '22'), color: C.trust }}>Default</span>
        )}
      </div>
      <div style={{ ...s.value, fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)' }}>{address.gps_address}</div>
      <div style={s.value}>{address.landmark}</div>
      {address.address_text && <div style={s.note}>{address.address_text}</div>}
      <div style={{ ...s.note, fontVariantNumeric: 'tabular-nums' }}>{address.phone}</div>
      {children}
    </article>
  )
}
