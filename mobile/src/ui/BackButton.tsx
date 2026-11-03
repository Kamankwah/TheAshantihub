import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable } from "react-native";

import { useTheme } from "../theme/useTheme";

/** The back arrow at the top of a pushed screen; goes to `fallback` when there is nothing to go back to. */
export function BackButton({ fallback = "/" }: { fallback?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
}
