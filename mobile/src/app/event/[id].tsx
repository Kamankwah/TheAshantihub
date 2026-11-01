import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useEvent } from "../../features/seller/queries";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";

/** An event's public details. Ticket sales and RSVPs are not in the app yet, and the page says so. */
export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const q = useEvent(id);
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  if (q.isLoading) return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas, padding: 20 }}><Skeleton height={120} /></SafeAreaView>;
  if (q.isError || !q.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
        {back}
        <EmptyState title="We couldn’t load this event" action={{ label: "Try again", onPress: () => void q.refetch() }} />
      </SafeAreaView>
    );
  }
  const e = q.data;
  const when = e.event_date ? new Date(e.event_date).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" }) : null;
  const reviews = e.review_count ?? 0;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 12 }}>
        {back}
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>{e.name}</Text>
        {when ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 16 }}>{when}</Text> : null}
        {e.address ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>{e.address}</Text> : null}
        {reviews > 0 && e.avg_rating ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{`${Number(e.avg_rating).toFixed(1)} · ${reviews} ${reviews === 1 ? "review" : "reviews"}`}</Text> : null}
        {e.description ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>{e.description}</Text> : null}
        {e.has_tickets ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Ticket sales are not in the app yet. They are on the AshantiHub website.</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Contact Support"
          onPress={() => router.push({ pathname: "/support/new", params: { about: e.name } } as never)}
          style={{ minHeight: 48, justifyContent: "center" }}
        >
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15, textDecorationLine: "underline" }}>Contact Support</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
