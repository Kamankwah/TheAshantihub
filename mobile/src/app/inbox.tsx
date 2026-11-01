import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { lastMessage, useConversations } from "../features/support/api";
import { isUnread, useSeen } from "../features/support/seen";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";

export default function InboxScreen() {
  const { c } = useTheme();
  const list = useConversations();
  const { seen, load, markSeen } = useSeen();
  useEffect(() => {
    void load();
  }, [load]);
  const rows = [...(list.data ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={rows}
        keyExtractor={(x) => String(x.id)}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 4 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
              <Feather name="arrow-left" size={24} color={c.ink} />
            </Pressable>
            <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Messages</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Your conversations with AshantiHub Support.</Text>
          </View>
        }
        ListEmptyComponent={
          list.isPending ? (
            <Skeleton height={100} />
          ) : list.isError ? (
            <EmptyState title="We couldn’t load your messages" action={{ label: "Try again", onPress: () => void list.refetch() }} />
          ) : (
            <EmptyState title="No messages yet" body="Use Contact Support on any item, seller or order and your conversation will appear here." />
          )
        }
        renderItem={({ item: x }) => {
          const last = lastMessage(x);
          const unread = isUnread(x, seen);
          const label = `Re: ${x.subject || "AshantiHub"}`;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}. ${last?.body ?? ""}${unread ? ". Unread" : ""}`}
              onPress={() => {
                markSeen(x);
                router.push({ pathname: "/support/[id]", params: { id: String(x.id) } } as never);
              }}
              style={{ minHeight: 72, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 14, gap: 4 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {unread ? <View accessibilityElementsHidden style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
                <Text numberOfLines={1} style={{ flex: 1, color: c.ink, fontFamily: unread ? fonts.bodyBold : fonts.bodySemi, fontSize: 15 }}>{label}</Text>
              </View>
              {last ? <Text numberOfLines={2} style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`${last.sender_type === "staff" ? "AshantiHub Support" : "You"}: ${last.body}`}</Text> : null}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
