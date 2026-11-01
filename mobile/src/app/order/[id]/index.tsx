import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOrder, useTracking } from "../../../features/orders/queries";
import { orderStatus, placedOn, STEPS } from "../../../features/orders/status";
import { api } from "../../../lib/api";
import { apiMessage } from "../../../lib/errors";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { EmptyState } from "../../../ui/EmptyState";
import { Pill } from "../../../ui/Pill";
import { Price } from "../../../ui/Price";
import { Skeleton } from "../../../ui/Skeleton";

function Code({ label, value, note }: { label: string; value: string; note?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 4 }}>
      <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 13 }}>{label}</Text>
      <Text accessibilityLabel={`${label}: ${value.split("").join(" ")}`} selectable style={{ color: c.ink, fontFamily: fonts.mono, fontSize: 30, letterSpacing: 4 }}>{value}</Text>
      {note ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{note}</Text> : null}
    </View>
  );
}

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const order = useOrder(id);
  const o = order.data;
  const door = o?.delivery_method === "door_to_door";
  const tracking = useTracking(id, !!o && o.status === "paid" && door);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/customer/orders" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  if (order.isLoading) return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas, padding: 20 }}><Skeleton height={200} /></SafeAreaView>;
  if (order.isError || !o) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>{back}<EmptyState title="We couldn’t load this order" action={{ label: "Try again", onPress: () => void order.refetch() }} /></SafeAreaView>;
  }

  const s = orderStatus(o);
  const reached = STEPS.findIndex((x) => x.key === o.delivery_status);
  const t = tracking.data;
  const reviewable = o.status === "paid" ? o.items.filter((it, i, all) => it.listing != null && all.findIndex((x) => x.listing === it.listing) === i) : [];

  async function confirmReceipt() {
    setConfirming(true);
    setError(null);
    try {
      await api(`/api/orders/${id}/confirm-receipt/`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["order", id] });
      await qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) {
      setError(apiMessage(e, "We couldn’t confirm that. Try again."));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
        {back}
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>{`Order #${o.id}`}</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`Placed ${placedOn(o.placed_at)}`}</Text>
        <Pill tone={s.tone} icon={s.icon} label={s.label} />

        {o.status === "paid" && door ? (
          <View style={{ gap: 8 }}>
            {STEPS.map((step, i) => {
              const done = i <= reached;
              return (
                <View key={step.key} accessible accessibilityLabel={`${step.label}${done ? ", done" : ""}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 }}>
                  <Feather name={done ? "check-circle" : "circle"} size={20} color={done ? c.green : c.dim} />
                  <Text style={{ color: done ? c.ink : c.dim, fontFamily: done ? fonts.bodySemi : fonts.body, fontSize: 15 }}>{step.label}</Text>
                </View>
              );
            })}
            {t?.stops && t.stops.total > 1 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`${t.stops.done} of ${t.stops.total} shops collected`}</Text> : null}
            {t?.rider?.first_name ? (
              <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{`${t.rider.first_name} is bringing your order${t.rider.vehicle_type ? ` by ${t.rider.vehicle_type}` : ""}.`}</Text>
            ) : null}
            {t?.rider_busy ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Your rider is finishing another delivery first.</Text> : null}
          </View>
        ) : null}

        {o.delivery_code && door ? <Code label="Delivery code" value={o.delivery_code} note="Read this to your rider at the door." /> : null}
        {o.collection_code && !door ? (
          <Code
            label="Collection code"
            value={o.collection_code}
            note={o.collect_by ? `Show this at the pickup desk by ${new Date(o.collect_by).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" })}.` : "Show this at the pickup desk."}
          />
        ) : null}

        <View style={{ backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 }}>
          {o.items.map((it) => (
            <View key={it.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
              <Text style={{ flex: 1, color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>{`${it.listing_name}${it.variant_label ? ` (${it.variant_label})` : ""} × ${it.quantity}`}</Text>
              <Price amount={it.line_total} style={{ fontSize: 15 }} />
            </View>
          ))}
          {o.delivery_fee ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Delivery</Text>
              <Price amount={o.delivery_fee} style={{ fontSize: 14 }} />
            </View>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: c.line, paddingTop: 8 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Total</Text>
            <Price amount={o.total_amount} style={{ fontSize: 18 }} />
          </View>
        </View>

        {door ? (
          <View style={{ gap: 2 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 14 }}>Delivering to</Text>
            {o.delivery_address ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{o.delivery_address}</Text> : null}
            {o.delivery_gps_address ? <Text style={{ color: c.dim, fontFamily: fonts.mono, fontSize: 13 }}>{o.delivery_gps_address}</Text> : null}
            {o.delivery_landmark ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`Landmark: ${o.delivery_landmark}`}</Text> : null}
          </View>
        ) : null}

        {o.delivery_assignment_status === "delivered" ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>Your rider marked this delivered. Please confirm you have it.</Text>
            <Button label="Confirm I received this order" onPress={() => void confirmReceipt()} loading={confirming} />
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}

        {reviewable.map((it) => (
          <Button
            key={it.listing}
            variant="secondary"
            label={`Review ${it.listing_name}`}
            onPress={() => router.push({ pathname: "/review/[id]", params: { id: String(it.listing), name: it.listing_name } } as never)}
          />
        ))}
        <Button variant="secondary" label="Report a problem" onPress={() => router.push(`/order/${o.id}/problem` as never)} />
      </ScrollView>
    </SafeAreaView>
  );
}
