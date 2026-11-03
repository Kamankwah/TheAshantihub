import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { eventStatus, useMyEvents } from "../../features/business/events";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Pill } from "../../ui/Pill";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";

/** Your events: every event you submitted, with where it stands. */
export default function Events() {
  const { c, radius } = useTheme();
  const q = useMyEvents();
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/business/more" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
        <Feather name="arrow-left" size={24} color={c.ink} />
      </Pressable>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Your events</Text>
      <Button label="New event" onPress={() => router.push("/manage/new-event" as never)} />
      {q.isLoading ? <Skeleton height={100} /> : null}
      {q.isError ? <EmptyState title="We couldn’t load your events" action={{ label: "Try again", onPress: () => void q.refetch() }} /> : null}
      {q.data && q.data.length === 0 ? <EmptyState title="No events yet" body="Add an event and our team will check it before it goes live." /> : null}
      <View style={{ gap: 12 }}>
        {(q.data ?? []).map((e) => {
          const s = eventStatus(e);
          return (
            <Pressable
              key={e.id}
              accessibilityRole="button"
              accessibilityLabel={`${e.name}, ${s.label}`}
              onPress={() => router.push(`/manage/event/${e.id}` as never)}
              style={{ minHeight: 48, backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 14, gap: 6 }}
            >
              <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{e.name}</Text>
              {e.event_date ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{new Date(e.event_date).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" })}</Text> : null}
              <Pill tone={s.tone} icon={s.icon} label={s.label} />
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
