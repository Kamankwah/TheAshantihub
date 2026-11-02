import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { useFonts } from "expo-font";

export const fonts = {
  display: "Fraunces_600SemiBold",
  body: "PlusJakartaSans_400Regular",
  bodyMedium: "PlusJakartaSans_500Medium",
  bodySemi: "PlusJakartaSans_600SemiBold",
  bodyBold: "PlusJakartaSans_700Bold",
  mono: "JetBrainsMono_500Medium",
} as const;

/** True once Fraunces, Plus Jakarta Sans and JetBrains Mono are loaded. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    JetBrainsMono_500Medium,
  });
  return loaded || !!error; // never trap the user on the splash if a font fails
}
