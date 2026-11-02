import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { BackButton } from "../../ui/BackButton";
import { Screen } from "../../ui/Screen";

const TOOLS = [
  { label: "Free delivery", note: "Pay the delivery fee for your customers for a set time.", to: "/manage/promo-delivery" },
  { label: "Discounts", note: "Put an item on sale. It goes live at once.", to: "/manage/promo-discounts" },
  { label: "Sponsored ad", note: "Ask for a listing to be featured or boosted.", to: "/manage/promo-sponsored" },
  { label: "Flash-sale invitations", note: "Sales AshantiHub has invited you to.", to: "/manage/promo-flash" },
];

/** Promotions: every tool a business has to bring in customers. */
export default function Promotions() {
  const { c, radius } = useTheme();
  return (
    <Screen>
      <BackButton fallback="/business/more" />
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Promotions</Text>
      <View style={{ gap: 12 }}>
        {TOOLS.map((t) => (
          <Pressable
            key={t.to}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            onPress={() => router.push(t.to as never)}
            style={{ minHeight: 64, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, padding: 16, gap: 2, justifyContent: "center" }}
          >
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{t.label}</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{t.note}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
