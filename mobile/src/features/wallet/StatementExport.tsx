import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { CannotShare, exportStatement, PRESETS, type Preset } from "./statement";

/** Export your statement as a CSV for your accountant: choose how far back, then save or send the file. */
export function StatementExport() {
  const { c, radius } = useTheme();
  const [preset, setPreset] = useState<Preset>("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      await exportStatement(preset);
    } catch (e) {
      setError(e instanceof CannotShare ? e.message : apiMessage(e, "We couldn’t make the statement. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Statement</Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PRESETS.map((p) => (
          <Pressable
            key={p.key}
            accessibilityRole="radio"
            accessibilityLabel={p.label}
            accessibilityState={{ selected: preset === p.key }}
            onPress={() => setPreset(p.key)}
            style={{ minHeight: 48, borderRadius: radius.control, borderWidth: preset === p.key ? 2 : 1, borderColor: preset === p.key ? c.ink : c.line, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: "center" }}
          >
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      <Button variant="secondary" label="Export statement" onPress={() => void run()} loading={busy} />
    </View>
  );
}
