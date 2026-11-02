import { router } from "expo-router";
import { Text, View } from "react-native";

import { AppearanceSection, LinkRow, SectionTitle } from "../../features/account/AccountSections";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Screen } from "../../ui/Screen";

export default function ScreenAccount() {
  const { c } = useTheme();
  const account = useAuth((s) => s.account);
  const signOut = useAuth((s) => s.signOut);
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Account</Text>
      <View style={{ gap: 2 }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 18 }}>{account?.fullName}</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Customer account</Text>
      </View>

      <SectionTitle>Your activity</SectionTitle>
      <View style={{ gap: 8 }}>
        <LinkRow label="My tickets" onPress={() => router.push("/tickets" as never)} />
      </View>

      <SectionTitle>Help</SectionTitle>
      <View style={{ gap: 8 }}>
        <LinkRow label="Messages" onPress={() => router.push("/inbox" as never)} />
        <LinkRow label="Notifications" onPress={() => router.push("/notifications" as never)} />
        <LinkRow label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about: "My account" } } as never)} />
      </View>

      <AppearanceSection />

      <SectionTitle>Privacy and security</SectionTitle>
      <View style={{ gap: 8 }}>
        <LinkRow label="Security" onPress={() => router.push("/security" as never)} />
        <LinkRow label="Terms of use" onPress={() => router.push("/legal/terms" as never)} />
        <LinkRow label="Privacy policy" onPress={() => router.push("/legal/privacy" as never)} />
      </View>

      <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
