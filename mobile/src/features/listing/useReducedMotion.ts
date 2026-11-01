import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion as useSystemReducedMotion } from "react-native-reanimated";

/** The system "reduce motion" setting: right on the first render (so no flight starts), then kept current. */
export function useReducedMotion(): boolean {
  const initial = useSystemReducedMotion();
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => {
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setLive);
    return () => sub.remove();
  }, []);
  return live ?? initial;
}
