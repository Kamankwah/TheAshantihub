import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { formatCedis } from "../../ui/Price";
import { useBookingTerms } from "../seller/queries";
import { ReportForm } from "./ReportForm";
import { type BookingKind, type Money, moneyLines, policyLines } from "./terms";

const PAYEE: Record<BookingKind, string> = { service: "business", stay: "host", tickets: "organiser" };
const NOUN: Record<BookingKind, string> = { service: "service", stay: "booking", tickets: "tickets" };

type Props = {
  kind: BookingKind;
  money: Money | null | undefined;
  /** POST here to cancel. */
  cancelPath: string;
  about: string;
  ticketCount?: number;
  /** Where "Report a problem" posts; the ledger's booking report unless the thing has its own (a service request). */
  reportPath?: string;
  /** Which controls to offer; both unless the caller shows its own (a finished service has Accept instead). */
  actions?: ("cancel" | "report")[];
  onChanged?: () => void;
};

/**
 * The money panel under a paid booking, ticket or service: when the business is paid, what a cancel would refund
 * (the server's own quote), Cancel and Report a problem. Every amount and time is the server's.
 */
export function MoneyBar({ kind, money, cancelPath, about, ticketCount = 1, reportPath, actions = ["cancel", "report"], onChanged }: Props) {
  const { c, radius } = useTheme();
  const terms = useBookingTerms();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<null | "cancel" | "report">(null);
  const [result, setResult] = useState<{ text: string; signature: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const quote = useQuery({
    queryKey: ["cancel-quote", money?.sale],
    enabled: panel === "cancel" && !!money,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: () => api<{ refund: string; whole: boolean }>(`/api/ledger/bookings/${money!.sale}/cancel-quote/`),
  });

  if (!money || terms.data?.enabled === false) return null;
  const P = PAYEE[kind];
  const signature = JSON.stringify(money);
  const showResult = result && result.signature === signature;
  const pending = !!money.policy && !money.released_at && !money.refunded && !money.problem;
  const label = pending ? terms.data?.policies?.[money.policy?.policy ?? ""]?.label ?? null : null;
  const released = !!money.released_at;

  const finish = (text: string) => {
    setPanel(null);
    setResult({ text, signature });
    void qc.invalidateQueries({ queryKey: ["wallet"] });
    onChanged?.();
  };
  async function cancel() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ wallet_refund?: string }>(cancelPath, { body: {} });
      finish(body?.wallet_refund ? `Cancelled. ${formatCedis(body.wallet_refund)} went back to your AshantiHub wallet.` : "Cancelled.");
    } catch (e) {
      setError(apiMessage(e, "We couldn’t cancel. Nothing was changed."));
      inFlight.current = false;
    } finally {
      setBusy(false);
    }
  }
  const line = { color: c.dim, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 } as const;
  const strong = { color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 20 } as const;
  const policy = money.policy;
  return (
    <View style={{ backgroundColor: c.well, borderRadius: radius.control, padding: 14, gap: 8 }}>
      {showResult ? (
        <Text accessibilityLiveRegion="polite" style={strong}>{result.text}</Text>
      ) : (
        <>
          <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
            {moneyLines(money, kind).map((l) => <Text key={l} style={strong}>{l}</Text>)}
          </View>
          {pending ? (
            <View style={{ gap: 2 }}>
              {money.start != null && policy?.text ? <Text style={line}>{label ? `${label}: ${policy.text}` : policy.text}</Text> : null}
              {policyLines(money).map((l) => <Text key={l} style={line}>{l}</Text>)}
            </View>
          ) : null}
          {released ? <Text style={line}>If something is wrong, contact AshantiHub Support.</Text> : null}
          {panel === "cancel" ? (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={strong}>{kind === "tickets" ? (ticketCount === 1 ? "Cancel this ticket?" : `Cancel all ${ticketCount} tickets in this purchase?`) : `Cancel this ${NOUN[kind]}?`}</Text>
              {quote.isError ? (
                <Text accessibilityRole="alert" style={{ ...line, color: c.red }}>{apiMessage(quote.error, "We couldn’t check what you get back. Try again.")}</Text>
              ) : quote.data ? (
                <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
                  <Text style={line}>{`${formatCedis(quote.data.refund)} goes back to your AshantiHub wallet.`}</Text>
                  {!quote.data.whole ? <Text style={line}>{`The ${P} keeps the rest under this policy.`}</Text> : null}
                </View>
              ) : (
                <Text style={line}>Checking what you get back…</Text>
              )}
              {error ? <Text accessibilityRole="alert" style={{ ...line, color: c.red }}>{error}</Text> : null}
              <Button variant="destructive" label={`Yes, cancel ${NOUN[kind]}`} onPress={cancel} loading={busy} disabled={!quote.data} />
              <Button variant="secondary" label={`Keep my ${NOUN[kind] === "tickets" ? "tickets" : NOUN[kind]}`} onPress={() => setPanel(null)} disabled={busy} />
            </View>
          ) : null}
          {panel === "report" ? (
            <ReportForm
              path={reportPath ?? `/api/ledger/bookings/${money.sale}/report-problem/`}
              onDone={() => finish(`Problem reported. AshantiHub Support has been told, and the payment to the ${P} is on hold until it is settled.`)}
              onBack={() => setPanel(null)}
            />
          ) : null}
          {!panel ? (
            <View style={{ gap: 8 }}>
              {money.can_cancel && actions.includes("cancel") ? <Button variant="secondary" label={kind === "tickets" ? "Cancel tickets" : `Cancel ${NOUN[kind]}`} onPress={() => { setError(null); inFlight.current = false; setPanel("cancel"); }} /> : null}
              {money.can_report && actions.includes("report") ? <Button variant="secondary" label="Report a problem" onPress={() => { setError(null); inFlight.current = false; setPanel("report"); }} /> : null}
              {released ? <Button variant="secondary" label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about } } as never)} /> : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
