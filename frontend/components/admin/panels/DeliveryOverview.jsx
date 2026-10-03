import { useMyDeliveries } from "../../../hooks/useMyDeliveries.js";
import { useDeliveryManagerOrders } from "../../../hooks/useDeliveryManagerOrders.js";
import { useDispatchStaff } from "../../../hooks/useDispatchStaff.js";
import { D, glassCard, sectionTitle, kpiGrid } from "../theme.js";
import KpiCard from "../../dashboard/charts/KpiCard.jsx";

// Overview sections for the two delivery roles. Every number comes from an
// endpoint the role's own panel already reads (same permission, so never a
// 403): GET /api/orders/dispatch/ (delivery.dispatch, My Deliveries) and GET
// /api/orders/delivery/ + /api/orders/dispatches/ (delivery.manage, Delivery
// Coordination). Both lists are paginated (20 a page): totals use `count`;
// status breakdowns can only be counted from the rows actually returned, so
// when there is a next page each breakdown tile says it covers "newest N of
// COUNT" rather than passing a page length off as a total.
//
// Neither list is a live backlog: Order.status stays "paid" for good (only
// delivery_status moves), so /delivery/ holds every paid door-to-door order
// ever placed and /dispatch/ every assignment the courier ever had. The
// `count` tiles are therefore labelled as all-time totals; the current
// workload is what the per-status tiles show.

const openBtn = {
  minHeight: 44, border: "none", borderRadius: 20, padding: "0 18px", background: D.gold, color: D.text,
  fontSize: "0.8rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
};
const note = { color: D.textDim, fontSize: "0.8rem" };

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// For a DRF page: the real total, the rows we have, and — when they differ —
// the qualifier every derived tile must carry.
function pageOf(data) {
  const rows = data?.results || [];
  const total = data?.count ?? rows.length;
  const partial = Boolean(data?.next) || total > rows.length;
  return { rows, total, partialSub: partial ? `newest ${rows.length} of ${total}` : undefined };
}

function Section({ title, children, action }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ ...sectionTitle, marginBottom: 10 }}>{title}</div>
      {children}
      <div style={{ marginTop: 12 }}>{action}</div>
    </section>
  );
}

const DISPATCH_STATUS = { assigned: "Awaiting pickup", picked_up: "Out for delivery" };

export function DispatchOverview({ onNavigate }) {
  const { data, isLoading, isError } = useMyDeliveries();
  const action = (
    <button type="button" onClick={() => onNavigate?.("my-deliveries")} style={openBtn}>Open My Deliveries →</button>
  );

  if (isLoading) return <Section title="Your deliveries" action={action}><div style={note}>Loading your deliveries…</div></Section>;
  if (isError) return <Section title="Your deliveries" action={action}><div style={{ ...note, color: D.red }}>Could not load your deliveries.</div></Section>;

  const { rows, total, partialSub } = pageOf(data);
  if (total === 0) return <Section title="Your deliveries" action={action}><div style={note}>No deliveries assigned to you yet.</div></Section>;

  const awaiting = rows.filter(d => d.status === "assigned").length;
  const outFor = rows.filter(d => d.status === "picked_up").length;
  const deliveredToday = rows.filter(d => isToday(d.delivered_at)).length;
  // Next up: the jobs the courier can still act on — anything already
  // picked up first, then the oldest assignment.
  const nextUp = rows
    .filter(d => d.status in DISPATCH_STATUS)
    .sort((a, b) => (a.status === "picked_up" ? 0 : 1) - (b.status === "picked_up" ? 0 : 1)
      || new Date(a.assigned_at) - new Date(b.assigned_at))
    .slice(0, 3);

  const tiles = [
    { icon: "📦", label: "All-time assignments", value: total, accent: D.gold, sub: "every status, delivered included" },
    { icon: "⏳", label: "Awaiting pickup", value: awaiting, accent: D.amber, sub: partialSub },
    { icon: "🛵", label: "Out for delivery", value: outFor, accent: D.blue, sub: partialSub },
    { icon: "✅", label: "Delivered today", value: deliveredToday, accent: D.green, sub: partialSub },
  ];

  return (
    <Section title="Your deliveries" action={action}>
      <div style={kpiGrid}>{tiles.map(t => <KpiCard key={t.label} {...t} />)}</div>
      <div style={{ ...glassCard, padding: "14px 16px", marginTop: 12 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.82rem", marginBottom: 6 }}>Next up</div>
        {nextUp.length === 0 ? (
          <div style={note}>Nothing waiting on you right now.</div>
        ) : (
          <ul aria-label="Next up" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {nextUp.map(d => (
              <li key={d.id} style={{ padding: "8px 0", borderTop: `1px solid ${D.divider}`, minWidth: 0 }}>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem", overflowWrap: "anywhere" }}>
                  {`Order #${d.order_id} · ${d.customer_name} · ${DISPATCH_STATUS[d.status]}`}
                </div>
                <div style={{ color: D.textDim, fontSize: "0.74rem", overflowWrap: "anywhere" }}>{d.delivery_address}</div>
              </li>
            ))}
          </ul>
        )}
        {partialSub && <div style={{ color: D.textFaint, fontSize: "0.68rem", marginTop: 6 }}>{`Picked from the ${partialSub}.`}</div>}
      </div>
    </Section>
  );
}

export function DeliveryManagerOverview({ onNavigate }) {
  const { data, isLoading, isError } = useDeliveryManagerOrders();
  const riders = useDispatchStaff();
  const action = (
    <button type="button" onClick={() => onNavigate?.("delivery-coordination")} style={openBtn}>Open Delivery Coordination →</button>
  );
  // Only rendered when the list actually loaded — never a stand-in 0.
  const riderTile = Array.isArray(riders.data)
    ? { icon: "🛵", label: "Active dispatch riders", value: riders.data.length, accent: D.deepGold, sub: "active accounts, not live availability" }
    : null;

  if (isLoading) return <Section title="Delivery queue" action={action}><div style={note}>Loading deliveries…</div></Section>;
  if (isError) return <Section title="Delivery queue" action={action}><div style={{ ...note, color: D.red }}>Could not load door-to-door orders.</div></Section>;

  const { rows, total, partialSub } = pageOf(data);
  const status = o => o.delivery_assignment?.status;
  const tiles = total === 0 ? [riderTile].filter(Boolean) : [
    { icon: "🚚", label: "Door-to-door orders (all time)", value: total, accent: D.gold, sub: "paid, every delivery status" },
    { icon: "📝", label: "Unassigned", value: rows.filter(o => !o.delivery_assignment).length, accent: D.amber, sub: partialSub },
    { icon: "⏳", label: "Awaiting pickup", value: rows.filter(o => status(o) === "assigned").length, accent: D.amber, sub: partialSub },
    { icon: "🛣️", label: "In transit", value: rows.filter(o => status(o) === "picked_up").length, accent: D.blue, sub: partialSub },
    { icon: "✅", label: "Delivered today", value: rows.filter(o => isToday(o.delivery_assignment?.delivered_at)).length, accent: D.green, sub: partialSub },
    riderTile,
  ].filter(Boolean);

  return (
    <Section title="Delivery queue" action={action}>
      {total === 0 && <div style={{ ...note, marginBottom: tiles.length ? 12 : 0 }}>No door-to-door orders to coordinate right now.</div>}
      {tiles.length > 0 && <div style={kpiGrid}>{tiles.map(t => <KpiCard key={t.label} {...t} />)}</div>}
    </Section>
  );
}
