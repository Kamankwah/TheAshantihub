import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { Linking, Share, Text, View } from "react-native";

import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Skeleton } from "../../ui/Skeleton";
import { QrView } from "../tickets/TicketQr";
import { CodeStep } from "../wallet/CodeStep";

type Status = { enabled: boolean; enabled_at: string | null; recovery_codes_left: number; available: boolean };
const ACTION = "authenticator_change";
const stepUp = (token: string) => ({ headers: { "X-Step-Up-Token": token } });

/** Keeps the secret off screenshots and screen recordings while it is on screen. */
function NoCapture() {
  usePreventScreenCapture();
  return null;
}

type Stage =
  | { name: "status" }
  | { name: "code"; then: "setup" | "codes" | "disable" }
  | { name: "warn-off" }
  | { name: "scan"; secret: string; uri: string }
  | { name: "codes"; codes: string[] };

/** Authenticator app: a second code from an app on this phone at sign-in. Always asks for a texted code to change it. */
export function AuthenticatorSection() {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["authenticator"], retry: false, queryFn: () => api<Status>("/api/otp/authenticator/") });
  const [stage, setStage] = useState<Stage>({ name: "status" });
  const [first, setFirst] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dim = { color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 } as const;
  const done = () => { setStage({ name: "status" }); setFirst(""); setError(null); void qc.invalidateQueries({ queryKey: ["authenticator"] }); };

  async function afterStepUp(token: string, then: "setup" | "codes" | "disable") {
    if (then === "setup") {
      const r = await api<{ secret: string; otpauth_uri: string }>("/api/otp/authenticator/setup/", { body: {}, ...stepUp(token) });
      setStage({ name: "scan", secret: r.secret, uri: r.otpauth_uri });
    } else if (then === "codes") {
      const r = await api<{ recovery_codes: string[] }>("/api/otp/authenticator/recovery-codes/", { body: {}, ...stepUp(token) });
      setStage({ name: "codes", codes: r.recovery_codes });
    } else {
      await api("/api/otp/authenticator/disable/", { body: {}, ...stepUp(token) });
      done();
    }
  }

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recovery_codes: string[] }>("/api/otp/authenticator/setup/confirm/", { body: { code: first.trim() } });
      setStage({ name: "codes", codes: r.recovery_codes });
    } catch (e) {
      setError(apiMessage(e, "That code didn’t work. Check the app shows AshantiHub and try again."));
    } finally {
      setBusy(false);
    }
  }

  if (stage.name === "code") {
    return <CodeStep action={ACTION} onConfirmed={(token) => afterStepUp(token, stage.then)} onBack={() => setStage({ name: "status" })} />;
  }
  if (stage.name === "scan") {
    return (
      <View style={{ gap: 12 }}>
        <NoCapture />
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Add AshantiHub to your authenticator app</Text>
        <Text style={dim}>On this phone, tap the button. Or scan the picture with the app on another phone, or type the key by hand.</Text>
        <Button variant="secondary" label="Open in my authenticator app" onPress={() => void Linking.openURL(stage.uri).catch(() => setError("No authenticator app opened. Install one, or type the key by hand."))} />
        <View style={{ alignItems: "center" }}><QrView value={stage.uri} size={200} label="QR code for your authenticator app" /></View>
        <View style={{ backgroundColor: c.well, borderRadius: radius.control, padding: 12, gap: 4 }}>
          <Text style={dim}>Key to type by hand</Text>
          <Text selectable style={{ color: c.ink, fontFamily: fonts.mono, fontSize: 16, letterSpacing: 1 }}>{stage.secret}</Text>
        </View>
        <Field label="Code from your app" value={first} onChangeText={(v) => setFirst(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} error={error ?? undefined} style={{ fontFamily: fonts.mono, letterSpacing: 6, fontSize: 22 }} />
        <Button label="Turn it on" onPress={() => void turnOn()} loading={busy} disabled={first.length !== 6} />
        <Button variant="secondary" label="Cancel" onPress={done} disabled={busy} />
      </View>
    );
  }
  if (stage.name === "codes") {
    return (
      <View style={{ gap: 12 }}>
        <NoCapture />
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Your recovery codes</Text>
        <Text style={dim}>These are shown only once. Each works one time if you lose your phone. Keep them somewhere safe, not on this phone alone.</Text>
        <View style={{ backgroundColor: c.well, borderRadius: radius.control, padding: 14, gap: 6 }}>
          {stage.codes.map((code) => <Text key={code} selectable style={{ color: c.ink, fontFamily: fonts.mono, fontSize: 17 }}>{code}</Text>)}
        </View>
        <Button variant="secondary" label="Save or share my recovery codes" onPress={() => void Share.share({ message: `AshantiHub recovery codes (each works once):\n${stage.codes.join("\n")}` })} />
        <Button label="I have saved them" onPress={done} />
      </View>
    );
  }
  if (stage.name === "warn-off") {
    return (
      <View style={{ gap: 12 }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 22 }}>Your account will be protected by a password only, plus any code we text you. Turn it off?</Text>
        <Button variant="destructive" label="Yes, turn it off" onPress={() => setStage({ name: "code", then: "disable" })} />
        <Button variant="secondary" label="Keep it on" onPress={() => setStage({ name: "status" })} />
      </View>
    );
  }

  if (status.isPending) return <Skeleton height={80} />;
  if (status.isError || !status.data) return <Button variant="secondary" label="Try again" onPress={() => void status.refetch()} />;
  const s = status.data;
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{s.enabled ? "Authenticator app is on" : "Authenticator app is off"}</Text>
      <Text style={dim}>
        {s.enabled
          ? `Signing in asks for a code from your app. ${s.recovery_codes_left} recovery ${s.recovery_codes_left === 1 ? "code" : "codes"} left.`
          : "Add a code from an app on your phone to sign-in, for extra safety."}
      </Text>
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {s.enabled ? (
        <View style={{ gap: 8 }}>
          <Button variant="secondary" label="Get new recovery codes" onPress={() => setStage({ name: "code", then: "codes" })} />
          <Button variant="destructive" label="Turn off authenticator app" onPress={() => setStage({ name: "warn-off" })} />
        </View>
      ) : (
        <Button label="Turn on authenticator app" onPress={() => setStage({ name: "code", then: "setup" })} />
      )}
    </View>
  );
}
