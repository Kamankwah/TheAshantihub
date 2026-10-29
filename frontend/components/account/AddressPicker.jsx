import { useState } from 'react'
import { useAddresses } from '../../hooks/useAddresses.js'
import { walletStyles } from '../wallet/walletStyles.js'
import AddressCard from './AddressCard.jsx'
import AddressForm from './AddressForm.jsx'

// Choose a saved address (used by checkout). `value` is the chosen address id
// (or the address object); `onChange(address)` receives the whole row (id +
// fields). "Add a new address" opens the form inline and selects the new row.
// Nothing is preselected here: the caller decides (the default is first in the list).
export default function AddressPicker({ value, onChange }) {
  const s = walletStyles('light')
  const { data, isLoading, error, refetch } = useAddresses()
  const [adding, setAdding] = useState(false)
  const chosen = value && typeof value === 'object' ? value.id : value
  const rows = Array.isArray(data) ? data : []

  if (isLoading) return <div style={s.note}>Loading your addresses…</div>
  if (error) {
    return (
      <div role="alert" style={s.error}>
        We could not load your addresses.{' '}
        <button type="button" style={{ ...s.ghost, minHeight: 36, padding: '4px 12px' }} onClick={() => refetch()}>Try again</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((a) => {
        const on = a.id === chosen
        return (
          <button
            key={a.id} type="button" aria-pressed={on} onClick={() => onChange?.(a)}
            aria-label={`${a.recipient_name}, ${a.gps_address}${a.is_default ? ', default' : ''}${on ? ', selected' : ''}`}
            style={{ all: 'unset', display: 'block', cursor: 'pointer', borderRadius: 12 }}
          >
            <AddressCard address={a} ringed={on}>
              {on && <div style={{ ...s.note, fontWeight: 700 }}>Delivering here</div>}
            </AddressCard>
          </button>
        )
      })}
      {adding ? (
        <AddressForm
          onCancel={() => setAdding(false)}
          onSave={async (row) => {
            await refetch()
            setAdding(false)
            onChange?.(row)
          }}
        />
      ) : (
        <button type="button" style={s.ghost} onClick={() => setAdding(true)}>Add a new address</button>
      )}
    </div>
  )
}
