import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";

/** Review an item you bought. `id` is the listing; the server checks you really bought it. */
export default function ReviewScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { c } = useTheme();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/reviews/", { body: { target_type: "listing", target_id: Number(id), rating, comment: text.trim() } });
      setDone(true);
    } catch (e) {
      setError(apiMessage(e, "We couldn’t send your review. Try again."));
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
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>{name ? `Review ${name}` : "Write a review"}</Text>
        {done ? (
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 22 }}>Thank you</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>Your review will appear once it has been checked.</Text>
            <Button label="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace("/customer/orders" as never))} />
          </View>
        ) : (
          <>
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 4 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  accessibilityRole="radio"
                  accessibilityLabel={`${n} ${n === 1 ? "star" : "stars"}`}
                  accessibilityState={{ selected: n === rating }}
                  onPress={() => setRating(n)}
                  style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}
                >
                  <Feather name="star" size={32} color={n <= rating ? c.ink : c.dim} />
                </Pressable>
              ))}
            </View>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{rating ? `${rating} out of 5` : "Tap a star to rate"}</Text>
            <Field label="Your review" value={text} onChangeText={setText} multiline numberOfLines={5} textAlignVertical="top" style={{ minHeight: 120, paddingTop: 12 }} />
            {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
            <Button label="Submit review" onPress={() => void submit()} loading={busy} disabled={rating === 0 || text.trim().length === 0} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
