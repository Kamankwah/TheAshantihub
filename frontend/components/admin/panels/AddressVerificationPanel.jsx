import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useAddressVerification } from "../../../hooks/useAddressVerification.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { clockTime, shortDay } from "../../../lib/timeAgo.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import AddressPinMap from "./AddressPinMap.jsx";

// Staff "Address verification" (Operations, General Manager, Super Admin; permission address.verify).
// The owner shares the shop's GPS fix from the shop (a texted link or the dashboard); staff check the
// evidence here and mark the address verified or wrong. The location link's URL exists only in the
// response to "Send location link", held in this component's state and gone when the row is closed.

const TABS = ["pending", "verified", "wrong"];
const TAB_LABELS = { pending: "Pending", verified: "Verified", wrong: "Marked wrong" };
const EMPTY = {
  pending: "No addresses are waiting to be verified.",
  verified: "No verified addresses yet.",
  wrong: "No addresses have been marked wrong.",
};
const METHOD_TEXT = { gps_capture: "a GPS capture re-check", video_call: "a video call", scout: "a scout's field report", desk: "a desk check" };
const SET_BY_TEXT = { owner: "the owner", scout: "a scout", operations: "Operations" };
const SMS_TEXT = {
  simulated: "Texts are simulated on this server — copy the link and send it from AshantiHub's support line.",
  failed: "The text could not be sent. Copy the link and send it from AshantiHub's support line.",
  no_phone: "There is no phone number on file to text. Copy the link and send it from AshantiHub's support line.",
};
const REOPEN_TEXT = "This decision reopens only when the owner shares a new location. You can send the owner a new location link.";

const sectionHead = { color: D.gold, fontWeight: 800, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", margin: "14px 0 8px" };

const when = (iso) => (iso ? `${shortDay(iso)}, ${clockTime(iso)}` : "");

// A refusal (4xx) carries the server's own reason; anything else keeps the generic text.
function refusal(err, fallback) {
  return err?.status >= 400 && err?.status < 500 ? apiErrorMessage(err, fallback) : fallback;
}

function setByText(pin) {
  const who = SET_BY_TEXT[pin.set_by] || "unknown";
  return pin.set_by_staff_name ? `${who} (${pin.set_by_staff_name})` : who;
}

function pinText(pin) {
  if (!pin) return "No pin yet";
  const accuracy = pin.accuracy_m != null ? `±${pin.accuracy_m} m` : "accuracy not recorded";
  return `Pin ${accuracy}, set by ${setByText(pin)}${pin.is_manual ? ", placed by hand" : ""}`;
}

function linkText(capture) {
  if (!capture) return "No link sent";
  if (capture.source === "owner_app") return `Owner shared from the dashboard${capture.created_at ? `, ${when(capture.created_at)}` : ""}`;
  const by = capture.sent_by_name ? ` by ${capture.sent_by_name}` : "";
  const sent = capture.created_at ? ` ${when(capture.created_at)}` : "";
  if (capture.state === "used") return `Link${by} sent${sent}, used${capture.used_at ? ` ${when(capture.used_at)}` : ""}`;
  if (capture.state === "expired") return `Link${by} sent${sent}, expired`;
  if (capture.state === "revoked") return `Link${by} sent${sent}, replaced by a newer one`;
  return `Link${by} sent${sent}, waiting${capture.expires_at ? ` (expires ${when(capture.expires_at)})` : ""}`;
}

function Fact({ label, children }) {
  return (
    <div style={{ marginBottom: 8, minWidth: 0 }}>
      <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: D.text, fontSize: "0.78rem", wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function EvidenceItem({ ok, label }) {
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "0.78rem", color: D.text, marginBottom: 4 }}>
      <span aria-hidden="true" style={{ color: ok ? D.green : D.red, fontWeight: 900 }}>{ok ? "✓" : "✗"}</span>
      <span>{label}: <strong>{ok ? "yes" : "no"}</strong></span>
    </li>
  );
}

// "Send location link": the only place the URL ever appears. Not persisted.
function SendLink({ row, onSent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(null);

  const send = async () => {
    setBusy(true); setError(null); setCopied(null);
    try {
      setResult(await apiPost("/api/accounts/location-links/", { business_owner: row.id }));
      onSent();
    } catch (err) {
      setResult(null);
      setError(refusal(err, "Could not create a location link. Please try again."));
    } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.url); setCopied("Copied."); }
    catch { setCopied("Could not copy automatically: select the link above and copy it by hand."); }
  };
  const smsText = result && (result.sms_state === "sent" ? `Text sent${result.phone_masked ? ` to ${result.phone_masked}` : ""}.` : SMS_TEXT[result.sms_state]);

  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" onClick={send} disabled={busy} style={button(D.panelBg, D.text, busy)}>{busy ? "Creating link…" : "Send location link"}</button>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", marginTop: 6 }}>{error}</div>}
      {result && (
        <div role="status" style={{ ...callout(D.green), marginTop: 8 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Location link created</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input readOnly aria-label="Location link" value={result.url} onFocus={(e) => e.target.select()} style={{ ...field, flex: "1 1 240px", minWidth: 0 }} />
            <button type="button" onClick={copy} style={button(D.panelBg, D.text, false)}>Copy link</button>
          </div>
          {copied && <div style={{ ...dim, marginTop: 4 }}>{copied}</div>}
          <div style={{ fontWeight: 600, marginTop: 6 }}>{`Works once. Expires ${when(result.expires_at)}.`}</div>
          <div style={{ fontWeight: 600, marginTop: 2 }}>{smsText}</div>
        </div>
      )}
    </div>
  );
}

