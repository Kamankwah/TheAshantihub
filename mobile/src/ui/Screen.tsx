import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../theme/useTheme";

/** A screen on the cream canvas, inside the safe areas. Scrollbars are always hidden; people swipe. */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, gap: 16 }}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: 20, gap: 16 }}>{children}</View>
      )}
    </SafeAreaView>
  );
}
