import { Text, View } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Button } from "./Button";

type Props = { title: string; body?: string; action?: { label: string; onPress: () => void } };

/** An honest empty or error state: say what is missing, offer the next step. */
export function EmptyState({ title, body, action }: Props) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: "center", gap: 8, padding: 24 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 20, textAlign: "center" }}>
        {title}
      </Text>
      {body ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15, textAlign: "center" }}>{body}</Text> : null}
      {action ? (
        <View style={{ alignSelf: "stretch", marginTop: 8 }}>
          <Button variant="secondary" label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
