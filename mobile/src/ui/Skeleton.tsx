import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, type DimensionValue } from "react-native";

import { useTheme } from "../theme/useTheme";

/** A grey block that gently pulses while content loads (still when reduce-motion is on). */
export function Skeleton({ width = "100%", height = 16 }: { width?: DimensionValue; height?: number }) {
  const { c, radius } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => loop?.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius.control, backgroundColor: c.well, opacity }}
    />
  );
}
