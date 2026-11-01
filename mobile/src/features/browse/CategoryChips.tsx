import { FlatList, Pressable, Text } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import type { Department } from "./types";

type Props = { departments: Department[]; selected?: string; onSelect: (slug?: string) => void };

/** A fixed-height, swipeable row of department chips (no scrollbar), "All" first. */
export function CategoryChips({ departments, selected, onSelect }: Props) {
  const { c } = useTheme();
  const items = [{ id: 0, slug: "", label: "All" }, ...departments];
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(d) => String(d.id)}
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, height: 44 }}
      contentContainerStyle={{ gap: 12, paddingRight: 20 }}
      renderItem={({ item }) => {
        const active = (item.slug || undefined) === selected;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(item.slug || undefined)}
            style={{ height: 44, paddingHorizontal: 18, borderRadius: 999, justifyContent: "center", borderWidth: active ? 0 : 1, borderColor: c.line, backgroundColor: active ? c.gold : c.surface }}
          >
            <Text style={{ color: active ? c.onGold : c.ink, fontFamily: active ? fonts.bodyBold : fonts.bodySemi, fontSize: 14 }}>{item.label}</Text>
          </Pressable>
        );
      }}
    />
  );
}
