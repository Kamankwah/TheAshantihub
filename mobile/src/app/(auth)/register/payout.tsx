import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { RegistrationHeader } from "../../../features/business/RegistrationHeader";
import { messageFor } from "../../../lib/authApi";
import { resumeRegistration, savePayout } from "../../../lib/registrationApi";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Screen } from "../../../ui/Screen";

const NETWORKS = ["MTN", "Vodafone", "AirtelTigo"];

export default function Payout() {
  usePreventScreenCapture(); // payout numbers must not end up in screenshots
  const { c } = useTheme();
  const [method, setMethod] = useState<"momo" | "bank">("momo");
  const [network, setNetwork] = useState("MTN");
  const [momoNumber, setMomoNumber] = useState("");
  const [momoName, setMomoName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankNumber, setBankNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await savePayout({
        default_payout_method: method,
        ...(method === "momo"
          ? { payout_momo_network: network, payout_momo_number: momoNumber.trim(), payout_momo_name: momoName.trim() }
          : { payout_bank_name: bankName.trim(), payout_bank_account_number: bankNumber.trim(), payout_bank_account_name: bankAccountName.trim() }),
      });
      await resumeRegistration();
    } catch (e) {
      setError(messageFor(e, "We couldn't save your payout details. Check them and try again."));
    } finally {
      setBusy(false);
    }
  }

  const choice = (value: "momo" | "bank", label: string) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: method === value }}
      onPress={() => setMethod(value)}
      style={{ flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: method === value ? c.gold : "transparent" }}
    >
      <Text style={{ color: method === value ? c.onGold : c.ink, fontFamily: fonts.bodyBold, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );

  const ready = method === "momo" ? !!momoNumber && !!momoName : !!bankName && !!bankNumber && !!bankAccountName;
  return (
    <Screen>
      <RegistrationHeader step={4} title="Where should we pay you?" back />
      <View style={{ flexDirection: "row", backgroundColor: c.well, borderRadius: 12, padding: 4, gap: 4 }}>
        {choice("momo", "Mobile Money")}
        {choice("bank", "Bank account")}
      </View>
      {method === "momo" ? (
        <>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {NETWORKS.map((n) => (
              <Pressable key={n} accessibilityRole="radio" accessibilityLabel={n} accessibilityState={{ selected: network === n }} onPress={() => setNetwork(n)}
                style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: c.line, justifyContent: "center", backgroundColor: network === n ? c.gold : c.surface }}>
                <Text style={{ color: network === n ? c.onGold : c.ink, fontFamily: fonts.bodySemi }}>{n}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Mobile Money number" value={momoNumber} onChangeText={setMomoNumber} keyboardType="phone-pad" />
          <Field label="Name on the account" value={momoName} onChangeText={setMomoName} />
        </>
      ) : (
        <>
          <Field label="Bank name" value={bankName} onChangeText={setBankName} />
          <Field label="Account number" value={bankNumber} onChangeText={setBankNumber} keyboardType="number-pad" />
          <Field label="Name on the account" value={bankAccountName} onChangeText={setBankAccountName} />
        </>
      )}
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>
        We confirm the account name matches your Ghana Card name before you can withdraw. New numbers wait 24 hours before they can receive money.
      </Text>
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{error}</Text> : null}
      <Button label="Continue" onPress={submit} loading={busy} disabled={!ready} />
    </Screen>
  );
}
