import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useListingForReview, useListingHistory, useSaListingCounts, useSaListings } from "../../../hooks/useMarketplace.js";
import { useCategories } from "../../../hooks/useCategories.js";
import { categoryPathLabel } from "../../../lib/categoryOptions.jsx";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import SponsoredToggle, { isProductListing } from "./SponsoredToggle.jsx";
import { Chip, ExportButton, FilterBar, KpiStrip, LoadState, Pager, ScreenHeader, col, dateOnly, dateTime, showing, tableStyle, td, th } from "./marketplaceParts.jsx";
import { card, errorStyle, h3, labelStyle, money, useDebounced } from "./portfolioParts.jsx";

// Super Admin > Listings & services (screen 19): every listing in every state.
// There is no "hidden" state a person can set: taking a listing off the site
// is a rejection with a reason (the owner is told; it can be sent back for
// review from the moderation queue). Hidden listings are the published ones
// of a suspended business (or, when the pause is on, an unpaid one).

const STATE = {
  live: ["Live", D.green], waiting: ["Waiting for a decision", D.amber], hidden: ["Hidden", D.red],
  rejected: ["Rejected", D.textFaint], draft: ["Draft", D.textFaint],
};
const TYPE = { product: "Product", service: "Service", booking: "Booking" };
const RULES = [
  "An owner's new listing waits for Operations or a Super Admin before it goes on the site.",
  "A listing a scout adds for a business is checked through the scout's approval request; that approval is its moderation.",
  "The owner is told about every change a scout makes and can undo it within 7 days.",
  "A hidden listing is never deleted; it comes back when the business is reinstated.",
  "Taking a listing down here is a rejection with a reason. The owner is told why.",
];

function History({ listing, onClose }) {
  const { data, isLoading, isError } = useListingHistory(listing.id);
  return (
    <section aria-label={`History of ${listing.name}`} style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <h3 style={h3}>{`History · ${listing.name}`}</h3>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text)}>Close</button>
      </div>
      <div style={dim}>{listing.business_name}</div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load the history.</div>}
      {data?.events.map((e, i) => <div key={i} style={{ fontSize: "0.8rem", color: D.text }}><span style={dim}>{dateTime(e.at)}</span>{` · ${e.text} · ${e.who || "—"}`}</div>)}
    </section>
  );
}

const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : "—");

// Everything the owner was asked when listing, so a Super Admin can judge it
// before publishing: pictures, price, the product/service answers.
function ReviewSheet({ listing, canModerate, approving, onApprove, onClose }) {
  const { data: d, isLoading, isError } = useListingForReview(listing.id);
  const pictures = d ? [d.main_photo, ...(d.photos || []).map((p) => p.image)].filter(Boolean) : [];
  const rows = d ? [
    ["Category", d.category?.label], ["Zone", d.zone?.name],
    ["Price", d.price_amount != null ? `${money(d.price_amount)}${d.price_unit ? ` / ${d.price_unit}` : ""}` : null],
    ["Tag", d.tag], ["Contact phone", d.contact_phone],
    ...(d.category?.kind === "product" ? [
      ["Brand", d.brand], ["Condition", d.condition], ["Dimensions", d.dimensions], ["Weight", d.weight],
      ["Stock", d.stock_quantity], ["Warranty", yesNo(d.has_warranty)], ["Warranty details", d.has_warranty ? d.warranty_details : null],
      ["Can expire", yesNo(d.has_expiry)], ["Expiry date", d.has_expiry ? d.expiry_date : null], ["Return policy", d.return_policy],
    ] : [
      ["Duration", d.service_duration], ["What's included", d.whats_included], ["Requirements", d.requirements],
      ["Revisions", d.revisions], ["Delivery time", d.delivery_time],
    ]),
  ].filter(([, v]) => v !== null && v !== undefined && v !== "") : [];
  return (
    <section aria-label={`Review ${listing.name}`} style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <h3 style={h3}>{listing.name}</h3>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text)}>Close</button>
      </div>
      <div style={dim}>{listing.business_name}</div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load this listing.</div>}
      {d && (
        <>
          {pictures.length > 0
            ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{pictures.map((src, i) => <a key={i} href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={`${d.name} picture ${i + 1}`} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: `1px solid ${D.divider}` }} /></a>)}</div>
            : <div style={dim}>No picture was uploaded.</div>}
          {d.description && <div style={{ fontSize: "0.82rem", color: D.text, lineHeight: 1.6 }}>{d.description}</div>}
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 14px", fontSize: "0.8rem", color: D.text }}>
            {rows.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt style={dim}>{k}</dt><dd style={{ margin: 0 }}>{String(v)}</dd></div>)}
            {(d.specs || []).map((s, i) => <div key={`s${i}`} style={{ display: "contents" }}><dt style={dim}>{s.label}</dt><dd style={{ margin: 0 }}>{s.value}</dd></div>)}
          </dl>
          {d.open_fraud_cases > 0 && <div role="alert" style={callout(D.red)}>{`This business has ${d.open_fraud_cases} open fraud ${d.open_fraud_cases === 1 ? "case" : "cases"}.`}</div>}
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text)}>Not now</button>
        {canModerate && listing.status === "pending_review" && <button type="button" disabled={approving || !d} onClick={() => onApprove(listing)} style={button(D.green, "#fff", approving || !d)}>{`Approve ${listing.name}`}</button>}
      </div>
    </section>
  );
}

