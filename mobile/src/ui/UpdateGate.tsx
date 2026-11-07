import type { ReactNode } from "react";
import { Linking, Text, View } from "react-native";

import { DEFAULT_STORE_URL } from "../lib/appVersion";
import { useUpdate } from "../state/update";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Button } from "./Button";

/** Shows the app, or an "update required" screen once the server has refused this build (review MOB-01). */
export function UpdateGate({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const { required, minVersion, storeUrl } = useUpdate();
  if (!required) return <>{children}</>;
  return (
    <View
      accessibilityViewIsModal
      style={{ flex: 1, backgroundColor: c.canvas, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}
    >
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28, textAlign: "center" }}>
        Please update AshantiHub
      </Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 16, textAlign: "center" }}>
        This version of the app is no longer supported{minVersion ? ` (version ${minVersion} or newer is needed)` : ""}. Update it from the store to keep
        shopping and selling.
      </Text>
      <View style={{ alignSelf: "stretch" }}>
        <Button label="Update now" onPress={() => void Linking.openURL(storeUrl || DEFAULT_STORE_URL)} />
      </View>
    </View>
  );
}
