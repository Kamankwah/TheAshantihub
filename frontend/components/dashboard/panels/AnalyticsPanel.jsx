import { useMyListings } from "../../../hooks/useMyListings.js";
import { useMyTransactions } from "../../../hooks/useMyTransactions.js";
import { useMyCreditScore } from "../../../hooks/useMyCreditScore.js";
import { useMySubscription } from "../../../hooks/useMySubscription.js";
import { useMyHeroSubmission } from "../../../hooks/useMyHeroSubmission.js";
import { useOwnerReviews } from "../../../hooks/useOwnerReviews.js";
import { useBusinessProfile } from "../../../hooks/useBusinessProfile.js";
import { D, glassCard, LISTING_STATUS_META, CREDIT_FACTOR_META, getScoreColor, ghs } from "../theme.js";
import KpiCard from "../charts/KpiCard.jsx";
import ChartFrame from "../charts/ChartFrame.jsx";
import SpendAreaChart from "../charts/SpendAreaChart.jsx";
import ListingsDonut from "../charts/ListingsDonut.jsx";
import CreditRadialGauge from "../charts/CreditRadialGauge.jsx";
import FactorBars from "../charts/FactorBars.jsx";
import UsageMeters from "../charts/UsageMeters.jsx";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Build the last-6-months [{month, amount}] spend series from the owner's
// transactions. Only `success` transactions count. Bucketed by created_at's
// YYYY-MM. NOTE: these are payments the owner MADE to AshantiHub (subscriptions
// + promotions) — not sales income (owners have no transaction row for sales),
// hence "spend", not "revenue".
function buildSpendSeries(transactions, now) {
  const buckets = [];
  const index = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = { key, month: MONTH_LABELS[d.getMonth()], amount: 0 };
    buckets.push(row);
    index[key] = row;
  }
  for (const t of transactions || []) {
    if (t.status !== "success" || !t.created_at) continue;
    const key = String(t.created_at).slice(0, 7);
    if (index[key]) index[key].amount += Number(t.amount) || 0;
  }
  return buckets;
}

