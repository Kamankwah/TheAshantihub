import { ActivityIndicator, Pressable, Text } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "destructive";
  loading?: boolean;
  disabled?: boolean;
};

/** One primary (gold) action per screen; secondary and destructive stay quieter. */
export function Button({ label, onPress, variant = "primary", loading, disabled }: Props) {
  const { c, radius } = useTheme();
  const inactive = !!disabled || !!loading;
  const palette = {
    primary: { bg: c.gold, fg: c.onGold, border: c.gold, height: 52 },
    secondary: { bg: c.surface, fg: c.ink, border: c.line, height: 48 },
    destructive: { bg: "transparent", fg: c.red, border: c.red, height: 48 },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: palette.height,
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.bg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
        opacity: inactive ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={{ color: palette.fg, fontFamily: fonts.bodyBold, fontSize: variant === "primary" ? 16 : 15 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
