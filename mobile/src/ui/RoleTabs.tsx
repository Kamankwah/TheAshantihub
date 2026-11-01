import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";

import { canEnter, type Tab } from "../lib/routing";
import { useAuth } from "../state/auth";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

/** The bottom tab bar for one area; sends anyone who does not belong there back to the front door. */
export function RoleTabs({ area, tabs }: { area: "customer" | "business"; tabs: Tab[] }) {
  const { c } = useTheme();
  const status = useAuth((s) => s.status);
  const type = useAuth((s) => s.account?.type);
  if (status === "loading") return null;
  if (!canEnter(area, status, type)) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.dim,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, minHeight: 64 },
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 12 },
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.label,
            tabBarAccessibilityLabel: t.label,
            tabBarIcon: ({ color, focused }) => (
              <View style={{ alignItems: "center", gap: 3 }}>
                <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: focused ? c.gold : "transparent" }} />
                <Feather name={t.icon} size={22} color={color as string} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
