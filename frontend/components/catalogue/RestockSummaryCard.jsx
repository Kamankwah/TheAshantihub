import { useNeedsRestocking } from '../../hooks/useCatalogueStock.js'
import { D, glassCard } from '../dashboard/theme.js'

// Overview card: how many products the server says need restocking, and a way in.
// Renders nothing while loading, on error, or when nothing is low.
export default function RestockSummaryCard({ onOpen }) {
  const { data, isError } = useNeedsRestocking()
  const count = data?.pages?.[0]?.count
  if (isError || !count) return null
  return (
    <section style={{ ...glassCard, padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: '0.86rem' }}>{count} {count === 1 ? 'product needs' : 'products need'} restocking</div>
      <button type="button" onClick={onOpen} style={{ background: D.gold, color: D.darkBrown, border: 'none', borderRadius: 20, padding: '8px 16px', fontWeight: 800, fontSize: '0.74rem', cursor: 'pointer', fontFamily: 'inherit' }}>See what needs restocking</button>
    </section>
  )
}
