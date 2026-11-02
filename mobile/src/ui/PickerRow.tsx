import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Sheet } from "./Sheet";

export type PickerOption<T> = { value: T; label: string; hint?: string };

/** A labelled row that opens a sheet of options; the chosen one is shown on the row. */
export function PickerRow<T extends string | number>({ label, placeholder, options, value, onChange, disabled }: {
  label: string; placeholder: string; options: PickerOption<T>[]; value: T | null; onChange: (v: T) => void; disabled?: boolean;
}) {
  const { c, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: chosen?.label ?? placeholder }}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{ minHeight: 48, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, opacity: disabled ? 0.5 : 1 }}
      >
        <Text numberOfLines={1} style={{ flex: 1, color: chosen ? c.ink : c.dim, fontFamily: fonts.body, fontSize: 16 }}>{chosen?.label ?? placeholder}</Text>
        <Feather name="chevron-down" size={20} color={c.dim} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
          {options.map((o) => (
            <Pressable
              key={String(o.value)}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: o.value === value }}
              onPress={() => { onChange(o.value); setOpen(false); }}
              style={{ minHeight: 48, borderRadius: radius.control, borderWidth: o.value === value ? 2 : 1, borderColor: o.value === value ? c.ink : c.line, padding: 12, justifyContent: "center" }}
            >
              <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{o.label}</Text>
              {o.hint ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{o.hint}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/** Two or three radio-style choices on one row (for example Yes / No). */
export function ChoiceRow<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { c, radius } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{label}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={`${label.replace(/\s*\*$/, "")}: ${o.label}`}
            accessibilityState={{ selected: o.value === value }}
            onPress={() => onChange(o.value)}
            style={{ minHeight: 48, borderRadius: radius.control, borderWidth: o.value === value ? 2 : 1, borderColor: o.value === value ? c.ink : c.line, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: "center" }}
          >
            <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
