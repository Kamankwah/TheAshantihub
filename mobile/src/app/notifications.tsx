import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "../lib/api";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";

type Note = { id: number; kind: string; title: string; body: string; is_read: boolean; created_at: string };

export default function NotificationsScreen() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ unread_count: number; results: Note[] }>("/api/notifications/") });
  const unread = q.data?.unread_count ?? 0;

  async function readAll() {
    try {
      await api("/api/notifications/read-all/", { method: "POST" });
    } finally {
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  }
  async function readOne(n: Note) {
    if (n.is_read) return;
    try {
      await api(`/api/notifications/${n.id}/read/`, { method: "POST" });
    } finally {
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={q.data?.results ?? []}
        keyExtractor={(n) => String(n.id)}
        refreshing={q.isRefetching}
        onRefresh={() => void q.refetch()}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
              <Feather name="arrow-left" size={24} color={c.ink} />
            </Pressable>
            <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Notifications</Text>
            {q.data && q.data.results.length > 0 ? (
              <>
                <Text accessibilityLiveRegion="polite" style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 14 }}>{unread > 0 ? `${unread} unread` : "All caught up"}</Text>
                {unread > 0 ? <Button variant="secondary" label="Mark all as read" onPress={() => void readAll()} /> : null}
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          q.isPending ? (
            <Skeleton height={100} />
          ) : q.isError ? (
            <EmptyState title="We couldn’t load your notifications" action={{ label: "Try again", onPress: () => void q.refetch() }} />
          ) : (
            <EmptyState title="No notifications yet" body="Order and account updates will show up here." />
          )
        }
        renderItem={({ item: n }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${n.title}. ${n.body}${n.is_read ? "" : ". Unread"}`}
            onPress={() => void readOne(n)}
            style={{ minHeight: 64, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 14, gap: 4 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {!n.is_read ? <View accessibilityElementsHidden style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
              <Text style={{ flex: 1, color: c.ink, fontFamily: n.is_read ? fonts.bodySemi : fonts.bodyBold, fontSize: 15 }}>{n.title}</Text>
            </View>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{n.body}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
