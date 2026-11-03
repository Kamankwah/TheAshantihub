import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ticketStatus, useMyTickets } from "../../features/tickets/queries";
import { TicketQr } from "../../features/tickets/TicketQr";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";

/** One ticket at the gate: a big QR on white, the code to read out, and nothing else to distract. */
export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const q = useMyTickets();
  const ticket = q.data?.find((t) => String(t.id) === String(id));
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/tickets" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  let body;
  if (q.isLoading) body = <Skeleton height={260} />;
  else if (q.isError) body = <EmptyState title="We couldn’t load this ticket" action={{ label: "Try again", onPress: () => void q.refetch() }} />;
  else if (!ticket) body = <EmptyState title="We couldn’t find this ticket" body="It may belong to another account." />;
  else {
    const refunded = !!ticket.refunded_at;
    body = (
      <View style={{ gap: 14, alignItems: "center" }}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 24, textAlign: "center" }}>{ticket.event.name}</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>{`${ticket.ticket_type.name} · ${ticketStatus(ticket)}`}</Text>
        {refunded ? (
          <Text style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 15, textAlign: "center" }}>This ticket was refunded and will not be accepted at the gate.</Text>
        ) : (
          <>
            <TicketQr code={ticket.code} size={260} />
            <Text selectable style={{ color: c.ink, fontFamily: fonts.mono, fontSize: 22, letterSpacing: 1 }}>{ticket.code}</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
              Turn your screen brightness up before you reach the gate. The organiser scans this QR, or types the code above if the scan fails. Don’t share this ticket: anyone with the code can use it.
            </Text>
          </>
        )}
      </View>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
        {back}
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
