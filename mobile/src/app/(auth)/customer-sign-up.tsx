import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { customerRegister, messageFor, challengeParams } from "../../lib/authApi";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Screen } from "../../ui/Screen";

function Check({ checked, onToggle, label, children }: { checked: boolean; onToggle: () => void; label: string; children?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", minHeight: 48 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: c.ink,
          backgroundColor: checked ? c.gold : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Text style={{ color: c.onGold, fontFamily: fonts.bodyBold }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{children ?? label}</Text>
    </Pressable>
  );
}


export default function CustomerSignUp() {
  const { c } = useTheme();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!terms) {
      setErrors({ terms: "Please accept the Terms and Privacy Policy to continue." });
      return;
    }
    setBusy(true);
    setErrors({});
    const digits = phone.replace(/\D/g, "").replace(/^0/, "").replace(/^233/, "");
    try {
      const result = await customerRegister({
        full_name: fullName.trim(),
        phone: `+233${digits}`,
        ...(email.trim() ? { email: email.trim() } : {}),
        password,
        ...(marketing ? { marketing_consent: { sms: true, email: true } } : {}),
      });
      if (result.kind === "challenge") {
        router.push({
          pathname: "/otp",
          params: challengeParams(result.challenge),
        });
      } else {
        await useAuth.getState().signIn(result.body);
        router.replace("/");
      }
    } catch (e) {
      const body = (e as { body?: Record<string, string[]> }).body ?? {};
      const pick = (k: string) => (Array.isArray(body[k]) ? body[k][0] : undefined);
      setErrors({
        full_name: pick("full_name") ?? "",
        phone: pick("phone") ?? "",
        email: pick("email") ?? "",
        password: pick("password") ?? "",
        form: pick("non_field_errors") ?? (Object.keys(body).length ? "" : messageFor(e, "We couldn't create your account. Try again.")),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>
        Create your account
      </Text>
      <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" textContentType="name" error={errors.full_name || undefined} />
      <Field
        label="Mobile number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="24 123 4567"
        helper="Ghana numbers start with +233."
        error={errors.phone || undefined}
      />
      <Field label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email || undefined} />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password-new"
        textContentType="newPassword"
        helper="At least 8 characters."
        error={errors.password || undefined}
      />
      <Check checked={terms} onToggle={() => setTerms(!terms)} label="I agree to the Terms and Privacy Policy">
        I agree to the{" "}
        <Text style={{ textDecorationLine: "underline" }} onPress={() => router.push("/legal/terms" as never)}>
          Terms
        </Text>{" "}
        and{" "}
        <Text style={{ textDecorationLine: "underline" }} onPress={() => router.push("/legal/privacy" as never)}>
          Privacy Policy
        </Text>
      </Check>
      {errors.terms ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{errors.terms}</Text> : null}
      <Check checked={marketing} onToggle={() => setMarketing(!marketing)} label="Send me offers and news from AshantiHub (marketing, optional)" />
      {errors.form ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{errors.form}</Text> : null}
      <Button label="Create account" onPress={submit} loading={busy} disabled={!fullName || !phone || !password} />
      <Pressable accessibilityRole="link" onPress={() => router.push("/customer-sign-in")} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, textDecorationLine: "underline", textAlign: "center" }}>
          Already have an account? Sign in
        </Text>
      </Pressable>
    </Screen>
  );
}
