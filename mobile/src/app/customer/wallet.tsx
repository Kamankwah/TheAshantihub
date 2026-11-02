import { useState } from "react";
import { Text, View } from "react-native";

import { ActivitySection } from "../../features/wallet/Activity";
import { isWalletOff, useWallet, whenText } from "../../features/wallet/api";
import { DestinationsSection, Notice, WithdrawalsSection, WithdrawButton } from "../../features/wallet/Payouts";
import { TopUpSheet } from "../../features/wallet/TopUp";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { formatCedis, Price } from "../../ui/Price";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";

/** The customer wallet: balance, top-up, withdrawals and payout accounts. Calm and plain: no motion, no decoration. */
export default function ScreenWallet() {
  const { c } = useTheme();
  const wallet = useWallet();
  const [topUp, setTopUp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (wallet.isPending) return <Screen><Header /><Skeleton height={120} /></Screen>;
  if (wallet.isError) {
    return (
      <Screen>
        <Header />
        {isWalletOff(wallet.error) ? (
          <EmptyState title="Wallet is not available yet" body="You can still pay with Mobile Money at checkout. We’ll tell you when the wallet is ready." />
        ) : (
          <EmptyState title="We couldn’t load your wallet" action={{ label: "Try again", onPress: () => void wallet.refetch() }} />
        )}
      </Screen>
    );
  }
  const w = wallet.data;
  if (w.kind !== "customer") {
    return <Screen><Header /><EmptyState title="Wallet is not available yet" /></Screen>;
  }
  const held = (w.held_topup_pesewas ?? 0) / 100;
  return (
    <Screen>
      <Header />
      <View style={{ backgroundColor: c.well, borderRadius: 16, padding: 16, gap: 6 }}>
        <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 14 }}>Your balance</Text>
        <Price amount={w.balance} style={{ fontSize: 32, fontFamily: fonts.display }} />
        {held > 0 ? (
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>
            {`${formatCedis(held)} of this was added recently and can be withdrawn from ${whenText(w.topup_free_at)}. You can still spend it.`}
          </Text>
        ) : null}
      </View>
      <Notice text={notice} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}><Button label="Add money" onPress={() => setTopUp(true)} /></View>
        <View style={{ flex: 1 }}><WithdrawButton onDone={setNotice} /></View>
      </View>
      {topUp ? <TopUpSheet onClose={() => setTopUp(false)} onDone={(t) => { setTopUp(false); setNotice(t); }} /> : null}
      <WithdrawalsSection onNotice={setNotice} />
      <DestinationsSection onNotice={setNotice} />
      <ActivitySection />
    </Screen>
  );
}

function Header() {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Wallet</Text>;
}
