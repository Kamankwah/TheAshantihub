import { Redirect } from "expo-router";

import { useAuth } from "../state/auth";

export default function Index() {
  const status = useAuth((s) => s.status);
  if (status === "loading") return null;
  if (status === "signedOut") return <Redirect href="/welcome" />;
  return null; // role tab bars arrive with the routing task
}
