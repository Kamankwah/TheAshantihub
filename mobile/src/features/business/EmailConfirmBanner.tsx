import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ApiError } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { resendEmailConfirmation, setOwnerEmail } from "../../lib/registrationApi";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import type { GoLive } from "./queries";

const RESEND_FAILED = "We couldn't send the link. Check your connection and try again.";
const SET_FAILED = "We couldn't save that address. Check your connection and try again.";
const EMAIL_LOOKS_RIGHT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const EMAIL_NEEDED = "Enter your email so we can send you a confirmation link.";

/**
 * Shown on the owner's home while the server's go-live rule still waits on the email address (`go_live.blockers`
 * holds `email_unconfirmed` or `email_missing`). A missing email shows an email field and "Send me a link"; an
 * unconfirmed one keeps Resend and a quiet "Wrong address? Change it" toggle that reveals the same field. "Sent to
 * <address>" names only an address the owner typed here; otherwise it says only that the link was sent. `onSaved`
 * runs once the server accepted the address (also on the daily limit, which still saved it) so home can refresh.
 */
export function EmailConfirmBanner({ goLive, onSaved }: { goLive?: GoLive; onSaved?: () => void }) {
  const { c, radius } = useTheme();
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [typed, setTyped] = useState("");
  const [changing, setChanging] = useState(false);
  const [accepted, setAccepted] = useState("");

  const blockers = Array.isArray(goLive?.blockers) ? goLive.blockers : [];
  const unconfirmed = blockers.find((b) => b?.code === "email_unconfirmed");
  const missing = blockers.find((b) => b?.code === "email_missing");
  // A rejected application is a different problem: the home screen says it needs changes, not "confirm your email".
  if (blockers.some((b) => b?.code === "kyc_rejected") || (!unconfirmed && !missing)) return null;

  const showForm = (!!missing && !unconfirmed && !accepted) || changing;

  async function resend() {
    setSending(true);
    setError(undefined);
    try {
      await resendEmailConfirmation();
      setSent(true);
    } catch (e) {
      setSent(false);
      setError(apiMessage(e, RESEND_FAILED));
    } finally {
      setSending(false);
    }
  }

  async function saveEmail() {
    const address = typed.trim();
    setError(undefined);
    if (!EMAIL_LOOKS_RIGHT.test(address)) {
      setSent(false);
      setError(EMAIL_NEEDED);
      return;
    }
    setSaving(true);
    try {
      await setOwnerEmail(address);
      setAccepted(address);
      setSent(true);
      setChanging(false);
      setTyped("");
      onSaved?.();
    } catch (e) {
      setSent(false);
      setError(apiMessage(e, SET_FAILED));
      // The daily limit still saved the new address: refresh so Resend can take over.
      if (e instanceof ApiError && e.status === 429 && (e.body as { code?: string } | null)?.code === "too_many_links") onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <View accessibilityLabel="Confirm your email" style={{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.orange, padding: 14, gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Confirm your email to publish listings</Text>
      {unconfirmed ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Open the link we emailed you. Can’t find it? Send a new one.</Text>
      ) : missing?.message ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{missing.message}</Text>
      ) : null}
      {showForm ? (
        <View style={{ gap: 8 }}>
          <Field label="Email address" value={typed} onChangeText={setTyped} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Button label="Send me a link" onPress={() => void saveEmail()} loading={saving} />
        </View>
      ) : null}
      {sent ? <Text accessibilityRole="alert" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{accepted ? `Sent to ${accepted}` : "Sent. Check your inbox (and your spam folder)."}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {unconfirmed ? <Button variant="secondary" label="Resend" onPress={() => void resend()} loading={sending} /> : null}
      {unconfirmed && !changing ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Wrong address? Change it" onPress={() => { setChanging(true); setSent(false); setError(undefined); }} style={{ minHeight: 48, justifyContent: "center" }}>
          <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 14, textDecorationLine: "underline" }}>Wrong address? Change it</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
