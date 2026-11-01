import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text } from "react-native";

import { customerLogin, messageFor } from "../../lib/authApi";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Screen } from "../../ui/Screen";

export default function CustomerSignIn() {
  const { c } = useTheme();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await customerLogin({ identifier: identifier.trim(), password });
      if (result.kind === "challenge") {
        router.push({
          pathname: "/otp",
          params: { mfa_token: result.challenge.mfa_token, channels: result.challenge.channels.join(",") },
        });
      } else {
        await useAuth.getState().signIn(result.body);
        router.replace("/");
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
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>
        Sign in
      </Text>
      <Field
        label="Phone or email"
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoComplete="username"
        keyboardType="email-address"
        placeholder="+233 24 123 4567 or you@example.com"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        error={error}
      />
      <Button label="Sign in" onPress={submit} loading={busy} disabled={!identifier || !password} />
      <Pressable accessibilityRole="link" onPress={() => router.push("/customer-sign-up")} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, textDecorationLine: "underline", textAlign: "center" }}>
          New here? Create an account
        </Text>
      </Pressable>
    </Screen>
  );
}
