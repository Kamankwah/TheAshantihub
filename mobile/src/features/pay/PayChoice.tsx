import { Pressable, Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { formatCedis } from "../../ui/Price";
import type { PayChoiceState } from "./usePayChoice";

function Choice({ label, selected, onPress, disabled, children }: { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean; children?: React.ReactNode }) {
  const { c, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 56, borderRadius: radius.control, borderWidth: selected ? 2 : 1, borderColor: selected ? c.ink : c.line, backgroundColor: c.surface, padding: 14, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      {children}
    </Pressable>
  );
}

/** "Pay with": Mobile Money or the AshantiHub wallet, with the honest reason when the wallet cannot be used. */
export function PayChoice({ choice }: { choice: PayChoiceState }) {
  const { c } = useTheme();
  const { wallet, method, processing, youPay, problem } = choice;
  const lower = `${wallet.note.charAt(0).toLowerCase()}${wallet.note.slice(1)}`;
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Pay with</Text>
      <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
        <Choice label="Mobile Money" selected={method === "momo"} onPress={() => choice.setMethod("momo")}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Mobile Money</Text>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>
            {processing !== undefined ? `You approve the payment on your phone. Payment processing: ${formatCedis(processing)}.` : "You approve the payment on your phone."}
          </Text>
        </Choice>
        <Choice label={`AshantiHub wallet, ${lower}`} selected={method === "wallet"} disabled={!wallet.enabled} onPress={() => choice.setMethod("wallet")}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>AshantiHub wallet</Text>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{wallet.note}</Text>
        </Choice>
      </View>
      {youPay !== undefined ? <Text style={{ color: c.price, fontFamily: fonts.bodyBold, fontSize: 15, fontVariant: ["tabular-nums"] }}>{`You pay ${formatCedis(youPay)}`}</Text> : null}
      {problem ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{problem}</Text> : null}
    </View>
  );
}
