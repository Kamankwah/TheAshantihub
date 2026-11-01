import { Text, View } from "react-native";

import { useAuth } from "../../../state/auth";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { Pill } from "../../../ui/Pill";
import { Screen } from "../../../ui/Screen";

const NEXT = [
  "A field scout visits your business to check the details on the ground.",
  "You confirm your registration from a link we text you.",
  "Once verified, your listings go live for customers.",
];

export default function Submitted() {
  const { c } = useTheme();
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>
        Application received
      </Text>
      <Pill tone="warn" icon="clock" label="Pending review" />
      <View style={{ gap: 12 }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>What happens next</Text>
        {NEXT.map((line, i) => (
          <Text key={line} style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>{`${i + 1}. ${line}`}</Text>
        ))}
      </View>
      <Button variant="secondary" label="Sign out" onPress={() => void useAuth.getState().signOut()} />
    </Screen>
  );
}
