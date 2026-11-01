import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text } from "react-native";

import { DeleteAccount } from "../features/account/DeleteAccount";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Screen } from "../ui/Screen";

/** Reachable from Security (customers) and More (businesses). */
export default function DeleteAccountScreen() {
  const { c } = useTheme();
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
        <Feather name="arrow-left" size={24} color={c.ink} />
      </Pressable>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Delete your account</Text>
      <DeleteAccount />
    </Screen>
  );
}
