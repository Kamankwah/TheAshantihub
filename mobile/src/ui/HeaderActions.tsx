import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { api } from "../lib/api";
import { useTheme } from "../theme/useTheme";
import { CartButton } from "./CartButton";

/** Messages, notifications (dot when unread) and the cart: the customer's top-right row. */
export function HeaderActions() {
  const { c } = useTheme();
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ unread_count: number }>("/api/notifications/") });
  const unread = notes.data?.unread_count ?? 0;
  const btn = { width: 48, height: 48, alignItems: "center", justifyContent: "center" } as const;
  return (
    <View style={{ flexDirection: "row", alignSelf: "flex-end" }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Messages" onPress={() => router.push("/inbox" as never)} style={btn}>
        <Feather name="message-circle" size={24} color={c.ink} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} onPress={() => router.push("/notifications" as never)} style={btn}>
        <Feather name="bell" size={24} color={c.ink} />
        {unread > 0 ? <View accessibilityElementsHidden style={{ position: "absolute", top: 10, right: 11, width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
      </Pressable>
      <CartButton />
    </View>
  );
}
