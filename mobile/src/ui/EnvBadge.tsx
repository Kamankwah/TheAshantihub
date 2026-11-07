import { Text, View } from "react-native";

import { API_BASE, IS_NON_PRODUCTION } from "../lib/config";

/** A small corner label on every build that is not pointed at the live API, so a test build is never mistaken for the real app. */
export function EnvBadge() {
  if (!IS_NON_PRODUCTION) return null;
  const label = API_BASE.includes("api-test") ? "ENV: staging" : "ENV: dev";
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", left: 6, bottom: 6, zIndex: 9999 }}>
      <Text style={{ backgroundColor: "#B45309", color: "#FFFFFF", fontSize: 10, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" }}>
        {label}
      </Text>
    </View>
  );
}
