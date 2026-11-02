import { View, type ViewProps } from "react-native";

import { useTheme } from "../theme/useTheme";

export function Card({ style, ...rest }: ViewProps) {
  const { c, radius } = useTheme();
  return (
    <View
      {...rest}
      style={[{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 14 }, style]}
    />
  );
}
