import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FILTERS, listingStatus } from "../../features/business/listingStatus";
import { useMyListings } from "../../features/business/queries";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Pill } from "../../ui/Pill";
import { Price } from "../../ui/Price";
import { Skeleton } from "../../ui/Skeleton";

export default function BusinessListings() {
  const { c } = useTheme();
  const q = useMyListings();
  const [filter, setFilter] = useState("all");
  const active = FILTERS.find((f) => f.key === filter)!;
  const rows = (q.data ?? []).filter((l) => active.statuses.length === 0 || active.statuses.includes(l.status));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={rows}
        keyExtractor={(l) => String(l.id)}
        showsVerticalScrollIndicator={false}
        refreshing={q.isRefetching}
        onRefresh={() => void q.refetch()}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Listings</Text>
            <Button label="New listing" onPress={() => router.push("/manage/new-listing" as never)} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }} style={{ height: 44, flexGrow: 0 }}>
              {FILTERS.map((f) => {
                const on = f.key === filter;
                return (
                  <Pressable
                    key={f.key}
                    accessibilityRole="button"
                    accessibilityLabel={f.label}
                    accessibilityState={{ selected: on }}
                    hitSlop={{ top: 2, bottom: 2 }}
                    onPress={() => setFilter(f.key)}
                    style={{ height: 48, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center", backgroundColor: on ? c.gold : c.surface, borderWidth: 1, borderColor: on ? c.gold : c.line }}
                  >
                    <Text style={{ color: on ? c.onGold : c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          q.isPending ? <Skeleton height={100} /> : q.isError ? (
            <EmptyState title="We couldn’t load your listings" action={{ label: "Try again", onPress: () => void q.refetch() }} />
          ) : (
            <EmptyState title="Nothing here" body={filter === "all" ? "Add your first listing with the New listing button." : "No listings with this status."} />
          )
        }
        renderItem={({ item: l }) => {
          const s = listingStatus(l.status);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${l.name}, ${s.label}`}
              onPress={() => router.push(`/manage/listing/${l.id}` as never)}
              style={{ minHeight: 48, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 14, gap: 6 }}
            >
              <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{l.name}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                {l.price_amount ? <Price amount={l.price_amount} /> : <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>No price yet</Text>}
                {l.stock_quantity != null ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${l.stock_quantity} in stock`}</Text> : null}
              </View>
              <Pill tone={s.tone} icon={s.icon} label={s.label} />
              {l.status === "pending_review" && l.hold_notice ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{l.hold_notice}</Text> : null}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
