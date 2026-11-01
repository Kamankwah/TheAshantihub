import { useEffect, useState, type ReactNode } from "react";
import { AppState, Text, View } from "react-native";

import { useAuth } from "../state/auth";
import { useLock } from "../state/lock";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Button } from "./Button";

/**
 * Shows the app, or a plain brand screen while it is locked or in the phone's app switcher.
 * "Sign in with password instead" signs out, so the lock can never trap anyone.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const { enabled, locked, hydrate, onBackground, onForeground, unlock } = useLock();
  const signedIn = useAuth((s) => s.status === "signedIn");
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setCovered(state !== "active");
      if (state === "active") onForeground();
      else onBackground();
    });
    return () => sub.remove();
  }, [onBackground, onForeground]);

  const showLock = enabled && signedIn && locked;
  useEffect(() => {
    if (showLock) void unlock();
  }, [showLock, unlock]);

  if (!(enabled && signedIn) || (!locked && !covered)) return <>{children}</>;
  return (
    <View
      accessibilityViewIsModal
      style={{ flex: 1, backgroundColor: c.canvas, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}
    >
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 32 }}>
        AshantiHub
      </Text>
      {locked ? (
        <View style={{ alignSelf: "stretch", gap: 12 }}>
          <Button label="Unlock" onPress={() => void unlock()} />
          <Button
            variant="secondary"
            label="Sign in with password instead"
            onPress={() => {
              useLock.setState({ locked: false });
              void useAuth.getState().signOut();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
