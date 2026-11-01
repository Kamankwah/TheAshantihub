import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";

/** Shown once the payment is confirmed. No delivery date: there is no source for one. */
export default function OrderConfirmed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["cart"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
  }, [qc]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 14 }}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Thank you</Text>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 18 }}>{`Order #${id}`}</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>
          Your payment is confirmed. The seller is getting your order ready, and you can follow each step under Orders.
        </Text>
        <Button label="Track this order" onPress={() => router.replace(`/order/${id}` as never)} />
        <Button variant="secondary" label="Keep browsing" onPress={() => router.replace("/customer/home" as never)} />
      </View>
    </SafeAreaView>
  );
}
