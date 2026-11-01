import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

type Props = { tone: "success" | "warn" | "error" | "neutral"; icon: keyof typeof Feather.glyphMap; label: string };

/** A status: icon AND words, so it never depends on colour alone. */
export function Pill({ tone, icon, label }: Props) {
  const { c, radius } = useTheme();
  const color = { success: c.green, warn: c.orange, error: c.red, neutral: c.dim }[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 6,
        borderWidth: 1,
        borderColor: color,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Feather name={icon} size={13} color={color} />
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
