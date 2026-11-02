import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";

import { HoursEditor } from "../../features/business/HoursEditor";
import { blankWeek, fromDays, toDays, validateWeek, type Row } from "../../features/business/hours";
import { apiMessage } from "../../lib/errors";
import { getHours, saveHours } from "../../lib/registrationApi";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Screen } from "../../ui/Screen";

/** Opening hours: every weekday needs times or "Closed". Saved as a whole week. */
export default function HoursScreen() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["owner-hours"], queryFn: getHours });
  const [rows, setRows] = useState<Row[]>(blankWeek());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (saved.data?.has_hours) setRows(fromDays(saved.data.days));
  }, [saved.data]);

  async function save() {
    const problem = validateWeek(rows);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveHours(toDays(rows));
      await qc.invalidateQueries({ queryKey: ["owner-hours"] });
      setDone(true);
    } catch (e) {
      setError(apiMessage(e, "We couldn’t save your hours. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/business/more" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
        <Feather name="arrow-left" size={24} color={c.ink} />
      </Pressable>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Opening hours</Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>Orders placed outside these hours are delivered on your next opening day. Use 24-hour times like 08:00 and 18:00.</Text>
      <HoursEditor rows={rows} onChange={(r) => { setRows(r); setDone(false); }} />
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {done ? <Text accessibilityLiveRegion="polite" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>Opening hours saved.</Text> : null}
      <Button label="Save opening hours" onPress={() => void save()} loading={busy} />
    </Screen>
  );
}
