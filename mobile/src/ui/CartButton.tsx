import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { api } from "../lib/api";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

/** The cart icon with the number of items in it (hidden count when the cart is empty or unknown). */
export function CartButton() {
  const { c } = useTheme();
  const cart = useQuery({ queryKey: ["cart"], queryFn: () => api<{ items: { quantity: number }[] }>("/api/cart/") });
  const count = (cart.data?.items ?? []).reduce((n, i) => n + i.quantity, 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Cart, ${count} ${count === 1 ? "item" : "items"}` : "Cart"}
      onPress={() => router.push("/cart" as never)}
      style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
    >
      <Feather name="shopping-bag" size={24} color={c.ink} />
      {count > 0 ? (
        <View style={{ position: "absolute", top: 4, right: 2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.ink, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
          <Text style={{ color: c.canvas, fontFamily: fonts.bodyBold, fontSize: 12 }}>{count > 99 ? "99+" : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
