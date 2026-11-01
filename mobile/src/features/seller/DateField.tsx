import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Platform, Pressable, Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

type Props = { label: string; value: Date; minimum: Date; onChange: (d: Date) => void };

/** A date the person picks with the phone's own picker. */
export function DateField({ label, value, minimum, onChange }: Props) {
  const { c, radius } = useTheme();
  const text = value.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{label}</Text>
      {Platform.OS === "ios" ? (
        <View style={{ alignItems: "flex-start" }}>
          <DateTimePicker accessibilityLabel={label} mode="date" display="compact" value={value} minimumDate={minimum} onChange={(_e, d) => d && onChange(d)} />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${text}. Change`}
          onPress={() => DateTimePickerAndroid.open({ mode: "date", value, minimumDate: minimum, onChange: (_e, d) => d && onChange(d) })}
          style={{ minHeight: 48, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, justifyContent: "center", paddingHorizontal: 14 }}
        >
          <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 16 }}>{text}</Text>
        </Pressable>
      )}
    </View>
  );
}
