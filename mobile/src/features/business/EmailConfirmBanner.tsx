import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ApiError } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { resendEmailConfirmation, setOwnerEmail } from "../../lib/registrationApi";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { CodeStep } from "../wallet/CodeStep";
import type { GoLive } from "./queries";

const RESEND_FAILED = "We couldn't send the link. Check your connection and try again.";
const SET_FAILED = "We couldn't save that address. Check your connection and try again.";
const EMAIL_LOOKS_RIGHT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const PASSWORD_NEEDED = "Enter your current password to continue.";
const CONFIRMED_ON_WEB = "Your email is already confirmed. To change it, sign in on the website and use Profile & Settings → Request a change.";
const EMAIL_NEEDED = "Enter your email so we can send you a confirmation link.";

/**
 * Shown on the owner's home while the server's go-live rule still waits on the email address (`go_live.blockers`
 * holds `email_unconfirmed` or `email_missing`). A missing email shows an email field and "Send me a link"; an
 * unconfirmed one keeps Resend and a quiet "Wrong address? Change it" toggle that reveals the same field. "Sent to
 * <address>" names only an address the owner typed here; otherwise it says only that the link was sent. `onSaved`
 * runs once the server accepted the address (also on the daily limit, which still saved it) so home can refresh.
 * The change needs the owner's current password and, when the server asks, a code (the shared CodeStep, action
 * contact_change). The password is held in state only until the request finishes (or, while the code is being
 * entered, until that request finishes or the owner goes back); it is never stored or logged. Nothing signs the
 * owner out here: the server revokes other phone sessions and the app asks for a sign-in when the token expires.
 */
type Effects = { signedOutPhone: boolean; payoutCooling: boolean };
type Problem = { field: "email" | "password" | "general"; text: string };

