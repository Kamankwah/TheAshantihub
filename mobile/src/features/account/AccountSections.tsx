import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Platform, Pressable, Switch, Text, View } from "react-native";

import { biometrics } from "../../lib/biometrics";
import { useLock } from "../../state/lock";
import { usePrefs, type ThemePreference } from "../../state/prefs";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";

export function SectionTitle({ children }: { children: string }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16, marginTop: 8 }}>{children}</Text>;
}

/** A tappable row with a chevron. */
export function LinkRow({ label, onPress, hint }: { label: string; onPress: () => void; hint?: string }) {
  const { c, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={{ minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.surface, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, paddingHorizontal: 14 }}
    >
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{label}</Text>
      <Feather name="chevron-right" size={20} color={c.dim} />
    </Pressable>
  );
}

const THEMES: { key: ThemePreference; label: string }[] = [
  { key: "system", label: "Match my phone" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

/** Dark mode: follow the phone, or always light, or always dark. Remembered on this phone. */
export function AppearanceSection() {
  const { c, radius } = useTheme();
  const pref = usePrefs((s) => s.themePreference);
  const set = usePrefs((s) => s.setThemePreference);
  return (
    <View style={{ gap: 8 }}>
      <SectionTitle>Appearance</SectionTitle>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {THEMES.map((t) => {
          const on = pref === t.key;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="radio"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: on }}
              onPress={() => set(t.key)}
              style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: "center", borderRadius: radius.pill, borderWidth: on ? 2 : 1, borderColor: on ? c.ink : c.line, backgroundColor: c.surface }}
            >
              <Text style={{ color: c.ink, fontFamily: on ? fonts.bodyBold : fonts.body, fontSize: 14 }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Unlock with Face ID or a fingerprint. Only offered when this phone has one set up. */
export function BiometricRow() {
  const { c, radius } = useTheme();
  const enabled = useLock((s) => s.enabled);
  const setEnabled = useLock((s) => s.setEnabled);
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void biometrics.available().then(setAvailable);
  }, []);
  const label = Platform.OS === "ios" ? "Unlock with Face ID or Touch ID" : "Unlock with fingerprint or face";
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, padding: 14, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 }}>
        <Text style={{ flex: 1, color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{label}</Text>
        <Switch accessibilityLabel={label} value={enabled} disabled={available === false} onValueChange={(v) => void setEnabled(v)} />
      </View>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 }}>
        {available === false
          ? "Set up Face ID or a fingerprint in your phone’s settings to use this."
          : "AshantiHub asks for it when you come back after a minute away. If it doesn’t work you can sign in with your password."}
      </Text>
    </View>
  );
}
