import { D } from "../theme.js";

// Overview tab's "recent activity" timeline (sketch's "Live activity" card) —
// built from data the Overview panel already fetches, NOT a live/websocket
// feed. Merges the owner's recent transactions (useMyTransactions — has
// purpose/amount/status/created_at) and recent reviews (useOwnerReviews'
// results — has rating/comment/created_at), sorted by created_at desc and
// capped, so every row traces back to a real record.
const TX_META = {
  success: { icon: "💚", color: D.green, label: "Payment successful" },
  pending: { icon: "⏳", color: D.amber, label: "Payment pending" },
  failed: { icon: "❌", color: D.red, label: "Payment failed" },
};

export function buildActivity(transactions, reviews, limit = 6) {
  const txItems = (transactions || []).map((t) => {
    const meta = TX_META[t.status] || { icon: "💰", color: D.gold, label: t.status };
    return {
      key: `tx-${t.id}`,
      icon: meta.icon,
      color: meta.color,
      title: t.purpose,
      sub: `GHS ${Number(t.amount).toLocaleString()} — ${meta.label}`,
      date: t.created_at,
    };
  });
  const reviewItems = (reviews || []).map((r) => ({
    key: `review-${r.id}`,
    icon: "⭐",
    color: D.gold,
    title: `New ${r.rating}★ review`,
    sub: r.comment ? `"${r.comment}"` : "No comment left",
    date: r.created_at,
  }));
  return [...txItems, ...reviewItems]
    .filter((i) => i.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

export default function ActivityFeed({ transactions, reviews }) {
  const items = buildActivity(transactions, reviews);

  if (items.length === 0) {
    return <div style={{ color: D.textFaint, fontSize: "0.78rem", padding: "8px 0" }}>No recent activity yet — payments and reviews will show up here.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((item, i) => (
        <div key={item.key} style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${item.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.82rem", flexShrink: 0 }}>{item.icon}</div>
            {i < items.length - 1 && <div style={{ flex: 1, width: 2, background: D.divider, marginTop: 4, marginBottom: 4 }} />}
          </div>
          <div style={{ flex: 1, paddingBottom: 16, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: "0.8rem", color: D.text }}>{item.title}</div>
            <div style={{ fontSize: "0.72rem", color: D.textDim, marginTop: 2, overflowWrap: "anywhere" }}>{item.sub}</div>
            <div style={{ fontSize: "0.64rem", color: D.textFaint, marginTop: 4 }}>{String(item.date).slice(0, 10)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
