import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import { Pressable, Text } from "react-native";

import { LEGAL_DOCS, WEB_BASE } from "../../lib/config";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Screen } from "../../ui/Screen";

/** A legal page from the website, opened in the in-app browser. */
export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { c } = useTheme();
  const entry = LEGAL_DOCS[doc ?? ""];
  const url = entry ? `${WEB_BASE}${entry.path}` : null;
  useEffect(() => {
    if (url) void WebBrowser.openBrowserAsync(url);
  }, [url]);
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
        <Feather name="arrow-left" size={24} color={c.ink} />
      </Pressable>
      {entry && url ? (
        <>
          <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>{entry.title}</Text>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>This page opens in your browser inside the app.</Text>
          <Button label="Open again" onPress={() => void WebBrowser.openBrowserAsync(url)} />
        </>
      ) : (
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 16 }}>We couldn’t find that document.</Text>
      )}
    </Screen>
  );
}
