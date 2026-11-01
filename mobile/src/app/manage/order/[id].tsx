import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";

import { firstName, toPrepare, useOwnerOrders } from "../../../features/business/orders";
import { placedOn } from "../../../features/orders/status";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { EmptyState } from "../../../ui/EmptyState";
import { Pill } from "../../../ui/Pill";
import { Price } from "../../../ui/Price";
import { Screen } from "../../../ui/Screen";
import { Skeleton } from "../../../ui/Skeleton";

/** One order, as the business sees it: the customer's first name, the items, and the code the rider asks for. */
export default function OwnerOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const q = useOwnerOrders();
  const o = (q.data?.pages ?? []).flatMap((p) => p.results).find((x) => String(x.id) === String(id));
  useEffect(() => {
    if (!o && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [o, q]);
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/business/orders" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  if (!o) {
    return (
      <Screen>
        {back}
        {q.isPending || q.hasNextPage ? <Skeleton height={160} /> : <EmptyState title="We couldn’t find this order" action={{ label: "Try again", onPress: () => void q.refetch() }} />}
      </Screen>
    );
  }
  return (
    <Screen>
      {back}
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>{`Order #${o.id}`}</Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`${firstName(o.customer_name)} · ${placedOn(o.placed_at)}`}</Text>
      {toPrepare(o) ? <Pill tone="warn" icon="clock" label="To prepare" /> : <Pill tone="neutral" icon="truck" label={o.delivery_status === "delivered" ? "Delivered" : "On its way"} />}
      <View style={{ backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 }}>
        {o.items.map((it) => (
          <View key={it.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
            <Text style={{ flex: 1, color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>{`${it.listing_name} × ${it.quantity}`}</Text>
            {it.line_total ? <Price amount={it.line_total} style={{ fontSize: 15 }} /> : null}
          </View>
        ))}
        {o.owner_subtotal ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: c.line, paddingTop: 8 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>Your items</Text>
            <Price amount={o.owner_subtotal} />
          </View>
        ) : null}
      </View>
      {o.pickup_code ? (
        <View style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 4 }}>
          <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 13 }}>Pickup code</Text>
          <Text selectable style={{ color: c.ink, fontFamily: fonts.mono, fontSize: 30, letterSpacing: 4 }}>{o.pickup_code}</Text>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>Give this code to the rider when they collect the order.</Text>
        </View>
      ) : null}
      {o.pickup_eta_late ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>The rider is running late.</Text> : null}
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>AshantiHub handles delivery and the customer’s details. Questions go to Support.</Text>
    </Screen>
  );
}
