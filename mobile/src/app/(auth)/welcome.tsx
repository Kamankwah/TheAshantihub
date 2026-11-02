import { router } from "expo-router";
import { Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Screen } from "../../ui/Screen";

export default function Welcome() {
  const { c } = useTheme();
  return (
    <Screen>
      <View style={{ height: 8, flexDirection: "row" }} accessibilityElementsHidden>
        <View style={{ flex: 1, backgroundColor: "#CC0000" }} />
        <View style={{ flex: 1, backgroundColor: "#D4A017" }} />
        <View style={{ flex: 1, backgroundColor: "#006400" }} />
      </View>
      <View style={{ marginTop: 32, gap: 12 }}>
        <Text style={{ color: c.goldInk, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2 }}>ASHANTIHUB</Text>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 34, lineHeight: 38 }}>
          Akwaaba to Kumasi's verified marketplace
        </Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 16, lineHeight: 24 }}>
          Food, stays, tours and kente crafts from real, checked businesses. Pay safely and get help from AshantiHub
          Support.
        </Text>
      </View>
      <View style={{ marginTop: 32, gap: 12 }}>
        <Button label="I'm a customer: create account" onPress={() => router.push("/customer-sign-up")} />
        <Button variant="secondary" label="I'm a customer: sign in" onPress={() => router.push("/customer-sign-in")} />
        <Button variant="secondary" label="I own a business" onPress={() => router.push("/business-sign-in")} />
      </View>
    </Screen>
  );
}
