import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { Text, View } from "react-native";

import { isWalletOff, useVendorOverview } from "../../features/wallet/api";
import { StatementExport } from "../../features/wallet/StatementExport";
import { DestinationsSection, Notice, WithdrawalsSection, WithdrawButton } from "../../features/wallet/Payouts";
import { DaysList, FeesList, SalesList, Segments, TABS, type Tab } from "../../features/wallet/VendorMoney";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { EmptyState } from "../../ui/EmptyState";
import { formatCedis, Price } from "../../ui/Price";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";

const NEGATIVE = "Your available balance is below zero after a refund. It recovers from your next sales.";

/** Money for a business: what is waiting, what can be withdrawn, and where it came from. Read-only except withdrawing. */
export default function ScreenMoney() {
  const { c } = useTheme();
  usePreventScreenCapture(); // balances and payout numbers must not end up in screenshots
  const overview = useVendorOverview();
  const [tab, setTab] = useState<Tab>("Sales");
  const [notice, setNotice] = useState<string | null>(null);
  const title = <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Money</Text>;

  if (overview.isPending) return <Screen>{title}<Skeleton height={140} /></Screen>;
  if (overview.isError) {
    return (
      <Screen>
        {title}
        {isWalletOff(overview.error) ? (
          <EmptyState title="Money is not available yet" body="Your balances and withdrawals will appear here once AshantiHub payouts are switched on." />
        ) : (
          <EmptyState title="We couldn’t load your money" action={{ label: "Try again", onPress: () => void overview.refetch() }} />
        )}
      </Screen>
    );
  }
  const o = overview.data;
  const cap = o.fee_cap;
  return (
    <Screen>
      {title}
      <View style={{ backgroundColor: c.well, borderRadius: 16, padding: 16, gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 14 }}>Available</Text>
          <Price amount={o.available} style={{ fontSize: 32, fontFamily: fonts.display }} />
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>Released to you. This is what you can withdraw.</Text>
        </View>
        <View style={{ gap: 2 }}>
          <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 14 }}>Pending</Text>
          <Price amount={o.pending} style={{ fontSize: 20 }} />
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>
            {o.awaiting_call > 0 ? `${o.awaiting_call} ${o.awaiting_call === 1 ? "sale is" : "sales are"} waiting to be released.` : "Paid sales wait here until AshantiHub releases them."}
          </Text>
        </View>
        {Number(o.withdrawing) > 0 ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>{`${formatCedis(o.withdrawing)} is on its way to you.`}</Text> : null}
        {o.negative ? <Text accessibilityRole="alert" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 20 }}>{NEGATIVE}</Text> : null}
        {cap.limit ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Platform fees so far: ${formatCedis(cap.used)} of ${formatCedis(cap.limit)} lifetime limit.`}</Text> : null}
      </View>
      <Notice text={notice} />
      <WithdrawButton onDone={setNotice} blocked={o.negative || Number(o.withdrawable) <= 0} />
      <Segments items={TABS} value={tab} onChange={setTab} />
      {tab === "Sales" ? <SalesList kind="sales" /> : null}
      {tab === "Bookings" ? <SalesList kind="bookings" /> : null}
      {tab === "Days" ? <View style={{ gap: 20 }}><DaysList /><StatementExport /></View> : null}
      {tab === "Fees" ? <FeesList /> : null}
      {tab === "Payouts" ? (
        <View style={{ gap: 20 }}>
          <WithdrawalsSection onNotice={setNotice} />
          <DestinationsSection onNotice={setNotice} />
        </View>
      ) : null}
    </Screen>
  );
}
