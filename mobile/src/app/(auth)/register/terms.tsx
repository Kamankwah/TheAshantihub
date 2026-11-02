import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { blankWeek, fromDays, toDays, validateWeek, type Row } from "../../../features/business/hours";
import { HoursEditor } from "../../../features/business/HoursEditor";
import { RegistrationHeader } from "../../../features/business/RegistrationHeader";
import { messageFor } from "../../../lib/authApi";
import { acceptTerms, getHours, resumeRegistration, saveHours } from "../../../lib/registrationApi";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { Screen } from "../../../ui/Screen";

// The summary every business accepts (frontend/components/businessTerms.js, version "September 2026").
const TERMS = `AshantiHub Business Agreement (summary)

1. Listing Accuracy: Every listing you publish must accurately represent a real, operating business you own or are authorized to represent. Misleading names, prices, or photos may result in listing removal.

2. Customer Contact: For customer safety, all enquiries are routed through AshantiHub Support rather than direct to your phone or WhatsApp. You must not attempt to contact customers directly outside the platform, and must not use contact details obtained through AshantiHub for unrelated marketing.

3. Payout Terms: Payouts are made to the bank or mobile money account you provide. You are responsible for keeping these details accurate and up to date. A service fee may apply to processed payouts.

4. KYC Accuracy: The Ghana Card and business details you provide must be accurate and current. Misrepresentation is grounds for account suspension.

5. Suspension & Termination: AshantiHub may suspend or terminate a business account for fraudulent listings, repeated customer complaints, or violation of these terms.`;

export default function Terms() {
  const { c } = useTheme();
  const saved = useQuery({ queryKey: ["hours"], queryFn: getHours });
  const [rows, setRows] = useState<Row[]>(blankWeek());
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (saved.data?.has_hours) setRows(fromDays(saved.data.days));
  }, [saved.data]);

  async function submit() {
    const problem = validateWeek(rows);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    try {
      await saveHours(toDays(rows));
      await acceptTerms();
      await resumeRegistration();
    } catch (e) {
      setError(messageFor(e, "We couldn't submit your application. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <RegistrationHeader step={5} title="Opening hours and terms" back />
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>
        Orders placed outside these hours are delivered on your next opening day.
      </Text>
      <HoursEditor rows={rows} onChange={setRows} />
      <View style={{ maxHeight: 220, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14 }} accessibilityLabel="Business Agreement">
          <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 }}>{TERMS}</Text>
        </ScrollView>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="I accept the Business Agreement"
        accessibilityState={{ checked: agree }}
        onPress={() => setAgree(!agree)}
        style={{ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 48 }}
      >
        <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: c.ink, backgroundColor: agree ? c.gold : "transparent", alignItems: "center", justifyContent: "center" }}>
          {agree ? <Text style={{ color: c.onGold, fontFamily: fonts.bodyBold }}>✓</Text> : null}
        </View>
        <Text style={{ flex: 1, color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>I accept the Business Agreement</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{error}</Text> : null}
      <Button label="Submit for review" onPress={submit} loading={busy} disabled={!agree} />
    </Screen>
  );
}
