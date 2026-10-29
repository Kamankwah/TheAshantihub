import { useState } from 'react'
import { apiDelete, apiPost } from '../../apiClient.js'
import { useAddresses } from '../../hooks/useAddresses.js'
import { C } from '../../theme.js'
import { walletStyles } from '../wallet/walletStyles.js'
import AddressCard from './AddressCard.jsx'
import AddressForm from './AddressForm.jsx'

const BASE = '/api/accounts/addresses/'
const link = (s) => ({ ...s.ghost, minHeight: 36, padding: '4px 12px', fontSize: 13 })

// "Your Addresses": a dashed Add tile and one card per saved address
// (Edit - Remove - Set as default). Mounted in the account hub.
export default function YourAddresses() {
  const s = walletStyles('light')
  const { data, isLoading, error, refetch } = useAddresses()
  const [editing, setEditing] = useState(null) // 'new' | address id
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState(null)

  if (isLoading) return <div style={s.note}>Loading your addresses…</div>
  if (error) {
    return (
      <div role="alert" style={s.error}>
        We could not load your addresses.{' '}
        <button type="button" style={link(s)} onClick={() => refetch()}>Try again</button>
      </div>
    )
  }
  const rows = Array.isArray(data) ? data : []

  async function run(id, fn) {
    if (busyId) return
    setBusyId(id)
    setActionError(null)
    try {
      await fn()
      await refetch()
    } catch (err) {
      const d = err?.body?.detail
      setActionError(typeof d === 'string' ? d : 'That did not work. Please try again.')
    } finally {
      setBusyId(null)
    }
  }
  const remove = (a) => {
    if (!window.confirm('Remove this address? Orders already placed are not affected.')) return
    run(a.id, () => apiDelete(`${BASE}${a.id}/`))
  }
  const makeDefault = (a) => run(a.id, () => apiPost(`${BASE}${a.id}/set-default/`, {}))
  const saved = async () => { setEditing(null); await refetch() }
  // A save can have worked while its set-default did not, so closing the form always re-reads the book.
  const cancelEdit = () => { setEditing(null); refetch() }

  return (
    <section aria-label="Your addresses" style={{ display: 'grid', gap: 12 }}>
      {actionError && <div role="alert" style={s.error}>{actionError}</div>}
      {editing === 'new' && <AddressForm onSave={saved} onCancel={cancelEdit} />}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {editing !== 'new' && (
          <button
            type="button" onClick={() => setEditing('new')}
            style={{ background: 'transparent', color: C.ink, border: `2px dashed ${C.line}`, borderRadius: 12, minHeight: 120, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
          >
            + Add address
          </button>
        )}
        {rows.map((a) => (
          editing === a.id ? (
            <div key={a.id} style={{ gridColumn: '1 / -1' }}>
              <AddressForm initial={a} onSave={saved} onCancel={cancelEdit} />
            </div>
          ) : (
            <AddressCard key={a.id} address={a}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" style={link(s)} onClick={() => setEditing(a.id)} disabled={busyId === a.id}>Edit</button>
                <button type="button" style={link(s)} onClick={() => remove(a)} disabled={busyId === a.id}>Remove</button>
                {!a.is_default && (
                  <button type="button" style={link(s)} onClick={() => makeDefault(a)} disabled={busyId === a.id}>Set as default</button>
                )}
              </div>
            </AddressCard>
          )
        ))}
      </div>
    </section>
  )
}
