import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

type Props = { value: number; max: number; min?: number; onChange: (n: number) => void; label: string; disabled?: boolean };

/** A 48 dp minus/plus pair around a number. `label` names the thing being counted for screen readers. */
export function Stepper({ value, max, min = 0, onChange, label, disabled }: Props) {
  const { c } = useTheme();
  const btn = { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: c.line } as const;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`One fewer ${label}`} accessibilityState={{ disabled: !!disabled || value <= min }} disabled={!!disabled || value <= min} onPress={() => onChange(value - 1)} style={[btn, { opacity: disabled || value <= min ? 0.4 : 1 }]}>
        <Feather name="minus" size={18} color={c.ink} />
      </Pressable>
      <Text style={{ minWidth: 28, textAlign: "center", color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`One more ${label}`} accessibilityState={{ disabled: !!disabled || value >= max }} disabled={!!disabled || value >= max} onPress={() => onChange(value + 1)} style={[btn, { opacity: disabled || value >= max ? 0.4 : 1 }]}>
        <Feather name="plus" size={18} color={c.ink} />
      </Pressable>
    </View>
  );
}
