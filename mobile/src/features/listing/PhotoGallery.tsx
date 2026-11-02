import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRef, useState } from "react";
import { FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { fonts } from "../../theme/fonts";
import type { PhotoSizes } from "../browse/types";
import { photoSources, shouldClose } from "./motion";

export type GalleryPhoto = { id: number; variants: PhotoSizes };
type Props = { photos: GalleryPhoto[]; initialIndex: number; onClose: () => void };

/** One photo: pinch and double-tap to zoom, pan while zoomed, drag down at normal size to close. */
function ZoomPage({ photo, label, width, height, onClose, fade }: {
  photo: GalleryPhoto; label: string; width: number; height: number; onClose: () => void;
  fade: { value: number };
}) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const src = photoSources(photo.variants);

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      "worklet";
      scale.value = Math.min(4, Math.max(1, saved.value * e.scale));
    },
    onDeactivate: () => {
      "worklet";
      saved.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        saved.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      }
    },
  });
  const pan = usePanGesture({
    activeOffsetY: [-12, 12],
    failOffsetX: [-12, 12],
    onUpdate: (e) => {
      "worklet";
      if (scale.value > 1.02) {
        tx.value = e.translationX;
        ty.value = e.translationY;
      } else if (e.translationY > 0) {
        ty.value = e.translationY;
        fade.value = Math.max(0.3, 1 - e.translationY / 500);
      }
    },
    onDeactivate: (e) => {
      "worklet";
      if (scale.value <= 1.02 && shouldClose(e.translationY, e.velocityY)) {
        scheduleOnRN(onClose);
      } else if (scale.value <= 1.02) {
        ty.value = withSpring(0);
        fade.value = withTiming(1);
      }
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onDeactivate: () => {
      "worklet";
      const next = scale.value > 1.02 ? 1 : 2.5;
      scale.value = withTiming(next);
      saved.value = next;
      if (next === 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      }
    },
  });
  const gesture = useExclusiveGestures(doubleTap, useSimultaneousGestures(pinch, pan));
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width, height, alignItems: "center", justifyContent: "center" }, style]}>
        <Image
          accessibilityLabel={label}
          accessibilityRole="image"
          source={{ uri: src.uri ?? undefined }}
          placeholder={src.placeholder ? { uri: src.placeholder } : undefined}
          contentFit="contain"
          transition={150}
          style={{ width, height }}
        />
      </Animated.View>
    </GestureDetector>
  );
}

/** Full-screen photo pager: swipe between photos, dots, zoom, drag down (or tap Close) to leave. */
export function PhotoGallery({ photos, initialIndex, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<GalleryPhoto>>(null);
  const fade = useSharedValue(1);
  const backdrop = useAnimatedStyle(() => ({ opacity: fade.value }));
  const fadeBox = {
    get value() { return fade.value; },
    set value(v: number) { fade.value = v; },
  };

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: "#000" }, backdrop]}>
      <FlatList
        ref={listRef}
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(p) => String(p.id)}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) => (
          <ZoomPage
            photo={item}
            label={`Photo ${i + 1} of ${photos.length}`}
            width={width}
            height={height}
            onClose={onClose}
            fade={fadeBox}
          />
        )}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close photos"
        onPress={onClose}
        hitSlop={8}
        style={{ position: "absolute", top: 48, right: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}
      >
        <Feather name="x" size={24} color="#fff" />
      </Pressable>
      {photos.length > 1 ? (
        <View style={{ position: "absolute", bottom: 40, left: 0, right: 0, alignItems: "center", gap: 8 }}>
          <Text style={{ color: "#fff", fontFamily: fonts.bodySemi, fontSize: 13 }}>{`${index + 1} of ${photos.length}`}</Text>
          <View accessibilityElementsHidden style={{ flexDirection: "row", gap: 6 }}>
            {photos.map((p, i) => (
              <View key={p.id} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === index ? "#fff" : "rgba(255,255,255,0.4)" }} />
            ))}
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}
