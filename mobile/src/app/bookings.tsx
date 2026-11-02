import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMyBookings, useMyRequests } from "../features/bookings/queries";
import { RequestRow, StayRow } from "../features/bookings/Rows";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";

/** Bookings and requests: the customer's stays and service requests, with pay, cancel, accept and report. */
export default function MyBookings() {
  const { c } = useTheme();
  const [tab, setTab] = useState<"stays" | "services">("stays");
  const stays = useMyBookings();
  const requests = useMyRequests();
  const q = tab === "stays" ? stays : requests;
  const tabButton = (key: "stays" | "services", label: string) => (
    <Pressable
      key={key}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: tab === key }}
      onPress={() => setTab(key)}
      style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: tab === key ? c.ink : c.line }}
    >
      <Text style={{ color: tab === key ? c.ink : c.dim, fontFamily: tab === key ? fonts.bodyBold : fonts.body, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
  let body;
  if (q.isLoading) body = <Skeleton height={140} />;
  else if (q.isError) body = <EmptyState title="We couldn’t load this" action={{ label: "Try again", onPress: () => void q.refetch() }} />;
  else if (tab === "stays") body = (stays.data ?? []).length === 0 ? <EmptyState title="No stay bookings yet" body="Stays you book will appear here." /> : <View style={{ gap: 14 }}>{(stays.data ?? []).map((b) => <StayRow key={b.id} b={b} />)}</View>;
  else body = (requests.data ?? []).length === 0 ? <EmptyState title="No service requests yet" body="Ask a business for a quote and it will appear here." /> : <View style={{ gap: 14 }}>{(requests.data ?? []).map((r) => <RequestRow key={r.id} r={r} />)}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
          <Feather name="arrow-left" size={24} color={c.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Bookings and requests</Text>
        <View accessibilityRole="tablist" style={{ flexDirection: "row" }}>
          {tabButton("stays", "Stays")}
          {tabButton("services", "Services")}
        </View>
        {body}
        <Button variant="secondary" label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about: "My bookings" } } as never)} />
      </ScrollView>
    </SafeAreaView>
  );
}
