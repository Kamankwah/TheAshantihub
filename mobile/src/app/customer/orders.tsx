import { router } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOrders } from "../../features/orders/queries";
import { orderStatus, placedOn } from "../../features/orders/status";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { EmptyState } from "../../ui/EmptyState";
import { Pill } from "../../ui/Pill";
import { Price } from "../../ui/Price";
import { Skeleton } from "../../ui/Skeleton";

export default function ScreenOrders() {
  const { c } = useTheme();
  const orders = useOrders();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={orders.data ?? []}
        keyExtractor={(o) => String(o.id)}
        showsVerticalScrollIndicator={false}
        refreshing={orders.isRefetching}
        onRefresh={() => void orders.refetch()}
        contentContainerStyle={{ padding: 20, gap: 14 }}
        ListHeaderComponent={<Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Orders</Text>}
        ListEmptyComponent={
          orders.isPending ? (
            <Skeleton height={140} />
          ) : orders.isError ? (
            <EmptyState title="We couldn’t load your orders" action={{ label: "Try again", onPress: () => void orders.refetch() }} />
          ) : (
            <EmptyState title="No orders yet" body="When you buy something, it shows up here." action={{ label: "Start browsing", onPress: () => router.push("/customer/explore") }} />
          )
        }
        renderItem={({ item: o }) => {
          const s = orderStatus(o);
          const first = o.items[0]?.listing_name;
          const more = o.items.length - 1;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Order ${o.id}, ${s.label}`}
              onPress={() => router.push(`/order/${o.id}` as never)}
              style={{ backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{`Order #${o.id}`}</Text>
                <Price amount={o.total_amount} />
              </View>
              <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Placed ${placedOn(o.placed_at)}`}</Text>
              {first ? <Text numberOfLines={2} style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>{more > 0 ? `${first} and ${more} more` : first}</Text> : null}
              <Pill tone={s.tone} icon={s.icon} label={s.label} />
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
