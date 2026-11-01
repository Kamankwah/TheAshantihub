import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ListingCard } from "../../features/browse/ListingCard";
import { KINDS, kindOfListing, sinceText } from "../../features/seller/kinds";
import { useSeller, useSellerEvents, useSellerListings } from "../../features/seller/queries";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";

/** The public page of one business: its name, how long it has been here, and what it has live, a tab per kind. */
export default function SellerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const seller = useSeller(id);
  const counts = seller.data?.counts ?? {};
  const hasListings = (counts.products ?? 0) + (counts.services ?? 0) + (counts.stays ?? 0) > 0;
  const listings = useSellerListings(id, !!seller.data && hasListings);
  const events = useSellerEvents(id, !!seller.data && (counts.events ?? 0) > 0);
  const [picked, setPicked] = useState<string | null>(null);

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );

  if (seller.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas, padding: 20 }}>
        <Skeleton height={80} />
      </SafeAreaView>
    );
  }
  if (seller.isError || !seller.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
        {back}
        <EmptyState title="This seller isn’t available" body="They may be paused, or the link is old." action={{ label: "Try again", onPress: () => void seller.refetch() }} />
      </SafeAreaView>
    );
  }

  const tabs = KINDS.filter((k) => (counts[k.id] ?? 0) > 0);
  const active = tabs.find((t) => t.id === picked) ?? tabs[0] ?? null;
  const rows = active && active.id !== "events" ? (listings.data ?? []).filter((l) => kindOfListing(l) === active.id) : [];
  const loading = active ? (active.id === "events" ? events.isLoading : listings.isLoading) : false;
  const since = sinceText(seller.data.since);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
        {back}
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>{seller.data.name}</Text>
        {since ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{since}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Contact Support"
          onPress={() => router.push({ pathname: "/support/new", params: { about: seller.data!.name } } as never)}
          style={{ minHeight: 48, justifyContent: "center" }}
        >
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15, textDecorationLine: "underline" }}>Contact Support</Text>
        </Pressable>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>AshantiHub Support will help with questions about this seller.</Text>

        {!active ? (
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>No live listings right now.</Text>
        ) : (
          <>
            <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
              {tabs.map((t) => {
                const on = t.id === active.id;
                return (
                  <Pressable
                    key={t.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setPicked(t.id)}
                    style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center", backgroundColor: on ? c.gold : c.surface, borderWidth: 1, borderColor: on ? c.gold : c.line }}
                  >
                    <Text style={{ color: on ? c.onGold : c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{`${t.label} (${counts[t.id]})`}</Text>
                  </Pressable>
                );
              })}
            </View>
            {loading ? <Skeleton height={180} /> : null}
            {active.id === "events"
              ? (events.data ?? []).map((e) => (
                  <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.name} onPress={() => router.push(`/event/${e.id}` as never)} style={{ minHeight: 64, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, gap: 4 }}>
                    <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{e.name}</Text>
                    {e.event_date ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{new Date(e.event_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</Text> : null}
                  </Pressable>
                ))
              : rows.map((r) => <ListingCard key={r.id} listing={r} onPress={(lid) => router.push(`/listing/${lid}` as never)} />)}
            {(listings.isError && active.id !== "events") || (events.isError && active.id === "events") ? (
              <EmptyState title="We couldn’t load these" action={{ label: "Try again", onPress: () => void (active.id === "events" ? events.refetch() : listings.refetch()) }} />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
