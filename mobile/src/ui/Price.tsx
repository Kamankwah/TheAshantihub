import { Text, type TextStyle } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

/** Money: plain ink, tabular figures, never gold. Accepts a number or the API's string ("450.00"). */
export function formatCedis(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  const safe = Number.isFinite(value) ? value : 0;
  return `GH₵ ${safe.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Price({ amount, style }: { amount: number | string; style?: TextStyle }) {
  const { c } = useTheme();
  return (
    <Text style={[{ color: c.price, fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ["tabular-nums"] }, style]}>
      {formatCedis(amount)}
    </Text>
  );
}
