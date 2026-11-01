import { Image } from "expo-image";
import { useEffect, useRef, type ComponentRef } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { registerPhoto } from "./flight";

/** The card photo that flies to the product header: it registers its on-screen position for the page to read. */
export function SharedPhoto({ id, uri, style }: { id: number; uri: string; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    registerPhoto(id, ref.current as never, uri);
    return () => registerPhoto(id, null, uri);
  }, [id, uri]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      <Image source={{ uri }} contentFit="cover" transition={200} style={{ flex: 1 }} accessibilityIgnoresInvertColors />
    </View>
  );
}
