import { useState } from 'react'
import { D } from '../dashboard/theme.js'
import CatalogueOffersList from './CatalogueOffersList.jsx'
import CatalogueSearch from './CatalogueSearch.jsx'

export default function ProductLookupPanel() {
  const [picked, setPicked] = useState(null)
  return (
    <div>
      <p style={{ color: D.textDim, fontSize: '0.8rem', margin: '0 0 12px' }}>Look up a branded product to see other shops' prices on AshantiHub. Read-only: you cannot contact them.</p>
      {picked && (
        <div>
          <button type="button" onClick={() => setPicked(null)} style={{ border: `1px solid ${D.divider}`, borderRadius: 20, padding: '7px 14px', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit', background: D.panelBg2, color: D.text, cursor: 'pointer', marginBottom: 10 }}>Back to results</button>
          <h3 style={{ color: D.text, fontSize: '0.95rem', margin: '0 0 10px' }}>{`${picked.brand} ${picked.name}`.trim()}</h3>
          <CatalogueOffersList productId={picked.id} />
        </div>
      )}
      <div hidden={Boolean(picked)}><CatalogueSearch onPick={setPicked} /></div>
    </div>
  )
}
