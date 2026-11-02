import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { eventStatus, type OwnerTicketType, useMyEvents, useOwnerTicketTypes, usePricingTiers } from "../../../features/business/events";
import { postPayment } from "../../../features/pay/settle";
import { api } from "../../../lib/api";
import { apiMessage } from "../../../lib/errors";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { EmptyState } from "../../../ui/EmptyState";
import { Field } from "../../../ui/Field";
import { ChoiceRow } from "../../../ui/PickerRow";
import { Pill } from "../../../ui/Pill";
import { formatCedis } from "../../../ui/Price";
import { Screen } from "../../../ui/Screen";
import { Skeleton } from "../../../ui/Skeleton";

function TicketTypes({ eventId }: { eventId: string }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useOwnerTicketTypes(eventId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [delivery, setDelivery] = useState<"digital" | "physical">("digital");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${eventId}/ticket-types/`, {
        body: { name: name.trim(), description: description.trim(), price, delivery_method: delivery, quantity_total: quantity === "" ? null : Number(quantity), is_active: true },
      });
      setAdding(false);
      setName(""); setDescription(""); setPrice(""); setQuantity("");
      await qc.invalidateQueries({ queryKey: ["owner-ticket-types", eventId] });
    } catch (e) {
      setError(apiMessage(e, "We couldn’t save that ticket type."));
    } finally {
      setBusy(false);
    }
  }
  const rows: OwnerTicketType[] = q.data ?? [];
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 22 }}>Tickets</Text>
      {q.isLoading ? <Skeleton height={60} /> : null}
      {q.isError ? <EmptyState title="We couldn’t load your tickets" action={{ label: "Try again", onPress: () => void q.refetch() }} /> : null}
      {q.data && rows.length === 0 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>No ticket types yet. Add one so people can buy tickets in the app.</Text> : null}
      {rows.map((t) => (
        <View key={t.id} style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, padding: 14, gap: 2 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{t.name}</Text>
            <Text style={{ color: c.price, fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ["tabular-nums"] }}>{formatCedis(t.price)}</Text>
          </View>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${t.quantity_sold} sold${t.quantity_remaining != null ? `, ${t.quantity_remaining} left` : ""}${t.is_active ? "" : " · off sale"}`}</Text>
        </View>
      ))}
      {adding ? (
        <View style={{ gap: 12 }}>
          <Field label="Ticket name" value={name} onChangeText={setName} />
          <Field label="Details (optional)" value={description} onChangeText={setDescription} />
          <Field label="Price in GH₵" value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
          <Field label="How many (leave empty for no limit)" value={quantity} onChangeText={(v) => setQuantity(v.replace(/\D/g, ""))} keyboardType="number-pad" />
          <ChoiceRow label="How buyers get it" value={delivery} onChange={setDelivery} options={[{ value: "digital", label: "Digital, shown in the app" }, { value: "physical", label: "Physical, collected" }]} />
          {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
          <Button label="Save ticket type" onPress={() => void save()} loading={busy} disabled={!name.trim() || !(Number(price) > 0)} />
          <Button variant="secondary" label="Cancel" onPress={() => setAdding(false)} disabled={busy} />
        </View>
      ) : (
        <Button variant="secondary" label="Add a ticket type" onPress={() => setAdding(true)} />
      )}
    </View>
  );
}

/** One of your events: where it stands, paying for it once approved, and its ticket types once it is live. */
export default function ManageEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useMyEvents();
  const tiers = usePricingTiers();
  const e = q.data?.find((x) => String(x.id) === String(id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/manage/events" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  if (!e) return <Screen>{back}{q.isPending ? <Skeleton height={160} /> : <EmptyState title="We couldn’t find this event" action={{ label: "Try again", onPress: () => void q.refetch() }} />}</Screen>;
  const s = eventStatus(e);
  const tier = tiers.data?.find((t) => t.duration_days === e.visibility_days);
  const live = e.status === "approved" && !!e.paid_at;
  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await postPayment(`/api/events/${e!.id}/pay/`, {});
      if (res.status === "failed") setError("The payment didn’t go through. Try again.");
      else if (res.status === "timeout") setError("We’re still waiting for your payment. Check back in a few minutes before paying again.");
      await qc.invalidateQueries({ queryKey: ["owner-events"] });
    } catch (err) {
      setError(apiMessage(err, "We couldn’t take the payment. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      {back}
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 26 }}>{e.name}</Text>
      <Pill tone={s.tone} icon={s.icon} label={s.label} />
      {e.event_date ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{new Date(e.event_date).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" })}</Text> : null}
      {e.address ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{e.address}</Text> : null}
      {e.access_level === "private" && e.access_code ? <Text selectable style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{`Private event. Share this code with your guests: ${e.access_code}`}</Text> : null}
      {e.status === "rejected" && e.rejection_reason ? (
        <View accessibilityRole="alert" style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 4 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 14 }}>What to fix</Text>
          <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{e.rejection_reason}</Text>
        </View>
      ) : null}
      {e.status === "approved" && !e.paid_at ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>
            {tier ? `Your event is approved. Pay ${formatCedis(tier.live_price)} to show it for ${e.visibility_days} days.` : `Your event is approved. Pay to show it for ${e.visibility_days} days.`}
          </Text>
          {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
          {tier ? <Button label={`Pay ${formatCedis(tier.live_price)}`} onPress={() => void pay()} loading={busy} /> : null}
        </View>
      ) : null}
      {live && e.expires_at ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`Shown until ${new Date(e.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Accra" })}.`}</Text> : null}
      {live ? <TicketTypes eventId={String(e.id)} /> : <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Ticket types can be added once your event is live.</Text>}
    </Screen>
  );
}
