import { C } from "../../theme.js";
import { starString } from "../ReviewComponents.jsx";
import { TABULAR } from "../storefront/storefrontType.js";

// The rating summary on the product page: the server's average, its rating
// count, and one bar per star with that star's share of the count. Every number
// comes from GET /api/reviews/listing/<id>/ (`avg_rating`, `review_count`,
// `distribution` over all published reviews). With no ratings, or no
// distribution sent, it draws nothing at all — never a 0.0 or empty bars.
export default function ReviewHistogram({ distribution, total, average }) {
  const count = Number(total) || 0;
  if (!distribution || count <= 0) return null;
  const rows = [5, 4, 3, 2, 1].map((star) => {
    const n = Number(distribution[String(star)]) || 0;
    return { star, pct: Math.round((n * 100) / count) };
  });
  const avg = average == null ? null : Number(average);

  return (
    <div data-testid="review-histogram" style={{ color: C.ink, maxWidth: 360 }}>
      {avg != null && !Number.isNaN(avg) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span aria-hidden="true" style={{ color: C.gold, fontSize: "1.05rem", letterSpacing: 1 }}>{starString(avg)}</span>
          <span style={{ fontWeight: 800, fontSize: "1rem", ...TABULAR }}>{avg.toFixed(1)} out of 5</span>
        </div>
      )}
      <div style={{ fontSize: "0.8rem", color: C.inkDim, marginBottom: 12, ...TABULAR }}>{count} {count === 1 ? "rating" : "ratings"}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {rows.map(({ star, pct }) => (
          <li key={star} style={{ display: "grid", gridTemplateColumns: "3.5rem minmax(0, 1fr) 2.75rem", alignItems: "center", gap: 10, fontSize: "0.8rem" }}>
            <span style={{ color: C.ink, fontWeight: 700, ...TABULAR }}>{star} star</span>{" "}
            <span aria-hidden="true" style={{ display: "block", height: 14, borderRadius: 7, background: C.surface3, border: `1px solid ${C.line}`, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: C.gold }} />
            </span>{" "}
            <span style={{ color: C.inkDim, textAlign: "right", ...TABULAR }}>{pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
