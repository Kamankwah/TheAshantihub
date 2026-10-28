import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { D, tint } from "./dashboard/theme.js";
import { apiPost } from "../apiClient.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { formatAccra } from "../lib/bookingTerms.js";
import { moneyLines } from "./bookings/bookingMoney.js";
import CancelBookingDialog from "./bookings/CancelBookingDialog.jsx";
import ReportProblemForm from "./bookings/ReportProblemForm.jsx";

// ─── ServiceAcceptBar ───────────────────────────────────────────────────────
// Under a paid service on the customer's Account → Requests tab (ledger Plans 7E and 7G). While the job is in progress
// the customer can cancel it (the server says when: `money.can_cancel`). Once the business has marked it done the
// customer can accept it now (the business is paid at once) or report a problem (Support settles it and the automatic
// release stops). After a release or refund the bar states what happened, from the server's `money` block. Without
// `money` (ledger off) it behaves exactly as it did before 7G.
const pill = (bg, color) => ({ background: bg, color, border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" });
const lineStyle = { color: D.text, fontSize: "0.76rem", fontVariantNumeric: "tabular-nums" };

// The wallet query client is only read when there is a money block, so the legacy bar needs no query provider.
export default function ServiceAcceptBar(props) {
  return props.request.money ? <MoneyAwareBar {...props} /> : <Bar {...props} />;
}

function MoneyAwareBar(props) {
  const queryClient = useQueryClient();
  return <Bar {...props} onWalletChanged={() => queryClient.invalidateQueries({ queryKey: ["wallet"] })} />;
}

function Bar({ request, onChanged, onContactSupport, onWalletChanged }) {
  const [panel, setPanel] = useState(null); // null | "cancel" | "report"
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [result, setResult] = useState(null);

  const money = request.money;
  const problem = money?.problem ?? (request.problem_reported ? "open" : null);
  const signature = JSON.stringify({ status: request.status, money });
  const changed = () => { onWalletChanged?.(); onChanged(); };

  const accept = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/services/requests/${request.id}/accept/`, {});
      changed();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not do that. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  };

  const errorLine = actionError && <div role="alert" style={{ color: D.red, fontSize: "0.74rem" }}>{actionError}</div>;

  // The local confirmation shows only while the server's state is unchanged; once the refetched request differs, the
  // server-driven lines below take over.
  if (result && result.signature === signature) return <div role="status" style={{ ...lineStyle, marginTop: 10 }}>{result.message}</div>;

  // Settled by release or refund: say what happened.
  if (money && (money.released_at || money.refunded)) {
    return (
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {moneyLines(money, "service").map((l) => <div key={l} style={lineStyle}>{l}</div>)}
        </div>
        {money.released_at && onContactSupport && (
          <div>
            <button type="button" onClick={() => onContactSupport({ name: request.listing_name })} style={pill(D.panelBg2, D.text)}>Contact AshantiHub Support</button>
          </div>
        )}
      </div>
    );
  }

  if (request.status === "in_progress" && money?.can_cancel) {
    return (
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {panel === "cancel" ? (
          <CancelBookingDialog
            kind="service" money={money} cancelPath={`/api/services/requests/${request.id}/cancel/`}
            onDone={({ refunded }) => {
              setPanel(null);
              setResult({ signature, message: refunded ? `Cancelled. GH₵ ${refunded} went back to your AshantiHub wallet.` : "Cancelled." });
              changed();
            }}
            onClose={() => setPanel(null)}
          />
        ) : (
          <div><button type="button" onClick={() => setPanel("cancel")} style={pill(tint(D.red, "22"), D.red)}>Cancel service</button></div>
        )}
      </div>
    );
  }

  if (request.status !== "completed" || request.settled) return null;
  if (problem === "open") {
    return <div style={{ color: D.amber, fontSize: "0.74rem", fontWeight: 700, marginTop: 10 }}>Problem reported. Support is looking into it, and the payment to the business is on hold until it is settled.</div>;
  }

  const canReport = problem !== "closed" && (money ? money.can_report : true);

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      {problem === "closed" && <div role="status" style={lineStyle}>Support has settled the problem you reported.</div>}
      {request.auto_accept_at && (
        <div style={{ color: D.textDim, fontSize: "0.72rem" }}>
          Accepts automatically on {formatAccra(new Date(request.auto_accept_at))} unless you report a problem.
        </div>
      )}
      {panel !== "report" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={busy} onClick={accept} style={pill(D.green, "#fff")}>Accept service</button>
          {canReport && <button type="button" disabled={busy} onClick={() => setPanel("report")} style={pill(tint(D.red, "22"), D.red)}>Report a problem</button>}
        </div>
      )}
      {panel === "report" && (
        <ReportProblemForm
          path={`/api/services/requests/${request.id}/report-problem/`} idPrefix={`sr-${request.id}`}
          onDone={() => { setPanel(null); changed(); }}
          onBack={() => setPanel(null)}
        />
      )}
      {errorLine}
    </div>
  );
}
