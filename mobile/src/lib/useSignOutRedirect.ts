import { router } from "expo-router";
import { useEffect, useRef } from "react";

import { useAuth } from "../state/auth";

/** Whatever screen is open, losing the session (sign-out, deleted account, failed refresh) returns to the front door. */
export function useSignOutRedirect() {
  const status = useAuth((s) => s.status);
  const was = useRef(status);
  useEffect(() => {
    if (was.current === "signedIn" && status === "signedOut") router.replace("/welcome" as never);
    was.current = status;
  }, [status]);
}
