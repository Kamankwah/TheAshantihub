import { useKYCQueue } from "../../../hooks/useKYCQueue.js";
import { useModerationQueue } from "../../../hooks/useModerationQueue.js";
import { useHeroModerationQueue } from "../../../hooks/useHeroModerationQueue.js";
import { useCustomers } from "../../../hooks/useCustomers.js";
import { useBusinessOwners } from "../../../hooks/useBusinessOwners.js";
import { useEscrowLedger } from "../../../hooks/useEscrowLedger.js";
import { useDisputesQueue } from "../../../hooks/useDisputesQueue.js";
import { D, ghs, kpiGrid } from "../theme.js";
import { DispatchOverview, DeliveryManagerOverview } from "./DeliveryOverview.jsx";
import KpiCard from "../../dashboard/charts/KpiCard.jsx";
import { RoleChip } from "../shell/StaffHeader.jsx";

// Overview tab — a real KPI dashboard (mirroring BusinessCommandCenter's
// AnalyticsPanel), replacing the old greeting-only content. Overview has no
// permission gate itself (every staff role sees it), but each KPI's backing
// endpoint IS permission-gated server-side — so each count hook is only
// called when the session actually holds the matching permission (same
// guarding principle AdminCommandCenter.jsx's nav already applies), and
// that KPI tile just isn't rendered when the session lacks it. This must
// never error/500 for e.g. a support-role session with no kyc.approve.
// `onNavigate(tabId)` is the shell's own tab switch (AdminCommandCenter's
// selectTab), threaded down as a prop so a section can open its full panel.
export default function OverviewPanel({ auth, roleColor, onNavigate }) {
  const canKyc = auth.hasPermission("kyc.approve");
  const canModeration = auth.hasPermission("listings.moderate");
  const canHero = auth.hasPermission("hero_media.approve");
  const canUsers = auth.hasPermission("users.view");
  const canEscrow = auth.hasPermission("escrow.view") || auth.hasPermission("escrow.release") || auth.hasPermission("escrow.refund");
  const canDisputes = auth.hasPermission("disputes.flag") || auth.hasPermission("disputes.resolve_financial");
  // The delivery sections mount (and so fetch) only with the permission
  // their endpoint enforces — the same one that shows the role's nav item.
  // Dispatch additionally needs the dispatch role: AssignDispatchView only
  // ever assigns role=dispatch staff, so a super_admin (who holds every
  // permission) would always get an empty section and a wasted request.
  const canDispatch = auth.user?.role === "dispatch" && auth.hasPermission("delivery.dispatch");
  const canDeliveryManage = auth.hasPermission("delivery.manage");

  // React hooks can't be called conditionally, but useQuery's own `enabled`
  // flag can be — every hook below is always called, its request just never
  // fires (and its data stays undefined) when the session lacks the
  // matching permission.
  const kyc = useKYCQueue({ enabled: canKyc });
  const moderation = useModerationQueue({ enabled: canModeration });
  const hero = useHeroModerationQueue({ enabled: canHero });
  const customers = useCustomers({ enabled: canUsers });
  const owners = useBusinessOwners({ enabled: canUsers });
  const escrowHeld = useEscrowLedger({ status: "held", enabled: canEscrow });
  const disputes = useDisputesQueue({ enabled: canDisputes });

  const escrowHeldTotal = canEscrow
    ? (escrowHeld.data?.results || []).reduce((sum, t) => sum + (Number(t.price) || 0), 0)
    : null;
  // The disputes queue now defaults to ?status=pending, which is exactly
  // open+investigating — so `count` (the total across every page) is the real
  // figure. This used to filter the first page client-side, silently capping
  // the KPI at the 20-row page size.
  const openDisputesCount = canDisputes ? (disputes.data?.count ?? 0) : null;

  const kpis = [
    canKyc && { icon: "🪪", label: "Pending KYC", value: (kyc.data || []).length, accent: D.amber },
    canModeration && { icon: "📋", label: "Pending Moderation", value: (moderation.data || []).length, accent: D.amber },
    canHero && { icon: "🌟", label: "Pending Hero", value: (hero.data || []).length, accent: D.amber },
    canUsers && { icon: "👥", label: "Customers", value: customers.data?.count ?? 0, accent: D.blue },
    canUsers && { icon: "🏪", label: "Business Owners", value: owners.data?.count ?? 0, accent: D.kente3 },
    canEscrow && { icon: "💰", label: "Escrow Held", value: ghs(escrowHeldTotal), accent: D.gold },
    canDisputes && { icon: "⚖️", label: "Open Disputes", value: openDisputesCount, accent: D.red },
  ].filter(Boolean);

  return (
    <div>
      <h2 style={{ color: D.text, fontWeight: 900, margin: "0 0 6px", fontSize: "1.1rem" }}>Akwaaba, {auth.user?.full_name?.split(" ")[0]}!</h2>
      <div style={{ color: D.textDim, fontSize: "0.8rem", marginBottom: 20 }}>
        {/* The role renders as the same chip as the header — as bare text in
            roleColor, gold/deep-gold/orange on cream were only 2.2–3.1:1. */}
        You're signed in as <RoleChip role={auth.user?.role} roleColor={roleColor} />.
      </div>

      {kpis.length > 0 && (
        <div style={{ ...kpiGrid, marginBottom: 20 }}>
          {kpis.map(k => <KpiCard key={k.label} {...k} />)}
        </div>
      )}

      {canDeliveryManage && <DeliveryManagerOverview onNavigate={onNavigate} />}
      {canDispatch && <DispatchOverview onNavigate={onNavigate} />}
    </div>
  );
}
