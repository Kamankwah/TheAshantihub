import { Text, TextInput, type TextInputProps, View } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

type Props = TextInputProps & { label: string; error?: string; helper?: string };

/** A labelled input: the label is always visible, the error sits under the field. */
export function Field({ label, error, helper, style, ...input }: Props) {
  const { c, radius } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.dim}
        {...input}
        style={[
          {
            minHeight: 48,
            borderRadius: radius.control,
            borderWidth: error ? 2 : 1,
            borderColor: error ? c.red : c.line,
            backgroundColor: c.surface,
            color: c.ink,
            fontFamily: fonts.body,
            fontSize: 16,
            paddingHorizontal: 14,
          },
          style,
        ]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{helper}</Text>
      ) : null}
    </View>
  );
}
