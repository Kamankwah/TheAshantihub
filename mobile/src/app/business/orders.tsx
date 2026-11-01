import { router } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { firstName, toPrepare, useOwnerOrders } from "../../features/business/orders";
import { placedOn } from "../../features/orders/status";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { EmptyState } from "../../ui/EmptyState";
import { Pill } from "../../ui/Pill";
import { Price } from "../../ui/Price";
import { Skeleton } from "../../ui/Skeleton";

export default function BusinessOrders() {
  const { c } = useTheme();
  const q = useOwnerOrders();
  const rows = (q.data?.pages ?? []).flatMap((p) => p.results);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={rows}
        keyExtractor={(o) => String(o.id)}
        showsVerticalScrollIndicator={false}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={() => void q.refetch()}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListHeaderComponent={<Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Orders</Text>}
        ListEmptyComponent={
          q.isPending ? <Skeleton height={100} /> : q.isError ? (
            <EmptyState title="We couldn’t load your orders" action={{ label: "Try again", onPress: () => void q.refetch() }} />
          ) : (
            <EmptyState title="No orders yet" body="Paid orders for your listings show up here." />
          )
        }
        renderItem={({ item: o }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Order ${o.id} from ${firstName(o.customer_name)}`}
            onPress={() => router.push(`/manage/order/${o.id}` as never)}
            style={{ minHeight: 48, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 14, gap: 6 }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{`Order #${o.id}`}</Text>
              {o.owner_subtotal ? <Price amount={o.owner_subtotal} /> : null}
            </View>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${firstName(o.customer_name)} · ${placedOn(o.placed_at)}`}</Text>
            {toPrepare(o) ? <Pill tone="warn" icon="clock" label="To prepare" /> : <Pill tone="neutral" icon="truck" label={o.delivery_status === "delivered" ? "Delivered" : "On its way"} />}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
