import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";

import { messageFor, otpSend, otpVerify } from "../../lib/authApi";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Screen } from "../../ui/Screen";

export default function Otp() {
  const { c } = useTheme();
  const { mfa_token, channels } = useLocalSearchParams<{ mfa_token: string; channels?: string }>();
  const channel = (channels ?? "sms").split(",")[0] || "sms";
  const [code, setCode] = useState("");
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
    void send();
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
      const result = await otpVerify({ mfa_token: String(mfa_token), code }, "customer");
      if (result.kind === "signedIn") {
        await useAuth.getState().signIn(result.body);
        router.replace("/");
      } else {
        router.push({ pathname: "/otp", params: { mfa_token: result.challenge.mfa_token, channels: result.challenge.channels.join(",") } });
      }
    } catch (e) {
      setError(messageFor(e, "That code is not right. Check it and try again."));
    } finally {
      setBusy(false);
    }
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
