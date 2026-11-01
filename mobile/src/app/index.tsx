import { Redirect } from "expo-router";

import { routeFor } from "../lib/routing";
import { useAuth } from "../state/auth";

/** The front door: waits for the stored session, then sends each person to their own area. */
export default function Index() {
  const status = useAuth((s) => s.status);
  const account = useAuth((s) => s.account);
  if (status === "loading") return null;
  return <Redirect href={routeFor(status, account?.type, account) as never} />;
}
