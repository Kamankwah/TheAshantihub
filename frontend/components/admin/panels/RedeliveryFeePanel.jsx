import { useQueryClient } from "@tanstack/react-query";
import { useMoneySettings } from "../../../hooks/useMoneyRules.js";
import { D } from "../theme.js";
import { SettingRow } from "./MoneyRulesPanel.jsx";
import { callout, dim } from "./panelStyles.js";
import { card, errorStyle, h2 } from "./portfolioParts.jsx";

// Operations > Settings > Re-delivery fee (Director ruling 1, 2026-10-20). The flat fee a customer pays to have an order
// delivered again after they were not available. GET /api/ledger/settings/ answers only this setting to a holder of
// redelivery_fee.manage; saving proposes the change, which another Operations lead or a Super Admin approves (the
// server decides and the page says which happened). Requests already made keep the fee they were given.
const KEY = "redelivery_fee_pesewas";

export default function RedeliveryFeePanel() {
  const queryClient = useQueryClient();
  const settings = useMoneySettings();

  if (settings.isLoading) return <div style={dim}>Loading…</div>;
  const fee = settings.data?.settings?.find((s) => s.key === KEY);
  if (settings.isError || !fee) return <div role="alert" style={errorStyle}>Could not load the re-delivery fee.</div>;

  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["ledger"] }); };
  const pending = (settings.data.pending || []).filter((p) => p.key === KEY);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section aria-label="Re-delivery fee" style={card}>
        <h2 style={h2}>Re-delivery fee</h2>
        <div role="note" style={{ ...callout(D.panelBg2), fontWeight: 500, lineHeight: 1.5 }}>
          What a customer pays to have an order delivered again after the rider reached them and they did not answer or
          refused it. Your change waits until another Operations lead or a Super Admin approves it, and is recorded in the
          audit log. Re-deliveries already asked for keep the fee they were given.
        </div>
        <SettingRow key={`${fee.key}:${fee.value}`} setting={fee} pending={pending} onSaved={refresh} />
      </section>
    </div>
  );
}
