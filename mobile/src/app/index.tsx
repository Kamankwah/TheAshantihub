import { Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { routeFor } from "../lib/routing";
import { useAuth } from "../state/auth";
import { useTheme } from "../theme/useTheme";
import { EmptyState } from "../ui/EmptyState";

/** The front door: waits for the stored session, then sends each person to their own area. */
export default function Index() {
  const { c } = useTheme();
  const status = useAuth((s) => s.status);
  const account = useAuth((s) => s.account);
  if (status === "loading") return null;
  if (status === "offline") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas, justifyContent: "center" }}>
        <EmptyState title="We can’t reach AshantiHub" body="You are still signed in. Check your connection and try again." action={{ label: "Try again", onPress: () => void useAuth.getState().bootstrap() }} />
      </SafeAreaView>
    );
  }
  return <Redirect href={routeFor(status, account?.type, account) as never} />;
}
