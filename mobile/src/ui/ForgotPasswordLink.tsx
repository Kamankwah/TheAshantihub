import * as WebBrowser from "expo-web-browser";
import { Pressable, Text } from "react-native";

import { WEB_BASE } from "../lib/config";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

/** Password reset lives on the web (the reset form opens from `/?auth=forgot`); the app has no reset screen of its own. */
export const FORGOT_PASSWORD_URL = `${WEB_BASE}/?auth=forgot`;

export function ForgotPasswordLink() {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => void WebBrowser.openBrowserAsync(FORGOT_PASSWORD_URL)}
      style={{ minHeight: 48, justifyContent: "center" }}
    >
      <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, textDecorationLine: "underline", textAlign: "center" }}>
        Forgot password?
      </Text>
    </Pressable>
  );
}
