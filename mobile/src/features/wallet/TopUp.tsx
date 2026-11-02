import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { formatCedis } from "../../ui/Price";
import { Sheet } from "../../ui/Sheet";
import { waitForPayment } from "../cart/checkout";
import { isAmount } from "./api";

type Quote = { amount: string; payment_processing: string; you_pay: string };
type TopUpResult = { mode: "immediate" | "redirect"; reference: string; amount: string; checkout_url?: string };

/** Add money to the wallet by Mobile Money. Shows the payment-processing charge before anything is paid. */
export function TopUpSheet({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; stop.current = true; }, []);

  // Ask for the charge once the person has stopped typing.
  useEffect(() => {
    const t = setTimeout(() => setTyped(amount.trim()), 350);
    return () => clearTimeout(t);
  }, [amount]);
  const valid = isAmount(amount);
  const quote = useQuery({
    queryKey: ["wallet", "processing", typed],
    enabled: isAmount(typed),
    retry: false,
    queryFn: () => api<Quote>("/api/wallet/processing/", { query: { amount: typed } }),
  });

  async function add() {
    setBusy(true);
    setError(null);
    stop.current = false;
    try {
      const res = await api<TopUpResult>("/api/wallet/top-up/", { body: { amount: amount.trim() } });
      if (res.mode === "redirect") {
        setWaiting(true);
        if (res.checkout_url) void WebBrowser.openBrowserAsync(res.checkout_url);
        const settled = await waitForPayment(res.reference, () => stop.current);
        if (!mounted.current) return;
        setWaiting(false);
        if (settled.status === "paid") {
          await qc.invalidateQueries({ queryKey: ["wallet"] });
          onDone(`${formatCedis(res.amount)} added to your wallet.`);
        } else if (settled.status === "failed") {
          setError("Your payment didn’t go through. Nothing was taken.");
        } else {
          setError("We’re still waiting for your payment. If you paid, it will show in your wallet shortly. Please don’t pay twice.");
        }
        return;
      }
      await qc.invalidateQueries({ queryKey: ["wallet"] });
      onDone(`${formatCedis(res.amount)} added to your wallet.`);
    } catch (e) {
      setError(apiMessage(e, "We couldn’t add the money. Try again."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Sheet visible onClose={onClose} title="Add money">
      <View style={{ gap: 12 }}>
        <Field label="Amount (GH₵)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" helper="You pay by Mobile Money. Money added can’t be withdrawn for a short while." />
        {valid && quote.data ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{`You pay ${formatCedis(quote.data.you_pay)}`}</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Includes ${formatCedis(quote.data.payment_processing)} payment processing. ${formatCedis(quote.data.amount)} goes into your wallet.`}</Text>
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
        {waiting ? (
          <View style={{ gap: 10 }}>
            <Text accessibilityLiveRegion="polite" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Waiting for your payment…</Text>
            <Button variant="secondary" label="Stop waiting" onPress={() => { stop.current = true; }} />
          </View>
        ) : (
          <Button label="Add to wallet" onPress={() => void add()} loading={busy} disabled={!valid} />
        )}
      </View>
    </Sheet>
  );
}
