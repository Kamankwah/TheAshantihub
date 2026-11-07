import { router, useSegments } from "expo-router";
import { useEffect } from "react";

import { useAuth } from "../state/auth";
import { guardRedirect } from "./routing";

/** Sends a signed-out visitor away from account screens, and a customer away from business-only ones. */
export function useRouteGuard() {
  const segments = useSegments() as string[];
  const status = useAuth((s) => s.status);
  const type = useAuth((s) => s.account?.type);
  const target = guardRedirect(segments, status, type);
  useEffect(() => {
    if (target) router.replace(target as never);
  }, [target]);
}
