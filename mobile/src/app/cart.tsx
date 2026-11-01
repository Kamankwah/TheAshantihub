import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { removeLine, setLineQuantity, useCart } from "../features/cart/queries";
import { apiMessage } from "../lib/errors";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Price } from "../ui/Price";
import { Skeleton } from "../ui/Skeleton";
import { Stepper } from "../ui/Stepper";

export default function CartScreen() {
  const { c } = useTheme();
  const cart = useCart();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function act(id: number, run: () => Promise<unknown>, fallback: string) {
    setError(null);
    setBusy(id);
    try {
      await run();
      await cart.refetch();
    } catch (e) {
      setError(apiMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  const items = cart.data?.items ?? [];
  const blocked = items.some((i) => i.in_stock === false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
        {back}
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Your cart</Text>
        {cart.isLoading ? <Skeleton height={120} /> : null}
        {cart.isError ? <EmptyState title="We couldn’t load your cart" action={{ label: "Try again", onPress: () => void cart.refetch() }} /> : null}
        {cart.data && items.length === 0 ? (
          <EmptyState title="Your cart is empty" body="Find something you like and add it here." action={{ label: "Start browsing", onPress: () => router.replace("/customer/explore" as never) }} />
        ) : null}
        {items.map((i) => (
          <View key={i.id} style={{ backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{i.listing_name}</Text>
            {i.variant_label ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{i.variant_label}</Text> : null}
            {i.seller_name ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Sold by ${i.seller_name}`}</Text> : null}
            {i.in_stock === false ? <Text style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>Out of stock. Remove it to continue.</Text> : null}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Stepper label={i.listing_name} value={i.quantity} min={1} max={i.stock_quantity ?? 99} onChange={(n) => void act(i.id, () => setLineQuantity(i.id, n), "We couldn’t change the quantity.")} />
              <Price amount={i.line_total} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${i.listing_name}`} disabled={busy === i.id} onPress={() => void act(i.id, () => removeLine(i.id), "We couldn’t remove this item.")} style={{ minHeight: 48, justifyContent: "center" }}>
              <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14, textDecorationLine: "underline" }}>Remove</Text>
            </Pressable>
          </View>
        ))}
        {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
        {items.length > 0 ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 16 }}>Items</Text>
              <Price amount={cart.data!.total} style={{ fontSize: 20 }} />
            </View>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>
              The delivery fee is worked out at checkout from your GhanaPost address. Choose store pickup to skip it.
            </Text>
            <Button label="Go to checkout" onPress={() => router.push("/checkout" as never)} disabled={blocked} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
