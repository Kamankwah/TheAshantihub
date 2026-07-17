import { D, glassCard } from "./theme.js";

// ─── Reusable Pending / Approved / Rejected sub-tab shell ─────────────────────
// The canonical three-state moderation-queue shell (staff moderation-queue
// restructuring) shared by KYCQueuePanel / ListingsModerationPanel /
// HeroApprovalPanel — and designed so the other moderated queues
// (Events/Plans/Reviews/Disputes) can reuse it verbatim.
//
// The panel owns its data: it passes one react-query result per tab in
// `queries` ({ pending, approved, rejected }) and a `renderRow(item, state)`
// function. This component owns only the sub-tab bar + the active tab's
// loading/error/empty/list chrome; each row's actual content + actions
// (approve/reject on Pending, approver name on Approved, reason + "Review
// Again" on Rejected) live in the panel's renderRow, branched on `state`.
//
// Query results may be unpaginated (a plain array in `.data`) or a paginated
// DRF envelope (`.data.results`) — both are normalized here so a paginated
// queue (e.g. reviews/escrow) can reuse this unchanged.
function itemsOf(query) {
  const data = query?.data;
  if (Array.isArray(data)) return data;
  return data?.results || [];
}

const TAB_ORDER = ["pending", "approved", "rejected"];
const DEFAULT_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

const fmtDate = (v) => (v ? String(v).slice(0, 10) : "");

// Shared "who actioned this" line for the Approved tab, and the rejection
// reason + "Review Again" affordance for the Rejected tab — identical across
// every moderated queue, so they live here rather than being re-copied into
// each panel's renderRow.
export function ApprovedByLine({ name, at, verb = "Approved" }) {
  return (
    <div style={{ color: D.green, fontSize: "0.68rem", fontWeight: 700, marginTop: 4 }}>
      ✓ {verb}{name ? ` by ${name}` : ""}{at ? ` • ${fmtDate(at)}` : ""}
    </div>
  );
}

export function RejectedReason({ reason }) {
  return (
    <div style={{ color: D.red, fontSize: "0.7rem", marginTop: 4 }}>
      ✕ Rejected{reason ? `: ${reason}` : ""}
    </div>
  );
}

export function ReviewAgainButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: D.goldSoft, color: D.deepGold, border: `1px solid ${D.cardBorder}`,
        borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer",
      }}
    >
      🔄 Review Again
    </button>
  );
}

export default function ModerationQueueTabs({
  tab,
  onTab,
  queries,
  renderRow,
  title,
  labels = {},
  emptyLabel = {},
}) {
  const resolvedLabels = { ...DEFAULT_LABELS, ...labels };
  const active = queries[tab];
  const items = itemsOf(active);

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      {title && (
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>{title}</div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {TAB_ORDER.map((key) => {
          const isActive = key === tab;
          // Show a count only for a tab whose data has actually loaded, so a
          // not-yet-fetched or errored tab doesn't render a misleading "0".
          const count = queries[key]?.data !== undefined ? itemsOf(queries[key]).length : null;
          return (
            <button
              key={key}
              onClick={() => onTab(key)}
              style={{
                background: isActive ? D.gold : D.panelBg2,
                color: isActive ? "#1a1205" : D.textDim,
                border: `1px solid ${isActive ? D.gold : D.cardBorder}`,
                borderRadius: 20,
                padding: "6px 16px",
                fontSize: "0.74rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {resolvedLabels[key]}{count != null ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {active?.isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {active?.isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load this queue.</div>}
      {active && !active.isLoading && !active.isError && items.length === 0 && (
        <div style={{ color: D.textDim, fontSize: "0.8rem" }}>
          {emptyLabel[tab] || `No ${resolvedLabels[tab].toLowerCase()} items.`}
        </div>
      )}
      {active && !active.isLoading && !active.isError &&
        items.map((item, index) => (
          <div key={item.id}>{renderRow(item, tab, index, items)}</div>
        ))}
    </div>
  );
}
