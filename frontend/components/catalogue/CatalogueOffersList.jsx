import { useCatalogueProductOffers } from '../../hooks/useCatalogueLookup.js'
import { useMyListings } from '../../hooks/useMyListings.js'
import { apiErrorMessage } from '../../lib/apiErrorMessage.js'
import { D, glassCard } from '../dashboard/theme.js'
import { CONDITION_LABEL, PRICE_BASIS_LABEL, formatPrice } from './catalogueFormat.js'

const note = { color: D.textDim, fontSize: '0.74rem', margin: '4px 0 0' }

export default function CatalogueOffersList({ productId }) {
  const { data, error, isLoading } = useCatalogueProductOffers(productId)
  const mine = useMyListings(Boolean(data?.your_listings?.length))
  if (isLoading) return <p style={note}>Loading offers…</p>
  if (error) return <div role="alert" style={{ color: D.errInk, background: D.errBg, borderRadius: 8, padding: '8px 10px', fontSize: '0.78rem' }}>{apiErrorMessage(error, 'Could not load offers. Please try again.')}</div>
  if (!data) return null
  const ids = new Set(data.your_listings)
  const names = (mine.data ?? []).filter((l) => ids.has(l.id)).map((l) => l.name)
  return (
    <div>
      {data.your_listings.length > 0 && names.length > 0 && <p style={{ ...note, marginBottom: 10 }}>{`You sell this product too: ${names.join(', ')}`}</p>}
      {data.offers.length === 0 && <p style={note}>No other business offers it right now.</p>}
      <ul style={{ padding: 0, margin: 0 }}>
        {data.offers.map((o) => (
          <li key={o.listing_id} style={{ ...glassCard, padding: 14, marginBottom: 10, listStyle: 'none' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: D.text, fontWeight: 800, fontSize: '0.88rem' }}>{o.business_name || 'Business name not given'}</span>
              <span style={{ color: D.green, fontSize: '0.7rem', fontWeight: 800 }}>✓ Verified business</span>
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: D.price, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(o.price_now)}</span>
              {o.price_unit && <span style={note}>{` ${o.price_unit}`}</span>}
            </div>
            {PRICE_BASIS_LABEL[o.price_basis] && <p style={note}>{PRICE_BASIS_LABEL[o.price_basis]}</p>}
            <p style={note}>{CONDITION_LABEL[o.condition] ?? o.condition}</p>
            <p style={note}>{o.zone}</p>
            <p style={note}>{o.available_quantity == null ? 'Stock not counted' : `${o.available_quantity} available`}</p>
          </li>
        ))}
      </ul>
      {data.truncated && <p style={note}>Showing the 50 lowest-priced offers.</p>}
    </div>
  )
}
