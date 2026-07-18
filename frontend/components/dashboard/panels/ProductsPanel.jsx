import { useMyListings } from "../../../hooks/useMyListings.js";
import { D } from "../theme.js";
import OwnerListingCard from "./OwnerListingCard.jsx";

// Products management (business item 2, Wave H). Lists the owner's *approved*
// (published) product listings and lets them adjust operational details —
// price, specs, stock, photos — without re-moderation (via the manage/photo
// endpoints), plus restock and expiry warnings. Only surfaced for a product
// business (see BusinessCommandCenter.buildTabs). The per-listing card is the
// shared OwnerListingCard (also used by Services/Bookings).
export default function ProductsPanel() {
  const { data, isLoading, isError, refetch } = useMyListings();
  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading your products…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your products.</div>;
  const published = (data || []).filter(l => l.status === "published");

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>Your products</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>Approved listings. Adjust price, specs, photos and stock here — changes go live without re-approval.</div>
      {published.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>No approved products yet. Once a listing is approved it appears here.</div>}
      {published.map(l => <OwnerListingCard key={l.id} listing={l} onChanged={refetch} variant="product" />)}
    </div>
  );
}
