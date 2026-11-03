import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { formatCedis } from "../../ui/Price";
import { Pill } from "../../ui/Pill";
import { PayChoice } from "../pay/PayChoice";
import { postPayment } from "../pay/settle";
import { usePayChoice } from "../pay/usePayChoice";
import { MoneyBar } from "./MoneyBar";
import { BOOKING_STATUS, type Booking, REQUEST_STATUS, type ServiceRequest } from "./queries";
import { ReportForm } from "./ReportForm";
import { formatAccra, moneyLines } from "./terms";

function Card({ children }: { children: React.ReactNode }) {
  const { c, radius } = useTheme();
  return <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, padding: 16, gap: 10 }}>{children}</View>;
}

function useRefresh(keys: string[]) {
  const qc = useQueryClient();
  return () => {
    for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** A stay: dates, status, and either the money panel (ledger on) or a plain cancel with its honest no-refund note (ledger off). */
export function StayRow({ b }: { b: Booking }) {
  const { c } = useTheme();
  const refresh = useRefresh(["my-bookings", "wallet"]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancellable = b.status === "confirmed" || b.status === "pending";
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/bookings/${b.id}/cancel/`, { body: {} });
      setAsking(false);
      refresh();
    } catch (e) {
      setError(apiMessage(e, "We couldn’t cancel. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{b.listing_name}</Text>
        <Pill tone={b.status === "cancelled" ? "error" : b.status === "pending" ? "warn" : "neutral"} icon={b.status === "cancelled" ? "x-circle" : b.status === "pending" ? "clock" : "check-circle"} label={BOOKING_STATUS[b.status] ?? b.status} />
      </View>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`${b.check_in} to ${b.check_out} · ${b.nights} ${b.nights === 1 ? "night" : "nights"} · ${b.units} ${b.units === 1 ? "unit" : "units"} · ${formatCedis(b.total_price)}`}</Text>
      {b.money ? (
        <MoneyBar kind="stay" money={b.money} cancelPath={`/api/bookings/${b.id}/cancel/`} about={b.listing_name} onChanged={refresh} />
      ) : cancellable ? (
        asking ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Cancel this booking?</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>This cancels your booking and frees the dates.</Text>
            {b.paid_at ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>No refund is made in the app. Contact AshantiHub Support about your payment.</Text> : null}
            {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
            <Button variant="destructive" label="Yes, cancel booking" onPress={cancel} loading={busy} />
            <Button variant="secondary" label="Keep it" onPress={() => setAsking(false)} disabled={busy} />
          </View>
        ) : (
          <Button variant="secondary" label="Cancel booking" onPress={() => setAsking(true)} />
        )
      ) : null}
    </Card>
  );
}

function QuotePay({ r }: { r: ServiceRequest }) {
  const { c } = useTheme();
  const refresh = useRefresh(["my-requests", "wallet"]);
  const choice = usePayChoice({ amount: r.agreed_price ?? "0" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; stop.current = true; }, []);
  async function pay() {
    setBusy(true);
    setError(null);
    stop.current = false;
    try {
      const res = await postPayment<ServiceRequest>(`/api/services/requests/${r.id}/pay/`, { ...choice.body }, () => stop.current);
      if (!mounted.current) return;
      if (res.status === "failed") setError("The payment didn’t go through. Nothing was charged for this service. Try again.");
      else if (res.status === "timeout") setError("We’re still waiting for your payment. Check back in a few minutes before paying again.");
      refresh();
    } catch (e) {
      if (mounted.current) setError(apiMessage(e, "We couldn’t take the payment. Try again."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.price, fontFamily: fonts.bodyBold, fontSize: 18, fontVariant: ["tabular-nums"] }}>{`Quote: ${formatCedis(r.agreed_price ?? 0)}`}</Text>
      <PayChoice choice={choice} />
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      <Button label={`Pay for ${r.listing_name}`} onPress={pay} loading={busy} disabled={!choice.ready || r.agreed_price == null} />
    </View>
  );
}

function Finished({ r }: { r: ServiceRequest }) {
  const { c } = useTheme();
  const refresh = useRefresh(["my-requests", "wallet"]);
  const [report, setReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = r.money;
  const problem = money?.problem ?? (r.problem_reported ? "open" : null);
  const canReport = problem !== "closed" && (money ? money.can_report : true);
  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/services/requests/${r.id}/accept/`, { body: {} });
      refresh();
    } catch (e) {
      setError(apiMessage(e, "We couldn’t do that. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  }
  if (r.settled) return null;
  if (problem === "open") return <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>Problem reported. Support is looking into it, and the payment to the business is on hold until it is settled.</Text>;
  const dim = { color: c.dim, fontFamily: fonts.body, fontSize: 13 } as const;
  return (
    <View style={{ gap: 8 }}>
      {money?.refunded ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{moneyLines({ ...money, release_at: null }, "service")[0]}</Text> : null}
      {problem === "closed" ? <Text style={dim}>Support has settled the problem you reported.</Text> : null}
      {r.auto_accept_at ? <Text style={dim}>{`Accepts automatically on ${formatAccra(new Date(r.auto_accept_at))}${canReport ? " unless you report a problem" : ""}.`}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {report ? (
        <ReportForm path={`/api/services/requests/${r.id}/report-problem/`} onDone={() => { setReport(false); refresh(); }} onBack={() => setReport(false)} />
      ) : (
        <View style={{ gap: 8 }}>
          <Button label="Accept service" onPress={accept} loading={busy} />
          {canReport ? <Button variant="secondary" label="Report a problem" onPress={() => setReport(true)} disabled={busy} /> : null}
        </View>
      )}
    </View>
  );
}

/** A service request, from "waiting for the business" through quote, payment, work and acceptance. */
export function RequestRow({ r }: { r: ServiceRequest }) {
  const { c } = useTheme();
  const refresh = useRefresh(["my-requests", "wallet"]);
  const money = r.money;
  const settledText = money && (money.released_at || money.refunded_whole || money.cancelled_by_you);
  const dim = { color: c.dim, fontFamily: fonts.body, fontSize: 14 } as const;
  let action: React.ReactNode = null;
  if (settledText) {
    action = (
      <View style={{ gap: 6 }}>
        {moneyLines(money, "service").map((l) => <Text key={l} style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{l}</Text>)}
        {money!.released_at ? <Button variant="secondary" label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about: r.listing_name } } as never)} /> : null}
      </View>
    );
  } else if (r.status === "requested") action = <Text style={dim}>Waiting for the business to reply. AshantiHub will tell you when they do.</Text>;
  else if (r.status === "declined") action = r.decline_reason ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>{r.decline_reason}</Text> : <Text style={dim}>The business can’t take this request.</Text>;
  else if (r.status === "accepted") action = <QuotePay r={r} />;
  else if (r.status === "in_progress" && money?.can_cancel) {
    action = (
      <View style={{ gap: 8 }}>
        {r.progress_note ? <Text style={dim}>{r.progress_note}</Text> : null}
        <MoneyBar kind="service" money={money} cancelPath={`/api/services/requests/${r.id}/cancel/`} about={r.listing_name} actions={["cancel"]} onChanged={refresh} />
      </View>
    );
  } else if (r.status === "in_progress") action = <Text style={dim}>{r.progress_note || "The business is working on it."}</Text>;
  else if (r.status === "completed") action = <Finished r={r} />;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{r.listing_name}</Text>
        <Pill tone={r.status === "declined" || r.status === "cancelled" ? "error" : r.status === "requested" || r.status === "accepted" ? "warn" : "neutral"} icon={r.status === "declined" || r.status === "cancelled" ? "x-circle" : r.status === "requested" || r.status === "accepted" ? "clock" : "check-circle"} label={REQUEST_STATUS[r.status] ?? r.status} />
      </View>
      <Text numberOfLines={2} style={dim}>{r.message}</Text>
      {action}
    </Card>
  );
}
