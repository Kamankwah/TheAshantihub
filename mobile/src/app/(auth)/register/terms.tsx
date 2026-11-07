import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { blankWeek, fromDays, toDays, validateWeek, type Row } from "../../../features/business/hours";
import { HoursEditor } from "../../../features/business/HoursEditor";
import { RegistrationHeader } from "../../../features/business/RegistrationHeader";
import { api } from "../../../lib/api";
import { messageFor } from "../../../lib/authApi";
import { acceptTerms, getHours, resumeRegistration, saveHours } from "../../../lib/registrationApi";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { Screen } from "../../../ui/Screen";

type BusinessTerms = { version: string; text: string };
// The agreement is served by the API (accounts/business_terms.py), so the app can never show different words from the ones the
// server records the acceptance against (review MOB-17).
const getTerms = () => api<BusinessTerms>("/api/accounts/business-terms/", { auth: false });

export default function Terms() {
  const { c } = useTheme();
  const saved = useQuery({ queryKey: ["hours"], queryFn: getHours });
  const terms = useQuery({ queryKey: ["business-terms"], queryFn: getTerms, staleTime: 5 * 60_000 });
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
          {terms.data ? (
            <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 }}>{terms.data.text}</Text>
          ) : terms.isError ? (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>
                We couldn’t load the Business Agreement, so you can’t accept it yet.
              </Text>
              <Button variant="secondary" label="Try again" onPress={() => void terms.refetch()} />
            </View>
          ) : (
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Loading the Business Agreement…</Text>
          )}
        </ScrollView>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="I accept the Business Agreement"
        accessibilityState={{ checked: agree }}
        onPress={() => terms.data && setAgree(!agree)}
        style={{ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 48 }}
      >
        <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: c.ink, backgroundColor: agree ? c.gold : "transparent", alignItems: "center", justifyContent: "center" }}>
          {agree ? <Text style={{ color: c.onGold, fontFamily: fonts.bodyBold }}>✓</Text> : null}
        </View>
        <Text style={{ flex: 1, color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>I accept the Business Agreement</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{error}</Text> : null}
      <Button label="Submit for review" onPress={submit} loading={busy} disabled={!agree || !terms.data} />
    </Screen>
  );
}
