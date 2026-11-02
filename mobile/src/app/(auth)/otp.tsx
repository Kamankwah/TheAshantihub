import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";

import { challengeParams, messageFor, otpSend, otpVerify } from "../../lib/authApi";
import { resumeRegistration } from "../../lib/registrationApi";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Screen } from "../../ui/Screen";

export default function Otp() {
  const { c } = useTheme();
  const { mfa_token, channels, kind, authenticator } = useLocalSearchParams<{ mfa_token: string; channels?: string; kind?: string; authenticator?: string }>();
  const app = authenticator === "1";
  const accountType = kind === "business_owner" ? "business_owner" : "customer";
  const channel = (channels ?? "sms").split(",")[0] || "sms";
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [hint, setHint] = useState<string>();
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send() {
    try {
      const sent = await otpSend({ mfa_token: String(mfa_token), channel });
      setHint(sent.hint);
      setWait(sent.resend_in ?? 60);
      setError(undefined);
    } catch (e) {
      setError(messageFor(e, "We couldn't send a code. Try again in a moment."));
    }
  }

  useEffect(() => {
    if (!app) void send(); // an authenticator app code is not sent: the app already has it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await otpVerify(recovery ? { mfa_token: String(mfa_token), recovery_code: recoveryCode.trim() } : { mfa_token: String(mfa_token), code }, accountType);
      if (result.kind === "signedIn") {
        await useAuth.getState().signIn(result.body);
        if (accountType === "business_owner") await resumeRegistration();
        else router.replace("/");
      } else {
        router.push({ pathname: "/otp", params: challengeParams(result.challenge, accountType === "business_owner" ? "business_owner" : undefined) });
      }
    } catch (e) {
      setError(messageFor(e, "That code is not right. Check it and try again."));
    } finally {
      setBusy(false);
    }
  }

  if (app) {
    return (
      <Screen>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>Enter the code from your authenticator app</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>
          {recovery ? "Type one of the recovery codes you saved when you turned the app on. Each works once." : "Open your authenticator app and type the 6-digit code it shows for AshantiHub."}
        </Text>
        {recovery ? (
          <Field label="Recovery code" value={recoveryCode} onChangeText={setRecoveryCode} autoCapitalize="none" autoCorrect={false} error={error} style={{ fontFamily: fonts.mono, fontSize: 18 }} />
        ) : (
          <Field
            label="6-digit code"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            error={error}
            style={{ fontFamily: fonts.mono, letterSpacing: 6, fontSize: 22 }}
          />
        )}
        <Button label="Verify" onPress={verify} loading={busy} disabled={recovery ? recoveryCode.trim().length < 8 : code.length !== 6} />
        <Pressable accessibilityRole="button" accessibilityLabel={recovery ? "Use the app code instead" : "Use a recovery code instead"} onPress={() => { setRecovery((r) => !r); setError(undefined); }} style={{ minHeight: 48, justifyContent: "center" }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, textAlign: "center", textDecorationLine: "underline" }}>{recovery ? "Use the app code instead" : "Use a recovery code instead"}</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>
        Enter your code
      </Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>
        {hint ? `We sent a 6-digit code to ${hint}.` : "We are sending you a 6-digit code."}
      </Text>
      <Field
        label="6-digit code"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        error={error}
        style={{ fontFamily: fonts.mono, letterSpacing: 6, fontSize: 22 }}
      />
      <Button label="Verify" onPress={verify} loading={busy} disabled={code.length !== 6} />
      <Pressable accessibilityRole="button" disabled={wait > 0} onPress={send} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ color: c.ink, opacity: wait > 0 ? 0.5 : 1, fontFamily: fonts.bodyBold, textAlign: "center", textDecorationLine: "underline" }}>
          {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
        </Text>
      </Pressable>
    </Screen>
  );
}
