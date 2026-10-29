import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useCatalogueQueue } from "../../../hooks/useCatalogueQueue.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { displayBarcode, formatPrice } from "../../catalogue/catalogueFormat.js";
import { D } from "../theme.js";
import ModerationQueueTabs, { ApprovedByLine, RejectedReason, ReviewAgainButton } from "../ModerationQueueTabs.jsx";
import { button, chip, dim, field } from "./panelStyles.js";

// Product grouping queue (catalogue plan 6F). Staff decide a business's request to group one of its listings with a
// catalogue product: join an existing entry or create a new one. Every row is a request; nothing groups by itself.
// Paginated (50 a page); each tab keeps its own page, and the realtime key "catalogue-queue" refreshes all three.

const NEW = "new";
const REASON_NEEDED = "Give a reason the business will see.";
const productText = (p) => [p.brand, p.name].filter(Boolean).join(" ");

function askText(request) {
  if (request.catalogue_product) return `Join ${productText(request.catalogue_product)}`;
  return `New catalogue product: ${productText(request)}`;
}

// The product choices on a pending row: the named product, then each match not already listed.
function choicesOf(request) {
  const seen = new Set();
  const list = [];
  for (const p of [request.catalogue_product, ...(request.matches || [])]) {
    if (p && !seen.has(p.id)) { seen.add(p.id); list.push(p); }
  }
  return list;
}

// The server joins the request's own product, else the one holding the listing's barcode, before it ever creates one
// (attach._product_for), so "create new" is only honest when neither exists.
function holderOf(request) {
  const barcode = request.listing?.barcode;
  if (!barcode) return null;
  return (request.matches || []).find((p) => p.barcode && p.barcode === barcode) || null;
}

