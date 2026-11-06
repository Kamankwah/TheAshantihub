import { router } from "expo-router";
import { Linking, Pressable, Text, View } from "react-native";

import { EmailConfirmBanner } from "../../features/business/EmailConfirmBanner";
import { useHoursStatus, useMe, useStock, type GoLive } from "../../features/business/queries";
import { buildSpendSeries, useSpend } from "../../features/business/spend";
import { SpendChart } from "../../features/business/SpendChart";
import { toPrepare, useOwnerOrders } from "../../features/business/orders";
import { SUPPORT_WHATSAPP } from "../../lib/config";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Pill } from "../../ui/Pill";
import { Screen } from "../../ui/Screen";
import { VerifiedBadge } from "../../ui/VerifiedBadge";

/** The server's go-live rule decides whether the shop can list; the pill only echoes it (staff review is separate). */
function StatusPill({ kyc, live }: { kyc?: string; live?: boolean }) {
  if (kyc === "rejected") return <Pill tone="error" icon="alert-circle" label="Verification needs attention" />;
  if (live) return <Pill tone="success" icon="check-circle" label="Live" />;
  return <Pill tone="warn" icon="clock" label={kyc === "verified" ? "Finish setup" : "Verification in progress"} />;
}

/**
 * What still stops the shop listing, straight from `go_live.blockers`. A rejected application shows the server's own
 * sentence and a way to the verification screen instead, and a live shop shows nothing.
 */
function GoLiveChecklist({ goLive, kyc }: { goLive?: GoLive; kyc?: string }) {
  const { c, radius } = useTheme();
  const blockers = Array.isArray(goLive?.blockers) ? goLive.blockers : [];
  if (!goLive || goLive.live || blockers.length === 0) return null;
  const box = { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 } as const;
  const rejected = kyc === "rejected" || blockers.some((b) => b?.code === "kyc_rejected");
  if (rejected) {
    const sentence = blockers.find((b) => b?.code === "kyc_rejected")?.message;
    return (
      <View style={box}>
        {sentence ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>{sentence}</Text> : null}
        <Button variant="secondary" label="See what to fix" onPress={() => router.push("/manage/verification" as never)} />
      </View>
    );
  }
  return (
    <View style={box}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>To start listing, finish these:</Text>
      {blockers.map((b) => (
        <View key={b.code} style={{ flexDirection: "row", gap: 8 }}>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color: c.orange, fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20 }}>{"\u2022"}</Text>
          <Text style={{ flex: 1, color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{b.message}</Text>
        </View>
      ))}
    </View>
  );
}

export default function BusinessHome() {
  const { c, radius } = useTheme();
  const me = useMe();
  const orders = useOwnerOrders();
  const stock = useStock();
  const hours = useHoursStatus();
  const spend = useSpend();
  const waiting = (orders.data?.pages ?? []).flatMap((p) => p.results).filter(toPrepare).length;
  const more = !!orders.hasNextPage;
  const low = stock.data?.results.filter((r) => r.low) ?? [];
  const first = me.data?.full_name.split(" ")[0];
  const card = { minHeight: 48, backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 } as const;

  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>{first ? `Akwaaba, ${first}` : "Akwaaba"}</Text>
      {me.data?.identity_status === "verified" ? <VerifiedBadge /> : me.data ? <StatusPill kyc={me.data.kyc_status} live={me.data.go_live?.live} /> : null}

      <EmailConfirmBanner goLive={me.data?.go_live} />
      <GoLiveChecklist goLive={me.data?.go_live} kyc={me.data?.kyc_status} />

      {hours.data && !hours.data.has_hours ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Add your opening hours" onPress={() => router.push("/manage/hours" as never)} style={card}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Add your opening hours</Text>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Customers see when you are open. This is needed before your listings go live.</Text>
        </Pressable>
      ) : null}

      <Pressable accessibilityRole="button" accessibilityLabel="Open orders" onPress={() => router.push("/business/orders")} style={card}>
        <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 13 }}>Orders</Text>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 20 }}>
          {orders.isPending ? "Loading…" : waiting > 0 ? `${waiting}${more ? "+" : ""} ${waiting === 1 && !more ? "order" : "orders"} to prepare` : "Nothing to prepare right now"}
        </Text>
      </Pressable>

      {low.length > 0 ? (
        <View accessibilityRole="alert" style={{ ...card, backgroundColor: c.well }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Running low on stock</Text>
          {low.map((r) => (
            <Pressable key={r.listing_id} accessibilityRole="button" accessibilityLabel={`${r.name}, restock`} onPress={() => router.push(`/manage/listing/${r.listing_id}` as never)} style={{ minHeight: 48, justifyContent: "center", gap: 2 }}>
              <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{r.name}</Text>
              <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>
                {r.sold_out ? "Sold out" : `${r.stock} left${r.days_of_cover ? `, about ${r.days_of_cover} days of sales left` : ""}`}
              </Text>
              <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>
                {r.line != null ? `Your alert line: ${r.line} units` : `Alert when fewer than ${stock.data?.settings?.cover_days ?? 7} days of sales left`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {spend.data ? <SpendChart series={buildSpendSeries(spend.data)} /> : null}

      <View style={{ gap: 10 }}>
        <Button
          variant="secondary"
          label="WhatsApp Update to AshantiHub"
          onPress={() => void Linking.openURL(`${SUPPORT_WHATSAPP}?text=${encodeURIComponent("UPDATE: ")}`)}
        />
        <Button variant="secondary" label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about: "My business" } } as never)} />
      </View>
    </Screen>
  );
}
