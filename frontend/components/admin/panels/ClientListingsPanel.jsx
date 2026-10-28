import { useState } from "react";
import { apiDelete, apiPost } from "../../../apiClient.js";
import useBreakpoint from "../../../hooks/useBreakpoint.js";
import { useClientDrafts } from "../../../hooks/useClientDrafts.js";
import { usePortfolio, usePortfolioBusiness } from "../../../hooks/usePortfolio.js";
import { D } from "../theme.js";
import { button, callout, chip, dim } from "./panelStyles.js";
import ClientListingForm from "./ClientListingForm.jsx";
import { confirmationLine } from "./confirmationLine.js";
import { card, errorStyle, errorText, h2, h3 } from "./portfolioParts.jsx";

const KIND_LABEL = { product: "Product", service: "Service", event: "Event", stay: "Stay" };
// Edit, withdraw and a new owner text are allowed until the draft is with approval; the owner's answer closes it.
const OPEN = ["draft", "awaiting_owner", "lapsed", "owner_confirmed"];
const STATE_COLOR = { draft: D.textFaint, awaiting_owner: D.blue, lapsed: D.amber, owner_confirmed: D.green, submitted: D.green, owner_declined: D.red, withdrawn: D.textFaint };
const touch = { minHeight: 44 };

// Drafts of products, services, events and stays for one client business: what each says, whether the owner's
// confirmation text went out, and what to do next. Used by the "List for this business" button (businessId) and by
// the Client listings menu entry (detailId, with a business picker when none is chosen).
export default function ClientListingsPanel({ businessId, auth, detailId, onOpenDetail, onBack }) {
  const id = businessId ?? detailId;
  if (id == null) return <BusinessPicker auth={auth} onPick={(picked) => onOpenDetail?.(picked)} />;
  return <Drafts key={id} businessId={id} auth={auth} onBack={onBack || (() => onOpenDetail?.(null))} />;
}

