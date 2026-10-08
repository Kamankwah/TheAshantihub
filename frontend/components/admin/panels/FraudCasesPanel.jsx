import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useBusinessOwnerSearch, useFraudFlagCounts, useFraudFlags } from "../../../hooks/useFraudFlags.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { card, errorStyle, formatDateTime, h2, h3, labelStyle, useDebounced } from "./portfolioParts.jsx";

// /staff/fraud-cases. Operations and Super Admin (fraud.manage) work the
// queue: every decision needs a note, and confirming a case about a business
// may also suspend it. Someone who can only flag (Support, fraud.flag)
// raises cases and follows the ones they raised — the server lists only
// those. Every refusal shows the server's own reason.

const STATUSES = [["open", "Open"], ["confirmed", "Confirmed"], ["dismissed", "Dismissed"]];
const RAISABLE = [["fake_business", "Fake business"], ["duplicate", "Duplicate registration"], ["other", "Other"]];
const SOURCE = { system: "the system", owner: "the owner", staff: "a staff member" };
const EMPTY = { open: "No open cases.", confirmed: "No confirmed cases.", dismissed: "No dismissed cases." };
const EMPTY_MINE = {
  open: "None of the cases you raised is open.",
  confirmed: "None of the cases you raised has been confirmed.",
  dismissed: "None of the cases you raised has been dismissed.",
};
const INTRO_MANAGE = "Raised automatically by the registration checks and by owners pressing “This wasn't me”, or by hand by Support and Operations. Confirming or dismissing always needs a note.";
const INTRO_FLAG = "You can raise a case about a business. Operations decides it; here you see the cases you raised.";
const REFRESH_KEYS = ["fraud-flags", "fraud-flag-counts", "staff-badges"];

function ownerLabel(owner) {
  const name = owner.business_name || owner.full_name;
  const person = owner.business_name && owner.business_name !== owner.full_name ? owner.full_name : null;
  return [name, person, owner.login_phone].filter(Boolean).join(" · ");
}

function decisionLine(flag) {
  const verb = flag.status === "confirmed" ? "Confirmed" : "Dismissed";
  const by = flag.resolved_by_name ? ` by ${flag.resolved_by_name}` : "";
  const at = flag.resolved_at ? ` · ${formatDateTime(flag.resolved_at)}` : "";
  const note = flag.resolution_note ? `: “${flag.resolution_note}”` : "";
  return `${verb}${by}${at}${note}`;
}

function ScopeLines({ flag }) {
  const lines = [];
  const business = flag.business_owner;
  if (business) {
    lines.push(`Business: ${business.display_name} · ${business.account_manager_name ? `account manager ${business.account_manager_name}` : "no account manager"}`);
  }
  if (flag.related_business_owner) lines.push(`Also involved: ${flag.related_business_owner.display_name}`);
  if (flag.staff_subject) lines.push(`About a staff member: ${flag.staff_subject.full_name}`);
  if (!lines.length) return null;
  return <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{lines.map((line) => <div key={line} style={dim}>{line}</div>)}</div>;
}

function CaseCard({ flag, me, canDecide, onOpen, onDone, onRefused }) {
  const [note, setNote] = useState("");
  const [suspend, setSuspend] = useState(false);
  const [busy, setBusy] = useState(false);
  const business = flag.business_owner;
  const related = flag.related_business_owner;
  const open = flag.status === "open";
  const aboutMe = flag.staff_subject != null && me?.id != null && flag.staff_subject.id === me.id;
  const ready = note.trim().length > 0 && !busy;

  const decide = async (action) => {
    setBusy(true);
    const suspending = action === "confirm" && Boolean(flag.can_suspend && business) && suspend;
    try {
      const body = action === "confirm" ? { note: note.trim(), suspend: suspending } : { note: note.trim() };
      await apiPost(`/api/fraud/flags/${flag.id}/${action}/`, body);
      onDone(action === "confirm"
        ? `Confirmed: ${flag.title}${suspending ? ` — ${business.display_name} is suspended` : ""}.`
        : `Dismissed: ${flag.title}.`);
    } catch (err) {
      onRefused(apiErrorMessage(err, "Could not save the decision."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article aria-label={flag.title} style={card}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={chip(D.red)}>{flag.kind_label}</span>
        {flag.status === "confirmed" && <span style={chip(D.red)}>Confirmed</span>}
        {flag.status === "dismissed" && <span style={chip(D.textFaint)}>Dismissed</span>}
        <span style={dim}>{`Raised by ${flag.raised_by_name || SOURCE[flag.source] || "the system"} · ${formatDateTime(flag.created_at)}`}</span>
      </div>
      <h3 style={h3}>{flag.title}</h3>
      {flag.detail && <div style={{ color: D.text, fontSize: "0.8rem" }}>{flag.detail}</div>}
      <ScopeLines flag={flag} />
      {flag.evidence?.length > 0 && (
        <ul aria-label="Evidence" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2, fontSize: "0.8rem", color: D.text }}>
          {flag.evidence.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}
        </ul>
      )}
      {open && flag.kind === "self_dealing" && <div style={callout(D.amber)}>Its KYC request is on hold until this case is decided.</div>}
      {!open && <div style={dim}>{decisionLine(flag)}</div>}
      {onOpen && (business || related) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {business && <button type="button" aria-label={`Open ${business.display_name}`} onClick={() => onOpen(business.id)} style={button(D.panelBg, D.text)}>Open business</button>}
          {related && <button type="button" aria-label={`Open ${related.display_name}`} onClick={() => onOpen(related.id)} style={button(D.panelBg, D.text)}>Open the other business</button>}
        </div>
      )}
      {open && canDecide && aboutMe && <div style={callout(D.amber)}>This case is about you — someone else decides it.</div>}
      {open && canDecide && !aboutMe && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={labelStyle}>Note (required)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} style={field} />
          </label>
          {flag.can_suspend && business && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.8rem", fontWeight: 700, color: D.text }}>
                <input type="checkbox" checked={suspend} onChange={(e) => setSuspend(e.target.checked)} />
                {`Suspend ${business.display_name}`}
              </label>
              <div style={dim}>Only when you confirm: its listings and events are hidden and the owner is told why.</div>
            </div>
          )}
          {!note.trim() && <div style={dim}>Write a note to confirm or dismiss.</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={!ready} onClick={() => decide("dismiss")} style={button(D.panelBg, D.text, !ready)}>Dismiss</button>
            <button type="button" disabled={!ready} onClick={() => decide("confirm")} style={button(D.red, D.panelBg, !ready)}>Confirm fraud</button>
          </div>
        </div>
      )}
    </article>
  );
}

