import { Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";

/** "AshantiHub Support" with the "Re:" context line. The business is only ever the subject, never the recipient. */
export function SupportHeader({ subject }: { subject?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 26 }}>AshantiHub Support</Text>
      {subject ? (
        <View style={{ backgroundColor: c.well, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{`Re: ${subject}`}</Text>
        </View>
      ) : null}
    </View>
  );
}
