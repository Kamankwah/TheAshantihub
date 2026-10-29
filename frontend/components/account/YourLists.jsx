import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../apiClient.js";
import { useCanBuy } from "../../hooks/useCanBuy.js";
import { useStaffGate } from "../../hooks/useStaffGate.js";
import { useWishlist } from "../../hooks/useWishlist.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { C } from "../../theme.js";
import { D, glassCard } from "../dashboard/theme.js";
import { HEADING_FONT } from "../storefront/storefrontType.js";
import PriceTag from "../shop/PriceTag.jsx";
import StaffGateNotice from "../StaffGateNotice.jsx";

const SORTS = [
  { id: "recent", label: "Most recently added" },
  { id: "name", label: "Name" },
  { id: "price", label: "Price: low to high" },
];
const priceOf = (listing) => {
  const n = Number(listing.effective_price ?? listing.price_amount);
  return Number.isFinite(n) ? n : Infinity;
};
const addedOn = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

const control = { background: D.panelBg2, border: `1px solid ${D.divider}`, borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", color: D.text, fontFamily: "inherit" };
const action = { background: "none", border: `1px solid ${D.divider}`, borderRadius: 10, padding: "7px 14px", fontSize: "0.78rem", fontWeight: 700, color: D.text, cursor: "pointer", fontFamily: "inherit", textDecoration: "none", display: "inline-block" };
const primary = { ...action, background: D.gold, color: D.darkBrown, border: "none", fontWeight: 800 };

function Item({ row, grid, canBuy, buyLabel, busy, note, onAdd, onRemove }) {
  const { listing } = row;
  const photo = listing.main_photo || listing.photos?.[0]?.image || null;
  const price = listing.effective_price ?? listing.price_amount ?? null;
  const date = addedOn(row.added_at);
  return (
    <li data-testid="list-item" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: grid ? "column" : "row", gap: 14, listStyle: "none" }}>
      <Link to={`/business/${listing.id}`} aria-label={listing.name} style={{ flex: "0 0 auto", width: grid ? "100%" : 110, aspectRatio: grid ? "4 / 3" : "1 / 1", background: D.panelBg2, border: `1px solid ${D.divider}`, borderRadius: 12, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span aria-hidden="true" style={{ fontSize: "2rem" }}>{listing.category?.icon}</span>}
      </Link>
      <div style={{ display: "grid", gap: 6, alignContent: "start", flex: 1, minWidth: 0 }}>
        <Link to={`/business/${listing.id}`} data-testid="list-item-name" style={{ color: D.text, fontWeight: 700, fontSize: "0.92rem", textDecoration: "none" }}>{listing.name}</Link>
        {price != null && (
          <span>
            {listing.has_variants && <span style={{ fontSize: "0.72rem", color: D.textDim, fontWeight: 600, marginRight: 6 }}>From</span>}
            <PriceTag price={price} wasPrice={listing.was_price ?? null} size="1.1rem" />
          </span>
        )}
        {date && <span style={{ fontSize: "0.74rem", color: D.textDim }}>{`Item added ${date}`}</span>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {listing.has_variants ? (
            <Link to={`/business/${listing.id}`} style={primary}>Choose options</Link>
          ) : (
            <button type="button" disabled={!canBuy || busy} title={canBuy ? undefined : buyLabel} onClick={onAdd} style={{ ...primary, opacity: canBuy && !busy ? 1 : 0.55, cursor: canBuy && !busy ? "pointer" : "not-allowed" }}>
              {busy ? "Adding…" : canBuy ? "Add to cart" : buyLabel || "Add to cart"}
            </button>
          )}
          <button type="button" onClick={onRemove} style={action}>{`Remove`}<span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{` ${listing.name} from your list`}</span></button>
        </div>
        {note && <div role={note.ok ? "status" : "alert"} style={{ fontSize: "0.76rem", color: note.ok ? C.trust : C.errInk }}>{note.text}</div>}
      </div>
    </li>
  );
}

// "Your Lists": the signed-in customer's single private Shopping List, held on the server
// (GET /api/wishlist/). The heart on a card, "Add to list" on the product page and this
// screen all read and write the same list. No multiple lists, sharing, gift finder or
// registry (none exist). A plain item goes straight to the cart; one with variants sends the
// shopper to its page to choose options.
export default function YourLists({ user }) {
  const queryClient = useQueryClient();
  const list = useWishlist({ enabled: true });
  const { canBuy, label: buyLabel } = useCanBuy();
  const gate = useStaffGate(user);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [grid, setGrid] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});
  const [actionError, setActionError] = useState(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = list.items.filter((r) => !q || String(r.listing.name || "").toLowerCase().includes(q));
    if (sort === "name") return [...rows].sort((a, b) => String(a.listing.name).localeCompare(String(b.listing.name)));
    if (sort === "price") return [...rows].sort((a, b) => priceOf(a.listing) - priceOf(b.listing));
    return rows; // the server's order is newest first
  }, [list.items, query, sort]);

  const setNote = (id, note) => setNotes((n) => ({ ...n, [id]: note }));
  const addToCart = async (row) => {
    if (gate.blocked(row.id) || busyId) return;
    setNote(row.id, null);
    setBusyId(row.id);
    try {
      await apiPost("/api/cart/items/", { listing: row.listing.id, quantity: 1 });
      // The cart badge, the cart page, the delivery guard and the browse cart tiers all read the cart.
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      queryClient.invalidateQueries({ queryKey: ["cart-guard"] });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      setNote(row.id, { ok: true, text: "Added to your cart." });
    } catch (err) {
      setNote(row.id, { ok: false, text: apiErrorMessage(err, "Could not add this to your cart.") });
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (row) => {
    setActionError(null);
    try {
      await list.remove(row.listing.id);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not remove this from your list."));
    }
  };

  if (list.isLoading) return <div style={{ color: D.textDim, fontSize: "0.85rem" }}>Loading your list…</div>;
  if (list.isError) {
    return (
      <div role="alert" style={{ color: C.errInk, background: C.errBg, borderRadius: 10, padding: "10px 12px", fontSize: "0.82rem" }}>
        We could not load your list. <button type="button" onClick={() => list.refetch()} style={action}>Try again</button>
      </div>
    );
  }

  return (
    <section aria-label="Shopping List" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.1rem", color: D.text }}>Shopping List</h2>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "2px 10px" }}>Private</span>
      </div>
      {list.items.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input type="search" aria-label="Search this list" placeholder="Search this list" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...control, flex: "1 1 200px", maxWidth: 320 }} />
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} style={control}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" aria-label="Grid view" aria-pressed={grid} onClick={() => setGrid(true)} style={{ ...action, background: grid ? D.panelBg3 : "none" }}>Grid</button>
            <button type="button" aria-label="List view" aria-pressed={!grid} onClick={() => setGrid(false)} style={{ ...action, background: !grid ? D.panelBg3 : "none" }}>List</button>
          </div>
        </div>
      )}
      {actionError && <div role="alert" style={{ color: C.errInk, background: C.errBg, borderRadius: 10, padding: "10px 12px", fontSize: "0.82rem" }}>{actionError}</div>}
      {gate.shownFor && <StaffGateNotice />}
      {list.items.length === 0 ? (
        <div style={{ ...glassCard, padding: 24, textAlign: "center", color: D.textDim, fontSize: "0.85rem" }}>Nothing saved yet — tap the heart on any item.</div>
      ) : shown.length === 0 ? (
        <div style={{ color: D.textDim, fontSize: "0.85rem" }}>Nothing in this list matches your search.</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, display: "grid", gap: 14, gridTemplateColumns: grid ? "repeat(auto-fill, minmax(220px, 1fr))" : "1fr" }}>
          {shown.map((row) => (
            <Item key={row.id} row={row} grid={grid} canBuy={canBuy} buyLabel={buyLabel} busy={busyId === row.id} note={notes[row.id]} onAdd={() => addToCart(row)} onRemove={() => remove(row)} />
          ))}
        </ul>
      )}
    </section>
  );
}
