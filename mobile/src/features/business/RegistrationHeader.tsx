import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";

/** Back chevron, five-step progress bar and the step title. */
export function RegistrationHeader({ step, title, back }: { step: number; title: string; back?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ minHeight: 48, justifyContent: "center" }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>‹ Back</Text>
        </Pressable>
      ) : null}
      <View accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of 5`} style={{ flexDirection: "row", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <View key={n} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: n <= step ? c.gold : c.well, borderWidth: 1, borderColor: n <= step ? c.gold : c.line }} />
        ))}
      </View>
      <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 13 }}>{`${step} of 5`}</Text>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28, lineHeight: 32 }}>
        {title}
      </Text>
    </View>
  );
}
