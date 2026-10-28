import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { D, tint } from "../dashboard/theme.js";
import { useBookingTerms } from "../../hooks/useBookingTerms.js";
import { moneyLines, payeeWord, policyLabel, policyLines } from "./bookingMoney.js";
import CancelBookingDialog from "./CancelBookingDialog.jsx";
import ReportProblemForm from "./ReportProblemForm.jsx";

// The customer's bar under a paid stay or ticket purchase: what happens to the money (the server's `money` block),
// the sale's own cancellation policy while it is pending, and the only actions the server allows. Never contacts the
// business: the single contact is AshantiHub Support.
const pill = (bg, color) => ({ background: bg, color, border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" });
const line = { color: D.textDim, fontSize: "0.74rem" };

export default function BookingMoneyBar({ kind, money, cancelPath, reportPath, about, ticketCount = 1, onChanged, onContactSupport }) {
  const terms = useBookingTerms();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState(null); // null | "cancel" | "report"
  const [result, setResult] = useState(null);

  if (!money || terms.data?.enabled === false) return null;

  const P = payeeWord(kind);
  const finish = (message) => {
    setPanel(null);
    setResult({ message, signature: JSON.stringify(money) });
    queryClient.invalidateQueries({ queryKey: ["wallet"] });
    onChanged?.();
  };

  // The local confirmation shows only while the parent still passes the money it had at finish; a refetch hands over
  // the server's new state, which then replaces the sentence.
  const showResult = result && result.signature === JSON.stringify(money);
  const pending = !!money.policy && !money.released_at && !money.refunded && !money.problem;
  const label = pending ? policyLabel(money.policy, terms.data) : null;
  const legacy = !money.policy && !money.released_at && !money.refunded_whole;
  const released = !!money.released_at;
  const contact = onContactSupport && (legacy || released) && (
    <button type="button" onClick={() => onContactSupport(about)} style={pill(D.panelBg2, D.text)}>Contact AshantiHub Support</button>
  );

  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: `1px solid ${D.cardBorder}`, background: D.panelBg2, display: "flex", flexDirection: "column", gap: 8 }}>
      {showResult ? (
        <div role="status" style={{ color: D.text, fontSize: "0.76rem", fontVariantNumeric: "tabular-nums" }}>{result.message}</div>
      ) : (
        <>
          <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {moneyLines(money, kind).map((l) => <div key={l} style={{ color: D.text, fontSize: "0.76rem", fontVariantNumeric: "tabular-nums" }}>{l}</div>)}
          </div>
          {pending && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {money.policy.text && <div style={line}>{label ? `${label}: ${money.policy.text}` : money.policy.text}</div>}
              {policyLines(money).map((l) => <div key={l} style={line}>{l}</div>)}
            </div>
          )}
          {legacy && <div style={line}>Only AshantiHub Support can cancel this booking.</div>}
          {released && <div style={line}>If something is wrong, contact AshantiHub Support.</div>}
          {panel === "cancel" && (
            <CancelBookingDialog
              kind={kind} money={money} cancelPath={cancelPath} ticketCount={ticketCount}
              onDone={({ refunded }) => finish(refunded ? `Cancelled. GH₵ ${refunded} went back to your AshantiHub wallet.` : "Cancelled.")}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "report" && (
            <ReportProblemForm
              path={reportPath} idPrefix={`bar-${money.sale}`}
              onDone={() => finish(`Problem reported. AshantiHub Support has been told, and the payment to the ${P} is on hold until it is settled.`)}
              onBack={() => setPanel(null)}
            />
          )}
          {!panel && (money.can_cancel || money.can_report || contact) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {money.can_cancel && <button type="button" onClick={() => setPanel("cancel")} style={pill(tint(D.red, "22"), D.red)}>{kind === "tickets" ? "Cancel tickets" : "Cancel booking"}</button>}
              {money.can_report && <button type="button" onClick={() => setPanel("report")} style={pill(D.panelBg2, D.text)}>Report a problem</button>}
              {contact}
            </div>
          )}
        </>
      )}
    </div>
  );
}
