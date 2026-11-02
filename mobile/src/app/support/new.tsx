import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { startSupport, type StartAbout } from "../../features/support/api";
import { SupportHeader } from "../../features/support/SupportHeader";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";

/** Start a conversation with AshantiHub Support. `about`, `listing`, `business`, `order` say what it is about. */
export default function NewSupport() {
  const params = useLocalSearchParams<StartAbout>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const account = useAuth((s) => s.account);
  const signedIn = useAuth((s) => s.status === "signedIn");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      const convo = await startSupport(params, text.trim(), account.type);
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      router.replace({ pathname: "/support/[id]", params: { id: String(convo.id) } } as never);
    } catch {
      setError("We couldn’t send your message. Your text is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
          <Feather name="arrow-left" size={24} color={c.ink} />
        </Pressable>
        <SupportHeader subject={params.about} />
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>
          Our team reads every message and replies here. Businesses can’t be contacted directly; Support helps with questions about them.
        </Text>
        {signedIn ? (
          <>
            <Field label="Your message" value={text} onChangeText={setText} multiline numberOfLines={5} textAlignVertical="top" style={{ minHeight: 120, paddingTop: 12 }} />
            {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
            <Button label="Send message" onPress={() => void send()} loading={busy} disabled={text.trim().length === 0} />
          </>
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>Sign in to message Support.</Text>
            <Button label="Sign in" onPress={() => router.push("/welcome" as never)} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