function TakeDown({ listing, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`/api/listings/moderation/${listing.id}/reject/`, { reason: reason.trim() });
      onDone(`Took “${listing.name}” off the site.`);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not take it down."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form aria-label={`Take down ${listing.name}`} onSubmit={submit} noValidate style={{ ...card, border: `1px solid ${D.cardBorder}` }}>
      <h3 style={h3}>{`Take down “${listing.name}”`}</h3>
      <div style={dim}>It leaves the site at once and is recorded as rejected, with your reason. Nothing is deleted. The owner is told why. It can be sent back for review from the listings moderation queue.</div>
      <label style={labelStyle}>Reason (the owner is told)<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} style={field} /></label>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="submit" disabled={!reason.trim() || busy} style={button(D.red, "#fff", !reason.trim() || busy)}>Take down</button>
      </div>
    </form>
  );
}

export default function SaListingsPanel({ auth, onOpenBusiness }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ type: "", status: "", added_by: "", category: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState(null);
  const [takingDown, setTakingDown] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [approveError, setApproveError] = useState(null);
  const [exportError, setExportError] = useState(null);
  const q = useDebounced(search.trim());
  const params = { ...filters, q };
  const list = useSaListings({ ...params, page });
  const { data: counts } = useSaListingCounts();
  const { data: categories } = useCategories();
  const rows = list.data?.results || [];
  const canModerate = Boolean(auth?.hasPermission?.("listings.moderate"));
  const canSponsor = Boolean(auth?.hasPermission?.("deals.manage"));

  const approve = async (l) => {
    if (approvingId) return;
    setApprovingId(l.id); setApproveError(null); setNotice(null);
    try {
      await apiPost(`/api/listings/moderation/${l.id}/approve/`, {});
      setNotice(`Published “${l.name}”.`);
      setReviewing(null);
      queryClient.invalidateQueries({ queryKey: ["sa-listings"] });
      queryClient.invalidateQueries({ queryKey: ["moderation-queue"] });
    } catch (err) {
      setApproveError(apiErrorMessage(err, "Could not approve this listing."));
    } finally {
      setApprovingId(null);
    }
  };

  const change = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const filterDefs = [
    { key: "type", label: "Type", options: [["", "All types"], ["product", "Product"], ["service", "Service"], ["booking", "Booking"]] },
    { key: "status", label: "Status", options: [["", "Any"], ["live", "Live"], ["waiting", "Waiting"], ["hidden", "Hidden"], ["rejected", "Rejected"], ["draft", "Draft"]] },
    { key: "added_by", label: "Added by", options: [["", "Anyone"], ["owner", "Owner"], ["scout", "Scout for the owner"]] },
    { key: "category", label: "Category", options: [["", "All"], ...(Array.isArray(categories) ? categories : []).map((c) => [String(c.id), categoryPathLabel(c, categories)])] },
  ];
  const monthName = new Date().toLocaleDateString("en-GH", { month: "long" });
  const tiles = counts ? [
    { label: "Live", value: counts.live.toLocaleString("en-GH"), sub: "Products, services and bookings" },
    { label: "Waiting for a decision", value: counts.waiting, sub: counts.oldest_waiting_at ? `Oldest since ${dateOnly(counts.oldest_waiting_at)}` : "None waiting", tone: D.amber },
    ...(counts.pause_enabled ? [{ label: "Hidden · unpaid", value: counts.hidden_unpaid, sub: `${counts.hidden_unpaid_businesses} businesses paused` }] : []),
    { label: "Hidden · suspended", value: counts.hidden_suspended, sub: `${counts.hidden_suspended_businesses} ${counts.hidden_suspended_businesses === 1 ? "business" : "businesses"}` },
    { label: `Rejected in ${monthName}`, value: counts.rejected_this_month, sub: "Owners told why" },
  ] : [];

  return (
    <div style={col}>
      <ScreenHeader title="Listings & services" note="Everything businesses offer, in every state.">
        <ExportButton path="/api/marketplace/listings/export/" params={params} filename="listings.csv" label="Export (CSV)" onError={setExportError} />
      </ScreenHeader>
      {exportError && <div role="alert" style={callout(D.red)}>{exportError}</div>}
      <KpiStrip tiles={tiles} label="Listings summary" />
      <div style={card}>
        <h3 style={h3}>All listings</h3>
        <FilterBar filters={filterDefs} values={filters} onChange={change} search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchLabel="Listing or business" />
      </div>
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {approveError && <div role="alert" style={callout(D.red)}>{approveError}</div>}
      {takingDown && <TakeDown listing={takingDown} onCancel={() => setTakingDown(null)} onDone={(m) => { setTakingDown(null); setNotice(m); queryClient.invalidateQueries({ queryKey: ["sa-listings"] }); queryClient.invalidateQueries({ queryKey: ["moderation-queue"] }); }} />}
      {reviewing && <ReviewSheet listing={reviewing} canModerate={canModerate} approving={approvingId === reviewing.id} onApprove={approve} onClose={() => setReviewing(null)} />}
      {history && <History listing={history} onClose={() => setHistory(null)} />}
      <div style={card}>
        <LoadState query={list} what="the listings" />
        {!list.isLoading && !list.isError && rows.length === 0 && <div style={dim}>No listing matches these filters.</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Listings" style={{ ...tableStyle, minWidth: 900 }}>
              <thead><tr><th style={th}>Listing</th><th style={th}>Type</th><th style={th}>Price</th><th style={th}>Status</th><th style={th}>Added by</th><th style={th}>Latest moderation</th><th style={th}>Actions</th></tr></thead>
              <tbody>
                {rows.map((l) => {
                  const [label, color] = STATE[l.state] || [l.state, D.textFaint];
                  return (
                    <tr key={l.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 800 }}>{l.name}</div>
                        <div style={dim}>{onOpenBusiness ? <button type="button" onClick={() => onOpenBusiness(l.business_id)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem", color: D.deepGold, textDecoration: "underline" }}>{l.business_name}</button> : l.business_name}{` · ${l.category}`}</div>
                      </td>
                      <td style={td}>{TYPE[l.type] || l.type}</td>
                      <td style={td}>{l.price_amount != null ? `${money(l.price_amount)}${l.price_unit ? ` / ${l.price_unit}` : ""}` : "—"}</td>
                      <td style={td}><Chip color={color}>{label}</Chip>{l.state_note && <div style={dim}>{l.state_note}</div>}</td>
                      <td style={td}>{l.added_by ? `${l.added_by} (scout, for the owner)` : "Owner"}</td>
                      <td style={td}>{l.reviewed_by ? `${l.reviewed_by} · ${dateOnly(l.reviewed_at)}` : "—"}</td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" aria-label={`History of ${l.name}`} onClick={() => setHistory(l)} style={button(D.panelBg, D.text)}>History</button>
                          {canModerate && l.status === "pending_review" && <button type="button" aria-label={`View or approve ${l.name}`} onClick={() => { setNotice(null); setApproveError(null); setReviewing(l); }} style={button(D.green, "#fff")}>View / Approve</button>}
                          {canSponsor && isProductListing(l) && l.status === "published" && <SponsoredToggle id={l.id} name={l.name} sponsored={Boolean(l.sponsored)} onChanged={() => queryClient.invalidateQueries({ queryKey: ["sa-listings"] })} />}
                          {canModerate && l.status === "published" && <button type="button" aria-label={`Take down ${l.name}`} onClick={() => { setNotice(null); setTakingDown(l); }} style={button(D.panelBg, D.red)}>Take down</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <div style={dim}>{`${showing(list.data, rows)} · newest first. Taking a listing down removes it from the site at once without deleting it; the owner is told why and it is recorded.`}</div>}
      </div>
      <Pager data={list.data} page={page} setPage={setPage} />
      <section aria-label="How moderation works" style={card}>
        <h3 style={h3}>How moderation works</h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: D.text, display: "flex", flexDirection: "column", gap: 4 }}>{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </section>
    </div>
  );
}
