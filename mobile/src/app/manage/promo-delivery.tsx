import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useMyListings } from "../../features/business/queries";
import { buildDeliveryPromoBody, canSendDeliveryPromo, type DeliveryPromo, type DeliveryPromoForm, promoStatus, useDeliveryPromos, whenText } from "../../features/business/promotions";
import { addDays, DateField, isoDay } from "../../features/seller/DateField";
import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { BackButton } from "../../ui/BackButton";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Field } from "../../ui/Field";
import { ChoiceRow } from "../../ui/PickerRow";
import { Pill } from "../../ui/Pill";
import { formatCedis } from "../../ui/Price";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";

function NewPromo({ onDone }: { onDone: () => void }) {
  const { c } = useTheme();
  const listings = useMyListings();
  const published = (listings.data ?? []).filter((l) => l.status === "published");
  const tomorrow = isoDay(addDays(new Date(), 1));
  const [f, setF] = useState<DeliveryPromoForm>({ name: "", startDate: tomorrow, startTime: "08:00", endDate: isoDay(addDays(new Date(), 2)), endTime: "20:00", allItems: true, picked: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DeliveryPromoForm>(k: K, v: DeliveryPromoForm[K]) => setF((x) => ({ ...x, [k]: v }));
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/marketing/owner/delivery-promos/", { body: buildDeliveryPromoBody(f) });
      onDone();
    } catch (e) {
      setError(apiMessage(e, "We couldn’t send the promo."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 14 }}>
      <Field label="Promo name" value={f.name} onChangeText={(v) => set("name", v)} maxLength={120} helper="For example: Free delivery weekend." />
      <DateField label="Starts on" value={new Date(`${f.startDate}T00:00:00`)} minimum={new Date()} onChange={(d) => set("startDate", isoDay(d))} />
      <Field label="Start time (24-hour, like 08:00)" value={f.startTime} onChangeText={(v) => set("startTime", v)} keyboardType="numbers-and-punctuation" />
      <DateField label="Ends on" value={new Date(`${f.endDate}T00:00:00`)} minimum={new Date()} onChange={(d) => set("endDate", isoDay(d))} />
      <Field label="End time (24-hour, like 20:00)" value={f.endTime} onChangeText={(v) => set("endTime", v)} keyboardType="numbers-and-punctuation" />
      <ChoiceRow label="Which items" value={f.allItems ? "all" : "some"} onChange={(v) => set("allItems", v === "all")} options={[{ value: "all", label: "All my items" }, { value: "some", label: "Only the items I choose" }]} />
      {!f.allItems ? (
        published.length === 0 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>You have no published items yet.</Text> : published.map((l) => {
          const on = f.picked.includes(l.id);
          return (
            <Pressable
              key={l.id}
              accessibilityRole="checkbox"
              accessibilityLabel={l.name}
              accessibilityState={{ checked: on }}
              onPress={() => set("picked", on ? f.picked.filter((x) => x !== l.id) : [...f.picked, l.id])}
              style={{ minHeight: 48, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: on ? c.ink : c.line, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: "center" }}
            >
              <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>{l.name}</Text>
            </Pressable>
          );
        })
      ) : null}
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>
        Delivery is free only when everything in the customer’s order is from your business and covered by this promo. You cover the delivery fee. Each waived fee is recorded as a charge against your business for that order, and reversed if the order is cancelled, its payment fails or it is fully refunded. AshantiHub reviews each promo before it applies.
      </Text>
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      <Button label="Send for review" onPress={() => void send()} loading={busy} disabled={!canSendDeliveryPromo(f) || busy} />
    </View>
  );
}

function PromoCard({ p }: { p: DeliveryPromo }) {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const s = promoStatus(p);
  const over = p.effective_status === "ended" || p.effective_status === "rejected";
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "pause" | "resume" | "end") {
    setBusy(action);
    setError(null);
    try {
      await api(`/api/marketing/owner/delivery-promos/${p.id}/${action}/`, { method: "POST", body: {} });
      setAsking(false);
      await qc.invalidateQueries({ queryKey: ["owner-delivery-promos"] });
    } catch (e) {
      setError(apiMessage(e, "That didn’t work. Nothing was changed."));
    } finally {
      setBusy(null);
    }
  }
  const dim = { color: c.dim, fontFamily: fonts.body, fontSize: 13 } as const;
  return (
    <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, padding: 16, gap: 6 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{p.name}</Text>
      <Pill tone={s.tone} icon={s.icon} label={s.label} />
      {p.funded_by === "platform" ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 13 }}>AshantiHub pays</Text> : null}
      <Text style={dim}>{`${whenText(p.starts_at)} to ${whenText(p.ends_at)}`}</Text>
      <Text style={dim}>{p.all_items ? "All your items" : p.listings.map((l) => l.name).join(", ")}</Text>
      <Text style={dim}>{`Delivery covered so far: ${formatCedis(p.covered_total)} on ${p.covered_orders} ${p.covered_orders === 1 ? "order" : "orders"}`}</Text>
      {p.status === "rejected" && p.rejection_reason ? <Text style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{`Reason: ${p.rejection_reason}`}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{error}</Text> : null}
      {!over ? (
        asking ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>End this promo? Customers will pay delivery again straight away.</Text>
            <Button variant="destructive" label="Yes, end it" onPress={() => void act("end")} loading={busy === "end"} />
            <Button variant="secondary" label="Keep it" onPress={() => setAsking(false)} disabled={busy !== null} />
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {p.status === "active" ? <Button variant="secondary" label={`Pause ${p.name}`} onPress={() => void act("pause")} loading={busy === "pause"} /> : null}
            {p.status === "paused" ? <Button variant="secondary" label={`Resume ${p.name}`} onPress={() => void act("resume")} loading={busy === "resume"} /> : null}
            <Button variant="destructive" label={`${p.status === "pending" ? "Withdraw" : "End"} ${p.name}`} onPress={() => setAsking(true)} />
          </View>
        )
      ) : null}
    </View>
  );
}

/** Free-delivery promos: you pay the delivery fee on your own items for a set time. Pause, resume or end any time. */
export default function PromoDelivery() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useDeliveryPromos();
  const [adding, setAdding] = useState(false);
  const rows = q.data?.results ?? [];
  return (
    <Screen>
      <BackButton fallback="/manage/promotions" />
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Free delivery</Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Pay the delivery fee on your own items for a set time.</Text>
      {adding ? (
        <>
          <NewPromo onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ["owner-delivery-promos"] }); }} />
          <Button variant="secondary" label="Close" onPress={() => setAdding(false)} />
        </>
      ) : (
        <Button label="New promo" onPress={() => setAdding(true)} />
      )}
      {q.isLoading ? <Skeleton height={100} /> : null}
      {q.isError ? <EmptyState title="We couldn’t load your promos" action={{ label: "Try again", onPress: () => void q.refetch() }} /> : null}
      {q.data && rows.length === 0 ? <EmptyState title="No free-delivery promos yet" /> : null}
      {rows.map((p) => <PromoCard key={p.id} p={p} />)}
    </Screen>
  );
}
