import { router } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import { RegistrationHeader } from "../../../features/business/RegistrationHeader";
import { messageFor } from "../../../lib/authApi";
import { ownerRegister, signInAndResume } from "../../../lib/registrationApi";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Screen } from "../../../ui/Screen";

export default function Personal() {
  const { c } = useTheme();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    const digits = phone.replace(/\D/g, "").replace(/^0/, "").replace(/^233/, "");
    try {
      const result = await ownerRegister({
        full_name: `${first.trim()} ${last.trim()}`.trim(),
        login_phone: `+233${digits}`,
        ...(email.trim() ? { email: email.trim() } : {}),
        password,
      });
      if (result.kind === "challenge") {
        router.push({
          pathname: "/otp",
          params: { mfa_token: result.challenge.mfa_token, channels: result.challenge.channels.join(","), kind: "business_owner" },
        });
      } else {
        await signInAndResume(result);
      }
    } catch (e) {
      const body = (e as { body?: Record<string, string[]> }).body ?? {};
      const pick = (k: string) => (Array.isArray(body[k]) ? body[k][0] : "");
      setErrors({
        login_phone: pick("login_phone"),
        email: pick("email"),
        password: pick("password"),
        form: pick("non_field_errors") || (Object.keys(body).length ? "" : messageFor(e, "We couldn't create your account. Try again.")),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <RegistrationHeader step={1} title="About you, the owner" back />
      <Field label="First name" value={first} onChangeText={setFirst} autoComplete="given-name" />
      <Field label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="20 788 6600" helper="Ghana numbers start with +233." error={errors.login_phone || undefined} />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email || undefined} />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password-new" textContentType="newPassword" helper="At least 8 characters." error={errors.password || undefined} />
      {errors.form ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{errors.form}</Text> : null}
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>Our team verifies every business before it goes live.</Text>
      <Button label="Continue" onPress={submit} loading={busy} disabled={!first || !phone || !password} />
    </Screen>
  );
}