function BusinessPicker({ auth, onPick }) {
  const query = usePortfolio({ scope: auth?.user?.role === "scout" ? "mine" : "all" });
  const rows = query.data?.results || [];
  return (
    <section aria-label="Client listings" style={card}>
      <h2 style={h2}>Client listings</h2>
      <div style={dim}>Choose the business you are listing for. Nothing goes live until its owner confirms by text and a second person approves.</div>
      {query.isLoading && <div style={dim}>Loading…</div>}
      {query.isError && <div role="alert" style={errorStyle}>Couldn't load the businesses. Try again.</div>}
      {query.data && rows.length === 0 && <div style={dim}>No businesses to list for yet.</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" onClick={() => onPick(String(row.id))} style={{ ...button(D.panelBg, D.text), ...touch, width: "100%", textAlign: "left" }}>
              {row.business_name}{row.zone?.name ? ` · ${row.zone.name}` : ""}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Drafts({ businessId, auth, onBack }) {
  const business = usePortfolioBusiness(businessId);
  const { data, isLoading, isError, refetch } = useClientDrafts(businessId);
  const phone = useBreakpoint() === "phone";
  const [view, setView] = useState(null); // null | "new" | a draft being edited
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const me = auth?.user?.id;
  const drafts = Array.isArray(data) ? data : [];
  const unsent = drafts.filter((d) => d.status === "draft");

  const run = async (key, call, fallback) => {
    setBusy(key);
    setActionError(null);
    try {
      await call();
      await refetch();
    } catch (err) {
      setActionError(errorText(err, fallback));
    } finally {
      setBusy(null);
    }
  };
  const base = `/api/portfolio/businesses/${businessId}/drafts/`;
  const send = () => run("send", () => apiPost(`${base}send/`, { draft_ids: unsent.map((d) => d.id) }), "Could not send the drafts. Try again.");
  const resend = (d) => run(`resend-${d.id}`, () => apiPost(`${base}${d.id}/resend/`, {}), "Could not send the text again. Try again.");
  const submit = (d) => run(`submit-${d.id}`, () => apiPost(`${base}${d.id}/submit/`, {}), "Could not send it for approval yet.");
  const withdraw = (d) => run(`withdraw-${d.id}`, () => apiDelete(`${base}${d.id}/`), "Could not withdraw the draft. Try again.");

  if (view) {
    return (
      <ClientListingForm
        businessId={businessId} draft={view === "new" ? null : view}
        onBack={() => setView(null)} onSaved={() => { setView(null); refetch(); }}
      />
    );
  }

  const name = business.data?.business_name;
  return (
    <section aria-label="Client listings" style={card}>
      <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), ...touch, alignSelf: "flex-start" }}>← Back</button>
      <div>
        <h2 style={h2}>{name ? `Listings for ${name}` : "Client listings"}</h2>
        <div style={dim}>Draft a product, service, event or stay. The owner confirms by text, then a second person approves it. Nothing here goes live on its own.</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexDirection: phone ? "column" : "row" }}>
        <button type="button" onClick={() => { setActionError(null); setView("new"); }} style={{ ...button(D.gold, D.text), ...touch }}>Draft a listing</button>
        <button type="button" disabled={unsent.length === 0 || busy === "send"} onClick={send} style={{ ...button(D.panelBg, D.text, unsent.length === 0 || busy === "send"), ...touch }}>Send for owner confirmation</button>
      </div>
      {unsent.length > 0 && <div style={dim}>{`One text to the owner covers all ${unsent.length} unsent ${unsent.length === 1 ? "draft" : "drafts"}.`}</div>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Couldn't load the drafts. Try again.</div>}
      {!isLoading && !isError && drafts.length === 0 && <div style={dim}>No drafts yet. Draft the first listing for this business.</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {drafts.map((d) => {
          const open = OPEN.includes(d.status);
          const own = me != null && d.created_by_id === me;
          const canResend = d.status === "lapsed" || (d.status === "awaiting_owner" && !d.confirmation?.sent_at);
          return (
            <li key={d.id} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6, background: D.panelBg }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <h3 style={{ ...h3, overflowWrap: "anywhere" }}>{d.name || "Untitled draft"}</h3>
                <span style={chip(D.textDim)}>{KIND_LABEL[d.kind] || d.kind}</span>
              </div>
              <div style={dim}>{`Drafted by ${d.created_by_name}`}</div>
              <div style={{ ...callout(STATE_COLOR[d.status] || D.textFaint), fontWeight: 600 }}>
                {confirmationLine(d.confirmation)}
                {d.status === "lapsed" && <> — {canResend && <button type="button" disabled={busy === `resend-${d.id}`} onClick={() => resend(d)} style={{ ...button(D.panelBg, D.text, busy === `resend-${d.id}`), ...touch, marginLeft: 4 }}>Resend</button>}</>}
              </div>
              {d.status === "owner_confirmed" && <div style={dim}>The owner confirmed. It goes to approval once the business has passed KYC.</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexDirection: phone ? "column" : "row" }}>
                {d.status === "awaiting_owner" && canResend && (
                  <button type="button" disabled={busy === `resend-${d.id}`} onClick={() => resend(d)} style={{ ...button(D.panelBg, D.text, busy === `resend-${d.id}`), ...touch }}>Resend</button>
                )}
                {d.status === "owner_confirmed" && (
                  <button type="button" disabled={busy === `submit-${d.id}`} onClick={() => submit(d)} style={{ ...button(D.panelBg, D.text, busy === `submit-${d.id}`), ...touch }}>Try sending for approval</button>
                )}
                {open && own && <button type="button" onClick={() => { setActionError(null); setView(d); }} style={{ ...button(D.panelBg, D.text), ...touch }}>Edit</button>}
                {open && <button type="button" disabled={busy === `withdraw-${d.id}`} onClick={() => withdraw(d)} style={{ ...button(D.panelBg, D.red, busy === `withdraw-${d.id}`), ...touch }}>Withdraw</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
