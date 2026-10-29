import { useMyListings, DEFAULT_LISTINGS_PATH } from "../../../hooks/useMyListings.js";
import { D } from "../theme.js";
import OwnerListingCard from "./OwnerListingCard.jsx";

// Products management (business item 2, Wave H). Lists the owner's approved (published) and
// dropped product listings. Price and stock go live at once; every other change (details,
// images, videos, variants) is a draft edit our team approves while the approved version stays
// live. Also drop, restore and discontinue. Only surfaced for a product business (see
// BusinessCommandCenter.buildTabs). The per-listing card is the shared OwnerListingCard (also
// used by Services/Bookings); `basePath` lets Ashanti Direct mount this panel on its own tree.
export default function ProductsPanel({ basePath = DEFAULT_LISTINGS_PATH }) {
  const { data, isLoading, isError, refetch } = useMyListings(true, basePath);
  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading your products…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your products.</div>;
  // A listing with an edit waiting is still published or dropped, so it is listed here too.
  const approved = (data || []).filter(l => ["published", "dropped"].includes(l.status));

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>Your products</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>Approved listings. Price and stock changes go live at once. Anything else you change waits for our approval, and your approved version stays live meanwhile. Discontinued listings are listed under the Listings tab.</div>
      {approved.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>No approved products yet. Once a listing is approved it appears here.</div>}
      {approved.map(l => <OwnerListingCard key={l.id} listing={l} onChanged={refetch} variant="product" basePath={basePath} />)}
    </div>
  );
}