function CatalogueRow({ request, state, onDone, onRefusal }) {
  const listing = request.listing;
  const choices = choicesOf(request);
  const holder = holderOf(request);
  const canCreate = !request.catalogue_product && !holder;
  const first = request.catalogue_product || holder;
  const [choice, setChoice] = useState(first ? String(first.id) : NEW);
  const [brand, setBrand] = useState(request.brand || "");
  const [name, setName] = useState(request.name || "");
  const [conflict, setConflict] = useState(null); // 409 match_exists: the products that already carry this name
  const [rejecting, setRejecting] = useState(false);
  const [ungrouping, setUngrouping] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Run one staff action. A refusal shows the server's words and refetches the three tabs, because the request or the
  // listing has usually changed under us (not_pending, already_grouped, ...); match_exists is a prompt, not a refusal.
  const act = async (path, body, { after } = {}) => {
    setError(null);
    onRefusal(null);
    setBusy(true);
    try {
      await apiPost(path, body);
      after?.();
      onDone();
    } catch (err) {
      if (err?.body?.code === "match_exists" && Array.isArray(err.body.matches)) {
        setConflict({ detail: err.body.detail, matches: err.body.matches });
      } else {
        // Held by the panel: the refetch usually drops this row, and a message inside it would vanish with it.
        onRefusal(apiErrorMessage(err, "Could not complete this. Please try again."));
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };
  const base = `/api/catalogue/staff/requests/${request.id}`;
  const approve = () => {
    setConflict(null);
    act(`${base}/approve/`, choice === NEW ? { brand, name } : { catalogue_product: Number(choice) });
  };
  const reject = () => {
    if (!reason.trim()) { setError(REASON_NEEDED); return; }
    act(`${base}/reject/`, { reason: reason.trim() }, { after: () => { setRejecting(false); setReason(""); } });
  };
  const ungroup = () => {
    if (!reason.trim()) { setError(REASON_NEEDED); return; }
    act(`/api/catalogue/staff/listings/${listing.id}/detach/`, { reason: reason.trim() }, { after: () => { setUngrouping(false); setReason(""); } });
  };
  const small = (extra) => ({ ...button(D.panelBg, D.text, busy), padding: "5px 12px", fontSize: "0.7rem", ...extra });

  return (
    <div role="group" aria-label={listing.name} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{listing.name}</div>
      <div style={dim}>
        {listing.business_name}
        {listing.barcode ? ` · Barcode ${displayBarcode(listing.barcode)}` : ""}
        {listing.price_amount != null && <> · <span style={{ color: D.price, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{formatPrice(listing.price_amount)}</span></>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
        {listing.business_suspended && <span style={chip(D.red)}>Business suspended</span>}
        <span style={dim}>{request.source === "backfill" ? "Found by AshantiHub's barcode check" : "Asked by the business"}</span>
      </div>
      <div style={{ color: D.text, fontSize: "0.78rem", fontWeight: 700, marginTop: 4 }}>{askText(request)}</div>

      {state === "pending" && (
        <div style={{ marginTop: 8 }}>
          <div role="radiogroup" aria-label="Group this listing with" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {choices.map((p) => (
              <label key={p.id} style={{ color: D.text, fontSize: "0.76rem", display: "flex", gap: 6, alignItems: "center" }}>
                <input type="radio" name={`choice-${request.id}`} checked={choice === String(p.id)} onChange={() => { setConflict(null); setChoice(String(p.id)); }} />
                {productText(p)}{p.barcode ? ` · ${displayBarcode(p.barcode)}` : ""}
              </label>
            ))}
            {canCreate ? (
              <label style={{ color: D.text, fontSize: "0.76rem", display: "flex", gap: 6, alignItems: "center" }}>
                <input type="radio" name={`choice-${request.id}`} checked={choice === NEW} onChange={() => { setConflict(null); setChoice(NEW); }} />
                Create a new catalogue product
              </label>
            ) : (
              <div style={dim}>To make a new product, reject this request.</div>
            )}
          </div>
          {canCreate && choice === NEW && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <input aria-label="Brand" value={brand} onChange={(e) => { setConflict(null); setBrand(e.target.value); }} placeholder="Brand" style={{ ...field, flex: "1 1 120px", minWidth: 0 }} />
              <input aria-label="Name" value={name} onChange={(e) => { setConflict(null); setName(e.target.value); }} placeholder="Name" style={{ ...field, flex: "2 1 180px", minWidth: 0 }} />
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" disabled={busy} onClick={approve} style={small(button(D.gold, D.text, busy))}>Approve</button>
            <button type="button" disabled={busy} onClick={() => { setRejecting(true); setError(null); }} style={small({ color: D.red })}>Reject</button>
          </div>
          {conflict && (
            <div role="status" style={{ marginTop: 8, color: D.text, fontSize: "0.76rem" }}>
              <div style={{ fontWeight: 700 }}>{conflict.detail}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {conflict.matches.map((p) => (
                  <button key={p.id} type="button" disabled={busy} style={small()} onClick={() => { setConflict(null); act(`${base}/approve/`, { catalogue_product: p.id }); }}>
                    {`Join ${productText(p)}`}
                  </button>
                ))}
                <button type="button" disabled={busy} style={small()} onClick={() => { setConflict(null); act(`${base}/approve/`, { brand, name, new: true }); }}>Create new anyway</button>
              </div>
            </div>
          )}
          {rejecting && (
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input aria-label="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rejection reason" style={{ ...field, flex: "1 1 160px", minWidth: 0 }} />
              <button type="button" disabled={busy} onClick={reject} style={small({ color: D.red })}>Confirm reject</button>
            </div>
          )}
        </div>
      )}

      {state === "approved" && (
        <div style={{ marginTop: 4 }}>
          <ApprovedByLine name={request.reviewed_by_name} at={request.reviewed_at} />
          {listing.grouped_with ? (
            <div style={{ marginTop: 6 }}>
              <div style={dim}>{`Grouped with ${productText(listing.grouped_with)}`}</div>
              {!ungrouping && <button type="button" disabled={busy} onClick={() => { setUngrouping(true); setError(null); }} style={{ ...small(), marginTop: 6 }}>Ungroup…</button>}
              {ungrouping && (
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input aria-label="Reason for ungrouping" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason the business will see" style={{ ...field, flex: "1 1 160px", minWidth: 0 }} />
                  <button type="button" disabled={busy} onClick={ungroup} style={small({ color: D.red })}>Confirm ungroup</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ ...dim, marginTop: 6 }}>No longer grouped</div>
          )}
        </div>
      )}

      {state === "rejected" && (
        <div style={{ marginTop: 4 }}>
          <RejectedReason reason={request.rejection_reason} />
          <div style={{ marginTop: 6 }}><ReviewAgainButton onClick={() => act(`${base}/re-review/`, {})} /></div>
        </div>
      )}

      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{error}</div>}
    </div>
  );
}

export default function CatalogueQueuePanel() {
  const queryClient = useQueryClient();
  const [tab, setTabState] = useState("pending");
  const [refusal, setRefusal] = useState(null);
  const setTab = (next) => { setRefusal(null); setTabState(next); };
  const [pages, setPages] = useState({ pending: 1, approved: 1, rejected: 1 });
  const pending = useCatalogueQueue({ status: "pending", page: pages.pending });
  const approved = useCatalogueQueue({ status: "approved", page: pages.approved });
  const rejected = useCatalogueQueue({ status: "rejected", page: pages.rejected });
  const queries = { pending, approved, rejected };
  const refetchAll = () => queryClient.invalidateQueries({ queryKey: ["catalogue-queue"] });

  const active = queries[tab].data;
  const goPage = (delta) => setPages((p) => ({ ...p, [tab]: p[tab] + delta }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={dim}>Businesses ask to group a listing with a catalogue product. Nothing is grouped until you approve it here.</div>
      {refusal && <div role="alert" style={{ color: D.red, fontSize: "0.8rem", fontWeight: 700 }}>{refusal}</div>}
      <ModerationQueueTabs
        tab={tab}
        onTab={setTab}
        queries={queries}
        title="Product grouping"
        renderRow={(request, state) => <CatalogueRow request={request} state={state} onDone={refetchAll} onRefusal={setRefusal} />}
      />
      {active && !Array.isArray(active) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={dim}>{`Showing ${active.results.length} of ${active.count}`}</span>
          {active.previous && <button type="button" onClick={() => goPage(-1)} style={{ ...button(D.panelBg, D.text), padding: "5px 12px", fontSize: "0.7rem" }}>Previous page</button>}
          {active.next && <button type="button" onClick={() => goPage(1)} style={{ ...button(D.panelBg, D.text), padding: "5px 12px", fontSize: "0.7rem" }}>Next page</button>}
        </div>
      )}
      <div style={dim}>Rejecting needs a reason the business sees. A rejected request can be sent back for another review from the Rejected tab. Ungrouping tells the business why.</div>
    </div>
  );
}
