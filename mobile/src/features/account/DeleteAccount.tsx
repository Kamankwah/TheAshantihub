import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { api, ApiError } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { reasonText } from "./deletion";

const ERASED = "Your name, phone number, email, password, profile details, addresses, saved payout numbers and your sign-in on every phone. For businesses also the Ghana Card images, signboard photo and your listings.";
const KEPT = "Order, payment, refund and withdrawal records, kept for as long as tax and accounting law require and no longer linked to your name where the law allows. Records of disputes. Your consent records. Reviews may stay without your name.";

/** Delete my account: password first, a code when the server asks for one, then sign out. Works for both account types. */
export function DeleteAccount() {
  const { c } = useTheme();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ reasons: string[]; orderIds: number[] } | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  async function finish(token?: string) {
    await api("/api/accounts/me/delete/", { body: { password }, ...(token ? { headers: { "X-Step-Up-Token": token } } : {}) });
    await useAuth.getState().signOut();
  }

  async function submit() {
    setBusy(true);
    setPasswordError(null);
    setError(null);
    setBlocked(null);
    try {
      await finish();
    } catch (e) {
      if (e instanceof ApiError) {
        const body = (e.body ?? {}) as { code?: string; detail?: string; reasons?: string[]; order_ids?: number[] };
        if (body.code === "wrong_password") setPasswordError(body.detail ?? "That password is not right.");
        else if (body.code === "deletion_blocked") setBlocked({ reasons: body.reasons ?? [], orderIds: body.order_ids ?? [] });
        else if (body.code === "step_up_required") {
          try {
            const send = (channel: string) => api<{ hint?: string }>("/api/otp/step-up/send/", { body: { action: "account_delete", channel } });
            const sent = await send("sms").catch(() => send("email"));
            setHint(sent?.hint ?? null);
            setStepUp(true);
          } catch (e2) {
            setError(apiMessage(e2, "We couldn’t send you a code. Try again, or contact Support."));
          }
        } else setError(apiMessage(e, "We couldn’t delete your account. Try again."));
      } else setError("We couldn’t delete your account. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithCode() {
    setBusy(true);
    setError(null);
    try {
      const v = await api<{ step_up_token: string }>("/api/otp/step-up/verify/", { body: { action: "account_delete", code: code.trim() } });
      await finish(v.step_up_token);
    } catch (e) {
      setError(apiMessage(e, "That code didn’t work. Check it and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>What we erase</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{ERASED}</Text>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16, marginTop: 8 }}>What we must keep</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{KEPT}</Text>
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14, marginTop: 8 }}>Deleting your account can’t be undone.</Text>
      </View>

      {blocked ? (
        <View accessibilityRole="alert" style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 8 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>We can’t delete your account yet</Text>
          {blocked.reasons.map((r) => (
            <Text key={r} style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{reasonText(r)}</Text>
          ))}
          {blocked.orderIds.length > 0 ? (
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Orders ${blocked.orderIds.map((n) => `#${n}`).join(", ")}`}</Text>
          ) : null}
          <Button variant="secondary" label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about: "Deleting my account" } } as never)} />
        </View>
      ) : null}

      <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" error={passwordError ?? undefined} editable={!stepUp} />

      {stepUp ? (
        <View style={{ gap: 12 }}>
          <Field label="Code we sent you" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" helper={hint ? `Sent to ${hint}` : "We sent you a code."} />
          <Button variant="destructive" label="Confirm and delete" onPress={() => void confirmWithCode()} loading={busy} disabled={code.trim().length < 4} />
        </View>
      ) : (
        <Button variant="destructive" label="Delete my account" onPress={() => void submit()} loading={busy} disabled={password.length === 0} />
      )}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
    </View>
  );
}
