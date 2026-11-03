import { Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { formatCedis } from "../../ui/Price";
import type { SpendMonth } from "./spend";

const H = 80;

/** "Your AshantiHub spend": what the business paid AshantiHub for subscriptions and promotions, month by month. Not sales. */
export function SpendChart({ series }: { series: SpendMonth[] }) {
  const { c, radius } = useTheme();
  const total = series.reduce((s, r) => s + r.amount, 0);
  const max = Math.max(...series.map((r) => r.amount), 0);
  const barW = 100 / series.length;
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 14, gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Your AshantiHub spend</Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>What you paid AshantiHub for subscriptions and promotions.</Text>
      {total === 0 ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>No payments to AshantiHub in the last 6 months.</Text>
      ) : (
        <View accessible accessibilityLabel={`Your AshantiHub spend, last 6 months: ${formatCedis(total)} in total. ${series.map((r) => `${r.month} ${formatCedis(r.amount)}`).join(", ")}`}>
          <Svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
            {series.map((r, i) => {
              const h = max > 0 ? Math.max(r.amount > 0 ? 3 : 0, (r.amount / max) * (H - 4)) : 0;
              return <Rect key={r.key} x={i * barW + barW * 0.15} y={H - h} width={barW * 0.7} height={h} rx={2} fill={c.ink} opacity={r.amount > 0 ? 0.85 : 0.15} />;
            })}
          </Svg>
          <View style={{ flexDirection: "row" }}>
            {series.map((r) => (
              <View key={r.key} style={{ flex: 1, alignItems: "center", paddingTop: 4 }}>
                <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 12 }}>{r.month}</Text>
                <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 11, fontVariant: ["tabular-nums"] }}>{formatCedis(r.amount)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
