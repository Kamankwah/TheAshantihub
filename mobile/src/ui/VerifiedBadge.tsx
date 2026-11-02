import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

/** Verification: a green check on a neutral pill. Never gold; gold means promoted. */
export function VerifiedBadge() {
  const { c, radius } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Verified business"
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 6,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: radius.pill,
        paddingLeft: 8,
        paddingRight: 10,
        paddingVertical: 3,
      }}
    >
      <Feather name="check" size={13} color={c.green} />
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 12 }}>Verified business</Text>
    </View>
  );
}
