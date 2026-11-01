import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { sendReply, useConversations } from "../../features/support/api";
import { useSeen } from "../../features/support/seen";
import { SupportHeader } from "../../features/support/SupportHeader";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Field } from "../../ui/Field";
import { Skeleton } from "../../ui/Skeleton";

export default function SupportChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const account = useAuth((s) => s.account);
  const list = useConversations(true);
  const convo = list.data?.find((x) => String(x.id) === String(id));
  const markSeen = useSeen((s) => s.markSeen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const mine = account?.type === "business_owner" ? "business_owner" : "customer";

  useEffect(() => {
    if (convo) markSeen(convo);
  }, [convo, markSeen]);

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/inbox" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );

  if (list.isLoading) return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas, padding: 20 }}><Skeleton height={160} /></SafeAreaView>;
  if (list.isError) return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>{back}<EmptyState title="We couldn’t load this conversation" action={{ label: "Try again", onPress: () => void list.refetch() }} /></SafeAreaView>;
  if (!convo) return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>{back}<EmptyState title="We couldn’t find this conversation" action={{ label: "Open inbox", onPress: () => router.replace("/inbox" as never) }} /></SafeAreaView>;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await sendReply(convo!.id, text.trim());
      setText("");
      await qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      setError("We couldn’t send that. Your text is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {back}
          <SupportHeader subject={convo.subject} />
        </View>
        <FlatList
          ref={listRef}
          showsVerticalScrollIndicator={false}
          data={convo.messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 20, gap: 10 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: m }) => {
            const own = m.sender_type === mine;
            return (
              <View style={{ alignSelf: own ? "flex-end" : "flex-start", maxWidth: "85%", gap: 2 }}>
                <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 12, textAlign: own ? "right" : "left" }}>{own ? "You" : "AshantiHub Support"}</Text>
                <View style={{ backgroundColor: own ? c.lightGold : c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 21 }}>{m.body}</Text>
                </View>
              </View>
            );
          }}
        />
        <View style={{ padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface }}>
          {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
          <Field label="Your message" value={text} onChangeText={setText} multiline style={{ minHeight: 48, maxHeight: 120 }} />
          <Button label="Send message" onPress={() => void send()} loading={busy} disabled={text.trim().length === 0} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
