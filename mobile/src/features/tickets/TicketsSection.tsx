import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { apiMessage } from "../../lib/errors";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { formatCedis } from "../../ui/Price";
import { Skeleton } from "../../ui/Skeleton";
import { Stepper } from "../../ui/Stepper";
import { useCanBuy } from "../listing/queries";
import { PayChoice } from "../pay/PayChoice";
import { postPayment } from "../pay/settle";
import { TicketTermsNote } from "../pay/BookingTermsNote";
import { usePayChoice } from "../pay/usePayChoice";
import { useBookingTerms } from "../seller/queries";
import { TicketQr } from "./TicketQr";
import { type Ticket, type TicketType, useTicketTypes } from "./queries";

type EventLike = { id: number; name: string; event_date: string | null; has_tickets?: boolean; refund_until_days_before?: number | null; organizer?: { kind?: string } | string | null };

function Buying({ event, type, onClose }: { event: EventLike; type: TicketType; onClose: () => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const max = Math.max(1, Math.min(10, type.quantity_remaining ?? 10));
  const [quantity, setQuantity] = useState(1);
  const total = (Number(type.price) * quantity).toFixed(2);
  const inLedger = typeof event.organizer === "object" && event.organizer?.kind === "business";
  const choice = usePayChoice({ amount: total, inLedger });
  const terms = useBookingTerms();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState<Ticket[] | null>(null);
  const stop = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; stop.current = true; }, []);

  async function buy() {
    setBusy(true);
    setError(null);
    stop.current = false;
    try {
      const res = await postPayment<Ticket[]>(`/api/events/${event.id}/tickets/purchase/`, { ticket_type: type.id, quantity, ...choice.body }, () => stop.current);
      if (!mounted.current) return;
      void qc.invalidateQueries({ queryKey: ["ticket-types"] });
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      void qc.invalidateQueries({ queryKey: ["wallet"] });
      if (res.status === "immediate") setBought(Array.isArray(res.body) ? res.body : []);
      else if (res.status === "paid") router.replace("/tickets" as never);
      else if (res.status === "failed") setError("The payment didn’t go through. You haven’t been charged for tickets. Try again.");
      else if (res.status === "timeout") setError("We’re still waiting for your payment. Check My tickets in a few minutes before paying again.");
    } catch (e) {
      if (mounted.current) setError(apiMessage(e, "We couldn’t buy the tickets. Try again."));
    } finally {
      if (mounted.current) { setBusy(false); setWaiting(false); }
    }
  }

  if (bought) {
    return (
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 22 }}>{bought.length === 1 ? "Your ticket" : "Your tickets"}</Text>
        {bought.map((t) => (
          <View key={t.id} style={{ gap: 6, alignItems: "flex-start" }}>
            <Text selectable style={{ color: c.ink, fontFamily: fonts.mono, fontSize: 18 }}>{t.code}</Text>
            <TicketQr code={t.code} size={180} />
          </View>
        ))}
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Show the QR at the gate. You can find all your tickets under My tickets.</Text>
        <Button label="Open My tickets" onPress={() => router.push("/tickets" as never)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 14, backgroundColor: c.well, borderRadius: 12, padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{`${type.name}, ${formatCedis(type.price)} each`}</Text>
        <Stepper label="ticket" value={quantity} min={1} max={max} onChange={setQuantity} disabled={busy} />
      </View>
      <Text style={{ color: c.price, fontFamily: fonts.bodyBold, fontSize: 18, fontVariant: ["tabular-nums"] }}>{`Total ${formatCedis(total)}`}</Text>
      <TicketTermsNote terms={terms.data} refundDays={event.refund_until_days_before} eventDate={event.event_date} />
      <PayChoice choice={choice} />
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {waiting ? <Text accessibilityLiveRegion="polite" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Waiting for your payment…</Text> : null}
      <Button label="Buy tickets" onPress={() => { setWaiting(true); void buy(); }} loading={busy} disabled={!choice.ready} />
      <Button variant="secondary" label="Not now" onPress={onClose} disabled={busy} />
    </View>
  );
}

/** The ticket types of an event and the buy flow: pick a type and quantity, see the terms, pay by Mobile Money or wallet. */
export function TicketsSection({ event }: { event: EventLike }) {
  const { c } = useTheme();
  const signedIn = useAuth((s) => s.status === "signedIn");
  const type = useAuth((s) => s.account?.type);
  const { canBuy, message } = useCanBuy();
  const q = useTicketTypes(String(event.id), !!event.has_tickets);
  const [selected, setSelected] = useState<number | null>(null);
  if (!event.has_tickets) return null;
  if (q.isLoading) return <Skeleton height={80} />;
  if (q.isError) return <EmptyState title="We couldn’t load the tickets" action={{ label: "Try again", onPress: () => void q.refetch() }} />;
  const types = q.data ?? [];
  if (types.length === 0) return null;
  const isCustomer = signedIn && type === "customer";
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 22 }}>Tickets</Text>
      {!signedIn ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>Sign in as a customer to buy tickets.</Text> : null}
      {signedIn && !isCustomer ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>Only customer accounts can buy tickets.</Text> : null}
      {isCustomer && !canBuy && message ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{message}</Text> : null}
      {types.map((t) => {
        const soldOut = t.quantity_remaining === 0;
        const open = selected === t.id;
        return (
          <View key={t.id} style={{ gap: 10, borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 14, backgroundColor: c.surface }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{t.name}</Text>
                {t.description ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{t.description}</Text> : null}
                {t.quantity_remaining != null && !soldOut ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Only ${t.quantity_remaining} left`}</Text> : null}
                {soldOut ? <Text style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>Sold out</Text> : null}
              </View>
              <Text style={{ color: c.price, fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ["tabular-nums"] }}>{formatCedis(t.price)}</Text>
            </View>
            {isCustomer && !soldOut && !open ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Buy ${t.name} tickets`}
                accessibilityState={{ disabled: !canBuy }}
                disabled={!canBuy}
                onPress={() => setSelected(t.id)}
                style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center", opacity: canBuy ? 1 : 0.5 }}
              >
                <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Buy tickets</Text>
              </Pressable>
            ) : null}
            {open ? <Buying event={event} type={t} onClose={() => setSelected(null)} /> : null}
          </View>
        );
      })}
    </View>
  );
}
