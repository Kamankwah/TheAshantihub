import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { api, ApiError } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";

type Props = {
  /** The step-up action the server asks a code for ("withdrawal", "payout_destination"). */
  action: string;
  /** Runs the change with the one-time token. Throw to show the reason here; the token is kept for a retry. */
  onConfirmed: (token: string) => Promise<void>;
  onBack: () => void;
};

/**
 * "Confirm it's you": sends a code (text first, email if no text can go), checks it, and hands the one-time token to
 * `onConfirmed`. Moving money or changing where it is paid always asks for this while wallets are on.
 */
export function CodeStep({ action, onConfirmed, onBack }: Props) {
  const { c } = useTheme();
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [sending, setSending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const go = (channel: string) => api<{ hint?: string }>("/api/otp/step-up/send/", { body: { action, channel } });
      const sent = await go("sms").catch(() => go("email"));
      if (mounted.current) setHint(sent?.hint ?? null);
    } catch (e) {
      if (mounted.current) setError(apiMessage(e, "We couldn’t send you a code. Try again in a moment, or contact Support."));
    } finally {
      if (mounted.current) setSending(false);
    }
  }
  useEffect(() => {
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (!token.current) {
        const v = await api<{ step_up_token: string }>("/api/otp/step-up/verify/", { body: { action, code: code.trim() } });
        token.current = v.step_up_token;
      }
      await onConfirmed(token.current);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && (e.body as { code?: string } | undefined)?.code === "step_up_required") {
        token.current = null;
        setCode("");
        setError("That code has expired. We’re sending you a new one.");
        void send();
      } else {
        setError(apiMessage(e, "That didn’t work. Check the code and try again."));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>
        {sending ? "Sending you a code…" : hint ? `We sent a code to ${hint}. Enter it to confirm it is you.` : "Enter the code we sent you to confirm it is you."}
      </Text>
      <Field
        label="Code we sent you"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
      />
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      <Button label="Confirm" onPress={() => void confirm()} loading={busy} disabled={code.trim().length < 4} />
      <Button variant="secondary" label="Back" onPress={onBack} disabled={busy} />
    </View>
  );
}
