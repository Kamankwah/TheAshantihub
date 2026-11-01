import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { messageFor } from "../../lib/authApi";
import { ownerLogin, signInAndResume } from "../../lib/registrationApi";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Screen } from "../../ui/Screen";

export default function BusinessSignIn() {
  const { c } = useTheme();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await ownerLogin({ identifier: identifier.trim(), password });
      if (result.kind === "challenge") {
        router.push({
          pathname: "/otp",
          params: { mfa_token: result.challenge.mfa_token, channels: result.challenge.channels.join(","), kind: "business_owner" },
        });
      } else {
        await signInAndResume(result);
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(
        status === 400 || status === 401
          ? "That phone, email or password is not right."
          : messageFor(e, "We couldn't sign you in. Check your connection and try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ alignSelf: "flex-start", borderRadius: 999, backgroundColor: c.lightGold, paddingHorizontal: 12, paddingVertical: 4 }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 12 }}>Business</Text>
      </View>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>
        Sign in to your store
      </Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>Manage orders, listings and your money.</Text>
      <Field label="Phone or email" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoComplete="username" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" error={error} />
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>
        For your safety we may ask for a one-time code when you sign in, and before you withdraw or change payout numbers.
      </Text>
      <Button label="Sign in" onPress={submit} loading={busy} disabled={!identifier || !password} />
      <Pressable accessibilityRole="link" onPress={() => router.push("/register/personal")} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, textDecorationLine: "underline", textAlign: "center" }}>Register your business</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => router.push("/customer-sign-in")} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, textAlign: "center" }}>Customer? Sign in here</Text>
      </Pressable>
    </Screen>
  );
}