export default function AnalyticsPanel({ user }) {
  const now = new Date();
  const { data: listings } = useMyListings();
  const { data: transactions } = useMyTransactions();
  const { data: scoreData } = useMyCreditScore();
  const { data: subscription } = useMySubscription();
  const { data: heroSubmission } = useMyHeroSubmission();
  const { data: reviews } = useOwnerReviews(user?.id);
  const { data: profile } = useBusinessProfile();

  const listingList = listings || [];
  const statusCounts = listingList.reduce((acc, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {});
  const publishedCount = statusCounts.published || 0;

  const donutData = Object.entries(LISTING_STATUS_META).map(([key, meta]) => ({
    name: meta.label, value: statusCounts[key] || 0, color: meta.color,
  }));

  const spendSeries = buildSpendSeries(transactions, now);
  const totalSpend = spendSeries.reduce((s, r) => s + r.amount, 0);

  const score = scoreData?.score ?? null;
  const factorRows = Object.entries(scoreData?.factors || {}).map(([key, f]) => ({
    label: (CREDIT_FACTOR_META[key]?.label) || key,
    pct: Number(f.score_pct) || 0,
    color: score != null ? getScoreColor(score) : D.gold,
  }));

  // Subscription KPI + entitlement usage
  const sub = subscription?.id ? subscription : null;
  const daysLeft = sub?.current_period_end
    ? Math.max(0, Math.ceil((new Date(sub.current_period_end) - now) / 86400000))
    : null;
  const planEnt = sub?.plan || {};
  const heroActive = heroSubmission?.status === "approved" || heroSubmission?.status === "pending";
  const usageData = sub ? [
    { label: "Active listings", used: publishedCount, limit: planEnt.max_active_listings ?? null, unit: "", color: D.gold },
    { label: "Hero spotlight", used: heroActive ? 1 : 0, limit: 1, unit: "slot", color: D.blue },
    planEnt.hero_days != null ? { label: "Hero days / cycle", used: heroSubmission?.extended_days || 0, limit: planEnt.hero_days, unit: "days", color: D.purple } : null,
  ].filter(Boolean) : [];

  const reviewCount = reviews?.review_count ?? 0;
  const avgRating = reviews?.avg_rating;

  const kpis = [
    { icon: "📦", label: "Active Listings", value: publishedCount, accent: D.gold, sub: `${listingList.length} total`, trend: statusCounts.pending_review ? `${statusCounts.pending_review} pending` : null },
    { icon: "⭐", label: "Business Rating", value: reviewCount > 0 ? `${Number(avgRating).toFixed(1)}★` : "—", accent: D.amber, sub: reviewCount > 0 ? `${reviewCount} review${reviewCount === 1 ? "" : "s"}` : "No reviews yet" },
    { icon: "🏅", label: "Credit Score", value: score != null ? score : "—", accent: score != null ? getScoreColor(score) : D.textDim, sub: scoreData?.grade ? `Grade ${scoreData.grade}` : "Not scored yet" },
    { icon: "💳", label: "Subscription", value: sub ? (sub.plan?.name || "Active") : "None", accent: D.green, sub: sub ? (daysLeft != null ? `Renews in ${daysLeft}d` : sub.status) : "No active plan" },
  ];

  const firstName = user?.fullName?.split(" ")[0] || "there";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Welcome strip */}
      <div style={{
        ...glassCard,
        padding: "18px 20px",
        background: "linear-gradient(135deg, rgba(23,31,51,0.92), rgba(30,24,55,0.85))",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <div style={{ color: D.gold, fontWeight: 900, fontSize: "1.12rem", marginBottom: 3 }}>Akwaaba, {firstName}! 👋</div>
          <div style={{ fontSize: "0.74rem", color: D.textDim }}>
            {profile?.gps_address ? `📍 ${profile.gps_address}` : "Your business at a glance"}
            {profile?.business_contact_phone ? ` • ${profile.business_contact_phone}` : ""}
          </div>
          <div style={{ fontSize: "0.68rem", color: D.textFaint, marginTop: 6 }}>
            {sub ? `💳 ${sub.plan?.name} plan • ${sub.status}${daysLeft != null ? ` • renews in ${daysLeft} days` : ""}` : "💳 No active subscription yet — see the Subscription tab"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.62rem", color: D.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>Spend last 6 months</div>
          <div style={{ fontWeight: 900, fontSize: "1.35rem", color: D.text }}>{ghs(totalSpend)}</div>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(178px,1fr))", gap: 12 }}>
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* Spend + listings breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
        <ChartFrame title="Your AshantiHub spend" icon="💸" aside={<span style={{ fontSize: "0.62rem", color: D.textFaint }}>subscriptions &amp; promotions</span>}>
          <SpendAreaChart data={spendSeries} />
        </ChartFrame>
        <ChartFrame title="Listings by status" icon="📦">
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <ListingsDonut data={donutData} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", justifyContent: "center", marginTop: 8 }}>
              {donutData.filter((d) => d.value > 0).map((d) => (
                <span key={d.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.64rem", color: D.textDim }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />{d.name} ({d.value})
                </span>
              ))}
            </div>
          </div>
        </ChartFrame>
      </div>

      {/* Credit gauge + factors */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
        <ChartFrame title="Credit score" icon="🏅">
          <CreditRadialGauge score={score} />
        </ChartFrame>
        <ChartFrame title="What drives your score" icon="⚙️">
          <FactorBars data={factorRows} />
        </ChartFrame>
      </div>

      {/* Plan usage */}
      <ChartFrame title="Plan usage" icon="📊" minHeight={90}>
        <UsageMeters data={usageData} />
      </ChartFrame>
    </div>
  );
}
