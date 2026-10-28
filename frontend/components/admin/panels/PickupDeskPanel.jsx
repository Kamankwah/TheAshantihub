import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { usePickupQueue } from "../../../hooks/usePickupDesk.js";
import { useSiteSettings } from "../../../hooks/useSiteSettings.js";
import { refusalCode, walletMessage } from "../../wallet/walletErrors.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { Title, page } from "./insightsParts.jsx";

// ─── Pickup desk ─────────────────────────────────────────────────────────────
// Paid store-pickup orders waiting for collection, oldest first. The desk hands
// goods over only against the customer's one-time collection code, which it asks
// the customer for: neither the rows nor this screen ever carry the code, and
// there is no phone number to ring (the desk hands over goods, it does not call
// customers). The server counts wrong codes and locks the order on the fifth, so
// a locked order offers no retry here. The pickup office address is the Super
// Admin's setting (password re-entry is handled by apiClient's SudoPrompt); until
// it is set every screen says "address to be confirmed".
// usePickupQueue returns a DRF envelope (20 a page): read data.results and count.
const PAGE_SIZE = 20;
const CODE_LENGTH = 6;
const MAX_ADDRESS = 300;
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GH") : "—");
const figures = { fontVariantNumeric: "tabular-nums" };

function AddressLine({ canEdit }) {
  const queryClient = useQueryClient();
  const settings = useSiteSettings();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const address = (settings.data?.pickup_office_address || "").trim();
  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiPatch("/api/core/site-settings/pickup-address/", { pickup_office_address: value.trim() });
      await queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      setEditing(false);
    } catch (err) {
      setError(walletMessage(err).text);
    }
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", color: D.text, fontSize: "0.85rem" }}>
        <span>Pickup office address: {address || "to be confirmed"}</span>
        {canEdit && !editing && (
          <button type="button" onClick={() => { setValue(address); setError(""); setEditing(true); }} style={button(D.panelBg, D.text, false)}>Edit address</button>
        )}
      </div>
      {canEdit && editing && (
        <form onSubmit={save} style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>
            Pickup office address
            <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} maxLength={MAX_ADDRESS} aria-describedby="pickup-address-hint" style={field} />
          </label>
          <span id="pickup-address-hint" style={dim}>Leave it empty to show 'address to be confirmed' everywhere.</span>
          {error && <div role="alert" style={callout(D.red)}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>Save address</button>
            <button type="button" onClick={() => setEditing(false)} style={button(D.panelBg, D.text, false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function HandOver({ order, onClose, onDone }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const inFlight = useRef(false);
  const ready = code.length === CODE_LENGTH;
  const confirm = async () => {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const done = await apiPost(`/api/ledger/pickup/${order.order_id}/collected/`, { code });
      onDone(done);
      return;
    } catch (e) {
      const text = walletMessage(e).text;
      if (refusalCode(e) === "wrong_code" && e.body?.attempts_left !== undefined) setError(`${text} ${e.body.attempts_left} tries left.`);
      else setError(text);
      if (refusalCode(e) === "code_locked") setLocked(true);
    }
    inFlight.current = false;
    setBusy(false);
  };
  return (
    <div style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 8, border: `1px solid ${D.cardBorder}` }}>
      <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>Give order #{order.order_id} to {order.customer_name}? Ask for their collection code and check the name.</div>
      {error && <div role="alert" style={callout(D.red)}>{error}</div>}
      {!locked && (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>
            Collection code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
              inputMode="numeric" autoComplete="off" maxLength={CODE_LENGTH}
              style={{ ...field, ...figures, letterSpacing: "0.2em", maxWidth: 160 }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={confirm} disabled={!ready || busy} style={button(D.gold, D.text, !ready || busy)}>Confirm hand-over</button>
            <button type="button" onClick={onClose} style={button(D.panelBg, D.text, false)}>Cancel</button>
          </div>
        </>
      )}
      {locked && <div><button type="button" onClick={onClose} style={button(D.panelBg, D.text, false)}>Close</button></div>}
    </div>
  );
}

function OrderRow({ order, open, onOpen, onClose, onDone }) {
  return (
    <li style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8, listStyle: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800 }}>Order #{order.order_id}</div>
          <div style={{ color: D.text, fontSize: "0.85rem" }}>{order.customer_name}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {order.overdue && <span style={chip(D.amber)}>Overdue</span>}
          {!open && <button type="button" onClick={onOpen} style={button(D.panelBg, D.text, false)}>Hand over…</button>}
        </div>
      </div>
      <div style={{ ...dim, ...figures }}>Paid {when(order.placed_at)} · Collect by {when(order.collect_by)}</div>
      <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {order.items.map((item, i) => <li key={i} style={{ listStyle: "none", color: D.text, fontSize: "0.82rem" }}>{item.quantity} × {item.name}, {item.business}</li>)}
      </ul>
      {open && <HandOver order={order} onClose={onClose} onDone={onDone} />}
    </li>
  );
}

export default function PickupDeskPanel({ auth }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [handedOver, setHandedOver] = useState("");
  const query = usePickupQueue({ q, page: pageNo });
  const canEdit = auth?.user?.role === "super_admin";
  const off = query.error && walletMessage(query.error).kind === "off";
  const rows = query.data?.results || [];
  const count = query.data?.count ?? 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ledger-pickup"] });
  const search = (e) => { e.preventDefault(); setQ(draft.trim()); setPageNo(1); };
  const done = (order, result) => {
    setOpenId(null);
    setHandedOver(`Order #${order.order_id} handed over at ${when(result.collected_at)}.`);
    refresh();
  };
  return (
    <div style={page}>
      <Title right={<button type="button" onClick={refresh} style={button(D.panelBg, D.text, false)}>Refresh</button>}>Pickup desk</Title>
      <AddressLine canEdit={canEdit} />
      {!off && (
        <form role="search" onSubmit={search} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>
            Order number or name
            <input value={draft} onChange={(e) => setDraft(e.target.value)} style={field} />
          </label>
          <button type="submit" style={button(D.panelBg, D.text, false)}>Search</button>
          {query.data && <span style={{ ...dim, ...figures }}>{count} waiting</span>}
        </form>
      )}
      {handedOver && <div role="status" style={callout(D.green)}>{handedOver}</div>}
      {off ? <div role="status" style={dim}>The pickup desk opens when the ledger is switched on.</div>
        : query.error ? <div role="alert" style={callout(D.red)}>{walletMessage(query.error).text}</div>
        : !query.data ? <div role="status" style={dim}>Loading…</div>
        : !rows.length ? <div style={dim}>No orders are waiting for collection.</div>
        : (
          <ul aria-label="Orders waiting for collection" style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((order) => (
              <OrderRow key={order.order_id} order={order} open={openId === order.order_id}
                onOpen={() => { setHandedOver(""); setOpenId(order.order_id); }} onClose={() => setOpenId(null)} onDone={(result) => done(order, result)} />
            ))}
          </ul>
        )}
      {count > PAGE_SIZE && (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setPageNo((n) => n - 1)} disabled={pageNo <= 1} style={button(D.panelBg, D.text, pageNo <= 1)}>Previous</button>
          <button type="button" onClick={() => setPageNo((n) => n + 1)} disabled={pageNo * PAGE_SIZE >= count} style={button(D.panelBg, D.text, pageNo * PAGE_SIZE >= count)}>Next</button>
        </div>
      )}
    </div>
  );
}
