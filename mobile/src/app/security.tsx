import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text } from "react-native";

import { BiometricRow, LinkRow, SectionTitle } from "../features/account/AccountSections";
import { AuthenticatorSection } from "../features/account/Authenticator";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Screen } from "../ui/Screen";

/** Security: the app lock, what protects the account, and account deletion. */
export default function SecurityScreen() {
  const { c } = useTheme();
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
        <Feather name="arrow-left" size={24} color={c.ink} />
      </Pressable>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Security</Text>
      <SectionTitle>App lock</SectionTitle>
      <BiometricRow />
      <SectionTitle>Sign-in codes</SectionTitle>
      <AuthenticatorSection />
      <SectionTitle>How your account is protected</SectionTitle>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 }}>
        Your sign-in is kept in your phone’s secure storage, not in the app’s files. Screens that show ID photos and payout details can’t be screenshotted. Signing out removes the sign-in from this phone.
      </Text>
      <SectionTitle>Your data</SectionTitle>
      <LinkRow label="Delete my account" onPress={() => router.push("/delete-account" as never)} />
    </Screen>
  );
}
