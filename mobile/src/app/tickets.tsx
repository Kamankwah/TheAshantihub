import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MoneyBar } from "../features/bookings/MoneyBar";
import { groupTicketsByPurchase, ticketStatus, useMyTickets } from "../features/tickets/queries";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { EmptyState } from "../ui/EmptyState";
import { formatCedis } from "../ui/Price";
import { Skeleton } from "../ui/Skeleton";

/** My tickets: each purchase with its tickets, their status, the QR for the gate, and the cancel and report controls. */
export default function MyTickets() {
  const { c } = useTheme();
  const q = useMyTickets();
  const groups = groupTicketsByPurchase(q.data ?? []);
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  let body;
  if (q.isLoading) body = <Skeleton height={140} />;
  else if (q.isError) body = <EmptyState title="We couldn’t load your tickets" action={{ label: "Try again", onPress: () => void q.refetch() }} />;
  else if (groups.length === 0) body = <EmptyState title="You haven’t bought any tickets yet" body="Buy tickets from an event’s page and they will appear here." />;
  else {
    body = (
      <View style={{ gap: 16 }}>
        {groups.map((g) => (
          <View key={g.key} style={{ gap: 10 }}>
            {g.tickets.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`Show ticket ${t.code}`}
                onPress={() => router.push(`/ticket/${t.id}` as never)}
                style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, padding: 14, gap: 4 }}
              >
                <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{t.event.name}</Text>
                <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`${t.ticket_type.name} · ${formatCedis(t.price)}`}</Text>
                {t.event.event_date ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{new Date(t.event.event_date).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" })}</Text> : null}
                <Text selectable style={{ color: c.ink, fontFamily: fonts.mono, fontSize: 15 }}>{t.code}</Text>
                <Text style={{ color: t.refunded_at ? c.red : c.ink, fontFamily: fonts.bodySemi, fontSize: 13 }}>{ticketStatus(t)}</Text>
              </Pressable>
            ))}
            {g.money ? (
              <MoneyBar
                kind="tickets"
                money={g.money}
                cancelPath={`/api/events/tickets/purchases/${g.money.sale}/cancel/`}
                about={g.tickets[0].event.name}
                ticketCount={g.tickets.filter((t) => !t.refunded_at).length}
                onChanged={() => void q.refetch()}
              />
            ) : null}
          </View>
        ))}
      </View>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
        {back}
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>My tickets</Text>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
