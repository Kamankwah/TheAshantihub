import { useState } from "react";
import { useSaEventCounts, useSaEvents } from "../../../hooks/useMarketplace.js";
import { D } from "../theme.js";
import { button, callout, dim } from "./panelStyles.js";
import { Chip, CountCell, CountHead, ExportButton, FilterBar, KpiStrip, LoadState, Pager, ScreenHeader, SimulatedBanner, col, dateOnly, dateTime, showing, tableStyle, td, th } from "./marketplaceParts.jsx";
import { card, h3, money, useDebounced } from "./portfolioParts.jsx";

// Super Admin > Events & tickets (screen 21): real ticket and escrow records.
// Ticket money is held. A door check-in only records that the ticket was
// delivered; it never releases money. A ticket in the ledger is released by
// the release timer, and a ticket bought before the ledger by Accounting by
// hand. Accounting can also refund. Nothing pays organisers out yet, and
// payments are simulated.

const STATE_COLOR = { on_sale: D.green, ended: D.textFaint, waiting: D.amber, unpaid: D.amber, rejected: D.red, expired: D.textFaint };
const FLOW = [
  "The buyer pays in the app (simulated for now) and gets a ticket code.",
  "The money is held. It is not the organiser's yet.",
  "At the door the organiser checks the code in the app. Checking a ticket in records that it was delivered; it does not release the money.",
  "The money is released by the release timer for tickets in the ledger, or by Accounting by hand, with a note, for tickets bought before the ledger. Accounting can also refund a held ticket (fraud, a dispute, a no-show).",
  "Paying organisers out is not built yet: “released” means released in the records, not sent to a bank or MoMo account.",
];

function Capacity({ sold, capacity }) {
  if (!capacity) return <span>{`${sold} sold`}</span>;
  const pct = Math.min(100, Math.round((sold / capacity) * 100));
  return (
    <div>
      <div>{`${sold} of ${capacity}`}</div>
      <div role="progressbar" aria-label="Tickets sold" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={sold} style={{ height: 5, background: D.panelBg2, borderRadius: 5, overflow: "hidden", width: 90 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: D.green }} />
      </div>
    </div>
  );
}

function EventSide({ event: e, onClose }) {
  const facts = [
    ["Organiser", `${e.organiser.name}${e.organiser.kind === "business" ? (e.organiser.verified ? " · verified business" : " · KYC not verified") : " · a customer"}`],
    ["Tickets", e.ticket_types.map((t) => `${t.name} ${money(t.price)} · ${t.sold}${t.total != null ? ` of ${t.total}` : ""} sold${t.active ? "" : " · off sale"}`).join(" | ") || "No ticket types"],
    ["Held", money(e.held)], ["Released", money(e.released)], ["Refunded", `${money(e.refunded)} (${e.refunded_count} ${e.refunded_count === 1 ? "ticket" : "tickets"})`],
    ["Checked in at the door", String(e.checked_in)], ["Listing fee paid", e.paid_at ? dateTime(e.paid_at) : "Not paid"],
  ];
  return (
    <section aria-label={e.name} style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <h3 style={h3}>{e.name}</h3>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text)}>Close</button>
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "8px 18px", margin: 0 }}>
        {facts.map(([k, v]) => <div key={k}><dt style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</dt><dd style={{ margin: 0, color: D.text, fontSize: "0.8rem", fontWeight: 600, overflowWrap: "anywhere" }}>{v}</dd></div>)}
      </dl>
    </section>
  );
}