// Mark verified / Mark wrong. Both buttons are disabled with the reason beside them when the row is blocked.
function Decision({ row, onDecided }) {
  const [mode, setMode] = useState(null); // null | "verify" | "wrong"
  const [method, setMethod] = useState("video_call");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const blocked = !row.can_decide;

  const open = (next) => { setMode(next); setError(null); setNote(""); };
  const submit = async (event) => {
    event.preventDefault();
    const text = note.trim();
    if (mode === "wrong" && !text) { setError("Write the reason the owner will see."); return; }
    if (mode === "verify" && method === "video_call" && !text) { setError("Write what the video call showed."); return; }
    setBusy(true); setError(null);
    try {
      await apiPost(`/api/accounts/address-verification/${row.id}/decide/`, mode === "verify"
        ? { result: "verified", method, note: text }
        : { result: "wrong", method: "desk", note: text });
      onDecided(mode === "verify" ? `${row.business_name}: address marked verified.` : `${row.business_name}: address marked wrong; the owner has been told why.`);
    } catch (err) {
      setError(refusal(err, "Could not record the decision. Please try again."));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" disabled={blocked} onClick={() => open("verify")} style={button(D.green, "#fff", blocked)}>Mark verified</button>
        <button type="button" disabled={blocked} onClick={() => open("wrong")} style={button(D.panelBg, D.red, blocked)}>Mark wrong</button>
        {blocked && row.blocked_reason && <span style={{ color: D.text, fontSize: "0.76rem", fontWeight: 600 }}>{row.blocked_reason}</span>}
      </div>
      {!blocked && mode && (
        <form onSubmit={submit} style={{ marginTop: 10, display: "grid", gap: 8, maxWidth: 520 }}>
          {mode === "verify" ? (
            <>
              <label style={{ display: "grid", gap: 4, fontSize: "0.74rem", fontWeight: 700, color: D.text }}>
                Method
                <select value={method} onChange={(e) => setMethod(e.target.value)} style={field}>
                  <option value="video_call">Video call with the owner</option>
                  <option value="gps_capture">GPS capture re-check</option>
                  <option value="scout">Scout's field report</option>
                </select>
              </label>
              <div style={dim}>
                {row.evidence.first_verification
                  ? "This is the first verification, so it needs a video call with the owner. A GPS capture re-check is for later verifications."
                  : "A GPS capture re-check uses the owner's fix and the signboard photo."}
              </div>
              <label style={{ display: "grid", gap: 4, fontSize: "0.74rem", fontWeight: 700, color: D.text }}>
                {method === "video_call" ? "What the video call showed (required)" : "Note (optional)"}
                <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} style={field} />
              </label>
            </>
          ) : (
            <label style={{ display: "grid", gap: 4, fontSize: "0.74rem", fontWeight: 700, color: D.text }}>
              Reason (the owner will see this)
              <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} style={field} />
            </label>
          )}
          {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={button(mode === "verify" ? D.green : D.red, "#fff", busy)}>{mode === "verify" ? "Confirm verified" : "Confirm wrong"}</button>
            <button type="button" onClick={() => setMode(null)} style={button(D.panelBg, D.text, false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Detail({ row, tab, onChanged, onDecided }) {
  const pin = row.pin;
  const decided = tab !== "pending";
  const v = row.verification;
  return (
    <div style={{ marginTop: 12, padding: 14, background: D.panelBg2, borderRadius: 12, border: `1px solid ${D.cardBorder}` }}>
      {pin ? (
        <AddressPinMap pin={pin} label={`Map of ${row.business_name}'s stored pin`} />
      ) : (
        <div style={{ ...callout(D.amber), fontWeight: 600 }}>No pin yet. There is nothing to show on a map until the owner shares the shop's location. Send them a location link below.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0 20px", marginTop: 12 }}>
        <Fact label="Ghana Post code">{row.gps_address || "Not stored"}</Fact>
        <Fact label="Registered by">{row.registrar ? row.registrar.name : "Registered online by the owner"}</Fact>
        <Fact label="Pin">{pin ? `${pinText(pin)}${pin.set_at ? `, ${when(pin.set_at)}` : ""}` : "No pin yet"}</Fact>
        <Fact label="Latest location link">{linkText(row.last_capture)}</Fact>
      </div>

      <div style={sectionHead}>Signboard photo</div>
      {row.signboard_photo ? (
        <a href={row.signboard_photo} target="_blank" rel="noreferrer">
          <img src={row.signboard_photo} alt={`Signboard of ${row.business_name}`} style={{ width: "100%", maxWidth: 320, borderRadius: 10, border: `1px solid ${D.cardBorder}`, display: "block" }} />
        </a>
      ) : (
        <div style={dim}>No signboard photo</div>
      )}

      <div style={sectionHead}>Evidence</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <EvidenceItem ok={row.evidence.owner_gps_50m} label="Owner's own GPS fix from the shop, within 50 m" />
        <EvidenceItem ok={row.evidence.signboard} label="Signboard photo on file" />
        <EvidenceItem ok={row.evidence.scout_report} label="Scout's report confirming the address" />
      </ul>
      <div style={{ ...dim, marginTop: 4 }}>{row.evidence.first_verification ? "First verification: needs a video call with the owner." : "Verified before: a GPS capture re-check is allowed."}</div>

      {decided && v && (
        <>
          <div style={sectionHead}>{tab === "verified" ? "Verified" : "Marked wrong"}</div>
          <div style={{ color: D.text, fontSize: "0.78rem" }}>
            {`${tab === "verified" ? "Verified" : "Marked wrong"}${v.by_name ? ` by ${v.by_name}` : ""}${v.at ? ` on ${when(v.at)}` : ""}${v.method ? ` through ${METHOD_TEXT[v.method] || v.method}` : ""}.`}
          </div>
          {v.note && <div style={{ color: D.text, fontSize: "0.78rem", marginTop: 4 }}>{`${tab === "wrong" ? "Reason" : "Note"}: ${v.note}`}</div>}
        </>
      )}

      <div style={sectionHead}>Actions</div>
      {decided ? <div style={{ ...dim, fontSize: "0.78rem" }}>{REOPEN_TEXT}</div> : <Decision row={row} onDecided={onDecided} />}
      <SendLink row={row} onSent={onChanged} />
    </div>
  );
}

function QueueRow({ row, tab, open, onToggle, onChanged, onDecided }) {
  return (
    <div role="group" aria-label={row.business_name} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{row.business_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.72rem" }}>{[row.owner_name, row.zone, row.gps_address].filter(Boolean).join(" · ")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <span style={chip(row.pin ? D.green : D.amber)}>{pinText(row.pin)}</span>
            <span style={chip(D.textDim)}>{linkText(row.last_capture)}</span>
          </div>
        </div>
        <button type="button" aria-expanded={open} onClick={onToggle} style={{ ...pill(open), fontSize: "0.7rem" }}>{open ? "▲ Hide details" : "View details"}</button>
      </div>
      {open && <Detail row={row} tab={tab} onChanged={onChanged} onDecided={onDecided} />}
    </div>
  );
}

export default function AddressVerificationPanel() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("pending");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState(null);
  const query = useAddressVerification({ status: tab, page });
  const rows = query.data?.results || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["address-verification"] });
    queryClient.invalidateQueries({ queryKey: ["staff-badges"] });
  };
  const selectTab = (next) => { setTab(next); setPage(1); setOpenId(null); setNotice(null); };
  const decided = (message) => { setOpenId(null); setNotice(message); refresh(); };

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem" }}>Address verification</div>
      <div style={{ ...dim, margin: "4px 0 12px" }}>
        The owner shares the shop's location from the shop. Check the evidence, then mark the address verified or wrong. Whoever registered a business or set its pin cannot verify it.
      </div>

      <div role="group" aria-label="Queue state" style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map((key) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => selectTab(key)} style={pill(tab === key)}>
            {TAB_LABELS[key]}{tab === key && query.data ? ` · ${query.data.count}` : ""}
          </button>
        ))}
      </div>

      {notice && <div role="status" style={{ ...callout(D.green), marginBottom: 12 }}>{notice}</div>}
      {query.isLoading && <div style={dim}>Loading…</div>}
      {query.isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load this queue.</div>}
      {query.data && rows.length === 0 && <div style={dim}>{EMPTY[tab]}</div>}
      {rows.map((row) => (
        <QueueRow
          key={row.id}
          row={row}
          tab={tab}
          open={openId === row.id}
          onToggle={() => setOpenId(openId === row.id ? null : row.id)}
          onChanged={refresh}
          onDecided={decided}
        />
      ))}

      {query.data && (query.data.previous || query.data.next) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
          <button type="button" disabled={!query.data.previous} onClick={() => { setPage((p) => Math.max(1, p - 1)); setOpenId(null); }} style={button(D.panelBg, D.text, !query.data.previous)}>Previous</button>
          <span style={dim}>{`Page ${page}`}</span>
          <button type="button" disabled={!query.data.next} onClick={() => { setPage((p) => p + 1); setOpenId(null); }} style={button(D.panelBg, D.text, !query.data.next)}>Next</button>
        </div>
      )}
    </div>
  );
}
