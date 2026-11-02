import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "../../../lib/api";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";

const REASONS: [string, string][] = [
  ["order_issue", "Order issue"],
  ["payment_issue", "Payment issue"],
  ["delivery_issue", "Delivery issue"],
  ["quality_issue", "Quality issue"],
  ["other", "Other"],
];

/** Raise a dispute on an order. It goes to AshantiHub Support, never to the seller. */
export default function ProblemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius } = useTheme();
  const [reason, setReason] = useState("order_issue");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/orders/${id}/dispute/`, { body: { reason, description: text.trim() } });
      setSent(true);
    } catch {
      setError("We couldn’t send your report. Your text is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/customer/orders" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
          <Feather name="arrow-left" size={24} color={c.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Report a problem</Text>
        {sent ? (
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 22 }}>Report sent</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>AshantiHub Support will look into order #{id} and contact you. You don’t need to contact the seller.</Text>
            <Button label="Back to my order" onPress={() => router.replace(`/order/${id}` as never)} />
          </View>
        ) : (
          <>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`This goes to AshantiHub Support about order #${id}.`}</Text>
            <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
              {REASONS.map(([key, label]) => {
                const on = key === reason;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: on }}
                    onPress={() => setReason(key)}
                    style={{ minHeight: 48, borderRadius: radius.control, borderWidth: on ? 2 : 1, borderColor: on ? c.ink : c.line, backgroundColor: c.surface, justifyContent: "center", paddingHorizontal: 14 }}
                  >
                    <Text style={{ color: c.ink, fontFamily: on ? fonts.bodySemi : fonts.body, fontSize: 15 }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Field label="What went wrong?" value={text} onChangeText={setText} multiline numberOfLines={5} textAlignVertical="top" style={{ minHeight: 120, paddingTop: 12 }} />
            {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
            <Button label="Send report" onPress={() => void send()} loading={busy} disabled={text.trim().length === 0} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