export default function SaEventsPanel() {
  const [show, setShow] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [exportError, setExportError] = useState(null);
  const q = useDebounced(search.trim());
  const params = { show, q };
  const list = useSaEvents({ ...params, page });
  const { data: counts } = useSaEventCounts();
  const rows = list.data?.results || [];

  const tiles = counts ? [
    { label: "On sale", value: `${counts.on_sale} ${counts.on_sale === 1 ? "event" : "events"}`, sub: counts.next_event_at ? `Next: ${dateOnly(counts.next_event_at)}` : "None coming up" },
    { label: "Tickets sold for them", value: counts.capacity ? `${counts.tickets_sold} / ${counts.capacity}` : String(counts.tickets_sold), sub: counts.capacity ? `${Math.round((counts.tickets_sold / counts.capacity) * 100)}% of seats` : "No fixed number of seats" },
    { label: "Ticket money held", value: money(counts.held), sub: "Until each ticket is checked in" },
    { label: "Released this month", value: money(counts.released_this_month), sub: "In the records" },
    { label: "Refunded this quarter", value: money(counts.refunded_this_quarter), sub: "Tickets refunded by Accounting" },
    { label: "Waiting for review", value: counts.waiting_for_review, sub: "With Marketing", tone: counts.waiting_for_review ? D.amber : undefined },
  ] : [];

  return (
    <div style={col}>
      <ScreenHeader title="Events & tickets" note="Events on AshantiHub, the tickets sold for them and where the money is.">
        <ExportButton path="/api/marketplace/events/export/" params={params} filename="ticket-sales.csv" label="Export ticket sales (CSV)" onError={setExportError} />
      </ScreenHeader>
      <SimulatedBanner>Ticket money is recorded as held for the organiser; nothing is paid out for real yet.</SimulatedBanner>
      {exportError && <div role="alert" style={callout(D.red)}>{exportError}</div>}
      <KpiStrip tiles={tiles} label="Events summary" />
      <div style={card}>
        <h3 style={h3}>Events</h3>
        <FilterBar filters={[{ key: "show", label: "Show", options: [["", "All events"], ["on_sale", "On sale"], ["ended", "Ended"], ["waiting", "Waiting for review"], ["not_live", "Rejected, expired or unpaid"]] }]}
          values={{ show }} onChange={(_k, v) => { setShow(v); setPage(1); }} search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchLabel="Event or organiser" />
      </div>
      {open && <EventSide event={open} onClose={() => setOpen(null)} />}
      <div style={card}>
        <LoadState query={list} what="the events" />
        {!list.isLoading && !list.isError && rows.length === 0 && <div style={dim}>No event matches.</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Events" style={{ ...tableStyle, minWidth: 1040 }}>
              <thead><tr><th style={th}>Event</th><th style={th}>When · where</th><th style={th}>Tickets sold</th><th style={th}>Price</th><th style={th}>Sales</th><th style={th}>Money</th><CountHead tip="Tickets sold, each ticket counted once. A refunded ticket still counts as paid.">Paid</CountHead><CountHead tip="Of the tickets sold, how many were refunded.">Refunded</CountHead><th style={th}>Status</th><th style={th} /></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td style={td}><div style={{ fontWeight: 800 }}>{e.name}</div><div style={dim}>{`by ${e.organiser.name}`}</div></td>
                    <td style={td}>{dateTime(e.event_date)}<div style={dim}>{e.zone}</div></td>
                    <td style={td}><Capacity sold={e.tickets_sold} capacity={e.capacity} /></td>
                    <td style={td}>{e.price_min == null ? "—" : e.price_min === e.price_max ? money(e.price_min) : `${money(e.price_min)} – ${money(e.price_max)}`}</td>
                    <td style={td}>{e.tickets_sold ? money(e.sales) : "—"}</td>
                    <td style={td}>
                      {Number(e.held) > 0 && <div>{`Held ${money(e.held)}`}</div>}
                      {Number(e.released) > 0 && <div>{`Released ${money(e.released)}`}</div>}
                      {Number(e.refunded) > 0 && <div>{`Refunded ${money(e.refunded)}`}</div>}
                      {!Number(e.held) && !Number(e.released) && !Number(e.refunded) && <span style={dim}>Nothing collected</span>}
                    </td>
                    <CountCell value={e.paid_count} />
                    <CountCell value={e.refunded_count} />
                    <td style={td}><Chip color={STATE_COLOR[e.state] || D.textFaint}>{e.state_label}</Chip></td>
                    <td style={td}><button type="button" aria-label={`Open ${e.name}`} onClick={() => setOpen(e)} style={button(D.panelBg, D.text)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <div style={dim}>{`${showing(list.data, rows)} · latest first.`}</div>}
      </div>
      <Pager data={list.data} page={page} setPage={setPage} />
      <section aria-label="How ticket money moves" style={card}>
        <h3 style={h3}>How ticket money moves</h3>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: D.text, display: "flex", flexDirection: "column", gap: 4 }}>{FLOW.map((t) => <li key={t}>{t}</li>)}</ol>
      </section>
    </div>
  );
}