export function EmailConfirmBanner({ goLive, onSaved }: { goLive?: GoLive; onSaved?: () => void }) {
  const { c, radius } = useTheme();
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [problem, setProblem] = useState<Problem>();
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<"form" | "code">("form");
  const [changing, setChanging] = useState(false);
  const [accepted, setAccepted] = useState("");
  const [effects, setEffects] = useState<Effects>({ signedOutPhone: false, payoutCooling: false });
  // A code the server accepted stays good after a 400 (say, a taken address): kept for one corrected retry only,
  // and dropped on success, Back, Cancel, any other failure or unmount.
  const keptToken = useRef<string | null>(null);
  useEffect(() => () => { keptToken.current = null; }, []);

  const blockers = Array.isArray(goLive?.blockers) ? goLive.blockers : [];
  const unconfirmed = blockers.find((b) => b?.code === "email_unconfirmed");
  const missing = blockers.find((b) => b?.code === "email_missing");
  // A rejected application is a different problem: the home screen says it needs changes, not "confirm your email".
  if (blockers.some((b) => b?.code === "kyc_rejected") || (!unconfirmed && !missing)) return null;

  const showForm = (!!missing && !unconfirmed && !accepted) || changing;

  async function resend() {
    setSending(true);
    setError(undefined);
    setEffects({ signedOutPhone: false, payoutCooling: false });
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

  function problemFor(e: unknown): Problem {
    const body = e instanceof ApiError ? (e.body as { code?: string; email?: unknown } | null) : null;
    if (body?.code === "wrong_password") return { field: "password", text: apiMessage(e, "That password isn't right.") };
    if (body?.code === "email_confirmed") return { field: "general", text: CONFIRMED_ON_WEB };
    return { field: Array.isArray(body?.email) ? "email" : "general", text: apiMessage(e, SET_FAILED) };
  }

  /** Never throws. Returns true when it moved on to the code step (the password is kept for the one retry). */
  async function run(address: string, pw: string, token?: string, fresh = false): Promise<boolean> {
    try {
      const answer = await setOwnerEmail(address, pw, token);
      keptToken.current = null;
      setEffects({ signedOutPhone: answer?.side_effects?.signed_out_phone === true, payoutCooling: answer?.side_effects?.payout_cooling === true });
      setAccepted(address);
      setSent(true);
      setChanging(false);
      setTyped("");
      setStage("form");
      onSaved?.();
    } catch (e) {
      keptToken.current = null;
      if (!fresh && e instanceof ApiError && e.status === 403 && (e.body as { code?: string } | null)?.code === "step_up_required") {
        // No token, or the kept one has expired: ask for a code.
        setStage("code");
        return true;
      }
      // The server keeps a code alive through a refused address or password, so one corrected retry needs no new code.
      if (token && e instanceof ApiError && e.status === 400) keptToken.current = token;
      setSent(false);
      setStage("form");
      setProblem(problemFor(e));
      // The daily limit still saved the new address: refresh so Resend can take over.
      if (e instanceof ApiError && e.status === 429 && (e.body as { code?: string } | null)?.code === "too_many_links") onSaved?.();
    }
    return false;
  }

  async function saveEmail() {
    const address = typed.trim();
    setProblem(undefined);
    setError(undefined);
    if (!EMAIL_LOOKS_RIGHT.test(address)) {
      setSent(false);
      setProblem({ field: "email", text: EMAIL_NEEDED });
      return;
    }
    if (!password) {
      setSent(false);
      setProblem({ field: "password", text: PASSWORD_NEEDED });
      return;
    }
    setSaving(true);
    setEffects({ signedOutPhone: false, payoutCooling: false });
    const waitingForCode = await run(address, password, keptToken.current ?? undefined);
    // The password never outlives the request, unless the owner is still entering a code for it.
    if (!waitingForCode) setPassword("");
    setSaving(false);
  }

  async function confirmed(token: string) {
    await run(typed.trim(), password, token, true);
    setPassword("");
  }

  function closeForm() {
    keptToken.current = null;
    setChanging(false);
    setStage("form");
    setTyped("");
    setPassword("");
    setProblem(undefined);
  }

  const heading = <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Confirm your email to publish listings</Text>;
  const shell = { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.orange, padding: 14, gap: 8 } as const;

  if (showForm && stage === "code") {
    return (
      <View accessibilityLabel="Confirm your email" style={shell}>
        {heading}
        <CodeStep
          action="contact_change"
          onConfirmed={confirmed}
          onBack={() => { keptToken.current = null; setPassword(""); setStage("form"); }}
        />
      </View>
    );
  }

  return (
    <View accessibilityLabel="Confirm your email" style={shell}>
      {heading}
      {unconfirmed ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Open the link we emailed you. Can’t find it? Send a new one.</Text>
      ) : missing?.message ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{missing.message}</Text>
      ) : null}
      {showForm ? (
        <View style={{ gap: 8 }}>
          <Field label="Email address" value={typed} onChangeText={setTyped} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={problem?.field === "email" ? problem.text : undefined} />
          <Field
            label="Your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            error={problem?.field === "password" ? problem.text : undefined}
            helper="We ask for your password because this address can reset your account."
          />
          {problem?.field === "general" ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{problem.text}</Text> : null}
          <Button label="Send me a link" onPress={() => void saveEmail()} loading={saving} />
          {changing ? <Button variant="secondary" label="Cancel" onPress={closeForm} disabled={saving} /> : null}
        </View>
      ) : null}
      {sent ? <Text accessibilityRole="alert" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{accepted ? `Sent to ${accepted}` : "Sent. Check your inbox (and your spam folder)."}</Text> : null}
      {sent && effects.signedOutPhone ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>You will be asked to sign in again on your phone.</Text> : null}
      {sent && effects.payoutCooling ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>For your safety, payout accounts wait a short cooling period again before withdrawals.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {unconfirmed ? <Button variant="secondary" label="Resend" onPress={() => void resend()} loading={sending} /> : null}
      {unconfirmed && !changing ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Wrong address? Change it" onPress={() => { setChanging(true); setSent(false); setError(undefined); setProblem(undefined); }} style={{ minHeight: 48, justifyContent: "center" }}>
          <Text style={{ color: c.dim, fontFamily: fonts.bodySemi, fontSize: 14, textDecorationLine: "underline" }}>Wrong address? Change it</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
