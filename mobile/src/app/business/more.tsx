import { router } from "expo-router";
import { Text, View } from "react-native";

import { AppearanceSection, LinkRow, SectionTitle } from "../../features/account/AccountSections";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Screen } from "../../ui/Screen";

export default function BusinessMore() {
  const { c } = useTheme();
  const account = useAuth((s) => s.account);
  const signOut = useAuth((s) => s.signOut);
  const go = (path: string) => () => router.push(path as never);
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>More</Text>
      <View style={{ gap: 2 }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 18 }}>{account?.fullName}</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Business account</Text>
      </View>
      <SectionTitle>Your business</SectionTitle>
      <View style={{ gap: 8 }}>
        <LinkRow label="Your events" onPress={go("/manage/events")} />
        <LinkRow label="Opening hours" onPress={go("/manage/hours")} />
        <LinkRow label="Verification" onPress={go("/manage/verification")} />
      </View>
      <SectionTitle>Help</SectionTitle>
      <View style={{ gap: 8 }}>
        <LinkRow label="Messages" onPress={go("/inbox")} />
        <LinkRow label="Notifications" onPress={go("/notifications")} />
        <LinkRow label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about: "My business" } } as never)} />
      </View>
      <AppearanceSection />
      <SectionTitle>Privacy and security</SectionTitle>
      <View style={{ gap: 8 }}>
        <LinkRow label="Security" onPress={go("/security")} />
        <LinkRow label="Terms of use" onPress={go("/legal/terms")} />
        <LinkRow label="Privacy policy" onPress={go("/legal/privacy")} />
        <LinkRow label="Business agreement" onPress={go("/legal/business-agreement")} />
        <LinkRow label="Delete my account" onPress={go("/delete-account")} />
      </View>
      <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