// "Raise a case": the kind, the business (searched by name, owner or phone;
// needed for a fake business or a duplicate — the server says so), a title
// and what happened. Posts {kind, title, detail, business_owner}.
function RaiseCaseForm({ onRaised, onCancel }) {
  const [kind, setKind] = useState("fake_business");
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 300);
  const owners = useBusinessOwnerSearch(term);
  const [chosen, setChosen] = useState(null); // {id, label}
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const found = (owners.data?.results || []).map((owner) => ({ id: String(owner.id), label: ownerLabel(owner) }));
  const options = chosen && !found.some((option) => option.id === chosen.id) ? [chosen, ...found] : found;
  const placeholder = term.length < 2
    ? "Type at least two letters to search"
    : owners.isLoading ? "Searching…"
      : owners.isError ? "Couldn't search businesses"
        : found.length === 0 ? "No business matches" : "Choose a business";
  const ready = title.trim().length > 0 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    try {
      const flag = await apiPost("/api/fraud/flags/", {
        kind, title: title.trim(), detail: detail.trim(), business_owner: chosen ? Number(chosen.id) : null,
      });
      onRaised(flag);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not raise the case."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label="Raise a case" onSubmit={submit} noValidate style={card}>
      <h3 style={h3}>Raise a case</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 10 }}>
        <label style={labelStyle}>Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={field}>
            {RAISABLE.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Find the business
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Business name, owner or phone" style={field} />
        </label>
        <label style={labelStyle}>Business
          <select value={chosen?.id || ""} onChange={(e) => setChosen(e.target.value ? options.find((option) => option.id === e.target.value) || null : null)} style={field}>
            <option value="">{placeholder}</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <div style={dim}>A fake business or a duplicate registration needs the business it's about.</div>
      <label style={labelStyle}>Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} style={field} />
      </label>
      <label style={labelStyle}>What happened
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={2000} style={field} />
      </label>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="submit" disabled={!ready} style={button(D.gold, D.text, !ready)}>Raise case</button>
      </div>
    </form>
  );
}

export default function FraudCasesPanel({ auth, onOpenBusiness }) {
  const canDecide = Boolean(auth?.hasPermission?.("fraud.manage"));
  const canOpen = Boolean(onOpenBusiness) && Boolean(auth?.hasPermission?.("portfolio.manage"));
  const [status, setStatus] = useState("open");
  const [raising, setRaising] = useState(false);
  const [notice, setNotice] = useState(null); // {ok, text}
  const queryClient = useQueryClient();
  const { data: counts } = useFraudFlagCounts();
  const { data, isLoading, isError, refetch } = useFraudFlags(status);
  const cases = data?.results || [];
  const refresh = () => REFRESH_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  // A refusal also refreshes: the case may have been decided meanwhile.
  const done = (text) => { setNotice({ ok: true, text }); refresh(); };
  const refused = (text) => { setNotice({ ok: false, text }); refresh(); };
  const label = (id, text) => (counts && counts[id] != null ? `${text} · ${counts[id]}` : text);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={h2}>Fraud cases</h2>
          <button type="button" aria-expanded={raising} onClick={() => { setNotice(null); setRaising((r) => !r); }} style={button(D.gold, D.text)}>Raise a case</button>
        </div>
        <div style={dim}>{canDecide ? INTRO_MANAGE : INTRO_FLAG}</div>
        <div role="group" aria-label="Which cases" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STATUSES.map(([id, text]) => (
            <button key={id} type="button" aria-pressed={status === id} onClick={() => { setNotice(null); setStatus(id); }} style={pill(status === id)}>{label(id, text)}</button>
          ))}
        </div>
      </div>

      {raising && (
        <RaiseCaseForm
          onCancel={() => setRaising(false)}
          onRaised={(flag) => { setRaising(false); setStatus("open"); done(`Case raised: ${flag.title}. Operations has been told.`); }}
        />
      )}
      {notice && <div role={notice.ok ? "status" : "alert"} style={callout(notice.ok ? D.green : D.red)}>{notice.text}</div>}
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={{ ...card, ...errorStyle }}>
          Could not load fraud cases.
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button>
        </div>
      )}
      {!isLoading && !isError && cases.length === 0 && <div style={{ ...card, ...dim }}>{(canDecide ? EMPTY : EMPTY_MINE)[status]}</div>}
      {cases.map((flag) => (
        <CaseCard key={flag.id} flag={flag} me={auth?.user} canDecide={canDecide} onOpen={canOpen ? onOpenBusiness : null} onDone={done} onRefused={refused} />
      ))}
      {data?.next && <div style={dim}>{`Showing the newest ${cases.length} of ${data.count}.`}</div>}
    </div>
  );
}
