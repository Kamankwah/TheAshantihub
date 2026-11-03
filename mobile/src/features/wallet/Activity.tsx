import { Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { formatCedis } from "../../ui/Price";
import { Skeleton } from "../../ui/Skeleton";
import { flatPages, isWalletOff, useTransactions, whenText } from "./api";

/** The statement: every line on the holder's own wallet, newest first, 20 at a time. */
export function ActivitySection() {
  const { c, radius } = useTheme();
  const q = useTransactions();
  const rows = flatPages(q.data);
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 20 }}>Activity</Text>
      {q.isPending ? <Skeleton height={64} /> : null}
      {q.isError && !isWalletOff(q.error) ? <Button variant="secondary" label="Try again" onPress={() => void q.refetch()} /> : null}
      {q.data && rows.length === 0 ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>No activity yet</Text> : null}
      {rows.map((l) => (
        <View key={l.id} style={{ backgroundColor: c.surface, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, padding: 12, flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{l.label}</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>
              {[whenText(l.at), l.order ? `Order #${l.order}` : l.booking_sale ? `Booking #${l.booking_sale}` : l.reference].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <Text style={{ color: c.price, fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ["tabular-nums"] }}>
            {`${l.direction === "in" ? "+" : "−"}${formatCedis(l.amount)}`}
          </Text>
        </View>
      ))}
      {q.hasNextPage ? <Button variant="secondary" label="Show more activity" onPress={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : null}
    </View>
  );
}
