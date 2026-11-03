import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";

/** "Report a problem" for something paid: a reason of 5+ characters, posted once. Support settles it and the payment stays on hold. */
export function ReportForm({ path, onDone, onBack }: { path: string; onDone: () => void; onBack: () => void }) {
  const { c } = useTheme();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function send() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api(path, { body: { reason: reason.trim() } });
      onDone();
    } catch (e) {
      setError(apiMessage(e, "We couldn’t send the report. Nothing was changed."));
      inFlight.current = false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Field label="What went wrong?" value={reason} onChangeText={setReason} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 80, paddingTop: 10 }} />
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{error}</Text> : null}
      <Button variant="destructive" label="Send report" onPress={send} loading={busy} disabled={reason.trim().length < 5} />
      <Button variant="secondary" label="Back" onPress={onBack} disabled={busy} />
    </View>
  );
}
