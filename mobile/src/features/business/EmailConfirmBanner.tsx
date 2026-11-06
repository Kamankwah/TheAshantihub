import { useState } from "react";
import { Text, View } from "react-native";

import { apiMessage } from "../../lib/errors";
import { resendEmailConfirmation } from "../../lib/registrationApi";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import type { GoLive } from "./queries";

const RESEND_FAILED = "We couldn't send the link. Check your connection and try again.";

/**
 * Shown on the owner's home while the server's go-live rule still waits on the email address (`go_live.blockers`
 * holds `email_unconfirmed` or `email_missing`). Resend asks the server to mail a fresh link. A missing email has
 * nothing to send to, so it shows the server's own sentence and no Resend. The address is never read back, so the
 * confirmation says only that the link was sent.
 */
export function EmailConfirmBanner({ goLive }: { goLive?: GoLive }) {
  const { c, radius } = useTheme();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  const blockers = Array.isArray(goLive?.blockers) ? goLive.blockers : [];
  const unconfirmed = blockers.find((b) => b?.code === "email_unconfirmed");
  const missing = blockers.find((b) => b?.code === "email_missing");
  if (!unconfirmed && !missing) return null;

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

  return (
    <View accessibilityLabel="Confirm your email" style={{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.orange, padding: 14, gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Confirm your email to publish listings</Text>
      {unconfirmed ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Open the link we emailed you. Can’t find it? Send a new one.</Text>
      ) : missing?.message ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{missing.message}</Text>
      ) : null}
      {sent ? <Text accessibilityRole="alert" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>Sent. Check your inbox (and your spam folder).</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {unconfirmed ? <Button variant="secondary" label="Resend" onPress={() => void resend()} loading={sending} /> : null}
    </View>
  );
}
