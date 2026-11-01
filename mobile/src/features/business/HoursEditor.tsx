import { Pressable, Switch, Text, TextInput, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { copyMondayToWeekdays, DAY_NAMES, type Row } from "./hours";

type Props = { rows: Row[]; onChange: (rows: Row[]) => void };

/** Seven rows, Monday first: a Closed switch and HH:MM times. Nothing is pre-filled. */
export function HoursEditor({ rows, onChange }: Props) {
  const { c } = useTheme();
  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const time = (i: number, key: "opens" | "closes", label: string) => (
    <TextInput
      accessibilityLabel={`${DAY_NAMES[i]} ${label}`}
      value={rows[i][key]}
      onChangeText={(v) => set(i, { [key]: v.replace(/[^\d:]/g, "").slice(0, 5) })}
      placeholder={label === "opens" ? "08:00" : "18:00"}
      placeholderTextColor={c.dim}
      keyboardType="numbers-and-punctuation"
      style={{ width: 72, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, color: c.ink, textAlign: "center", fontFamily: fonts.body, fontSize: 16 }}
    />
  );
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row, i) => (
        <View key={DAY_NAMES[i]} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ width: 92, color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{DAY_NAMES[i]}</Text>
          {row.closed ? (
            <Text style={{ flex: 1, color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Closed</Text>
          ) : (
            <View style={{ flex: 1, flexDirection: "row", gap: 6, alignItems: "center" }}>
              {time(i, "opens", "opens")}
              <Text style={{ color: c.dim }}>–</Text>
              {time(i, "closes", "closes")}
            </View>
          )}
          <Switch accessibilityLabel={`${DAY_NAMES[i]} closed`} value={row.closed} onValueChange={(v) => set(i, { closed: v })} />
        </View>
      ))}
      <Pressable accessibilityRole="button" onPress={() => onChange(copyMondayToWeekdays(rows))} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, textDecorationLine: "underline" }}>Copy Monday to weekdays</Text>
      </Pressable>
    </View>
  );
}
