import { Text } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Screen } from "./Screen";

/** A tab whose feature arrives in a later update. Honest: it says so and shows nothing made up. */
export function ComingSoon({ title }: { title: string }) {
  const { c } = useTheme();
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>
        {title}
      </Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 16, lineHeight: 24 }}>This arrives in an update.</Text>
    </Screen>
  );
}
