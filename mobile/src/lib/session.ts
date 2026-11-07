import * as SecureStore from "expo-secure-store";

import { API_BASE } from "./config";

const ACCESS = "ashantihub.access";
const REFRESH = "ashantihub.refresh";

let cachedAccess: string | undefined;
let cachedRefresh: string | undefined;
/** `renewed`; `ended` (the server refused the refresh token: sign out); `unavailable` (offline or a server error: keep the session). */
export type RefreshResult = "renewed" | "ended" | "unavailable";

let inFlight: Promise<RefreshResult> | null = null;

/** The tokens, kept in the phone's secure storage (Keychain / Keystore) and mirrored in memory. */
export const session = {
  async load(): Promise<{ access?: string; refresh?: string }> {
    cachedAccess = (await SecureStore.getItemAsync(ACCESS)) ?? undefined;
    cachedRefresh = (await SecureStore.getItemAsync(REFRESH)) ?? undefined;
    return { access: cachedAccess, refresh: cachedRefresh };
  },

  async save(access: string, refresh?: string): Promise<void> {
    cachedAccess = access;
    await SecureStore.setItemAsync(ACCESS, access);
    if (refresh) {
      cachedRefresh = refresh;
      await SecureStore.setItemAsync(REFRESH, refresh);
    }
  },

  async clear(): Promise<void> {
    cachedAccess = undefined;
    cachedRefresh = undefined;
    await SecureStore.deleteItemAsync(ACCESS);
    await SecureStore.deleteItemAsync(REFRESH);
  },

  get access() {
    return cachedAccess;
  },

  get refreshToken() {
    return cachedRefresh;
  },

  /** Trade the refresh token for a new access token. Callers that arrive while one is running share its result. */
  refresh(): Promise<RefreshResult> {
    if (!inFlight) {
      inFlight = (async () => {
        try {
          if (!cachedRefresh) return "ended";
          const res = await fetch(`${API_BASE}/api/accounts/session/refresh/`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Client": "mobile" },
            body: JSON.stringify({ refresh_token: cachedRefresh }),
          });
          // Only a 401/403 means the refresh token is dead. A server error or a dropped connection must not sign the person
          // out: the access token is short-lived (30 minutes), so this runs often, on bad networks too (review BE-09).
          if (res.status === 401 || res.status === 403) return "ended";
          if (!res.ok) return "unavailable";
          const body = JSON.parse(await res.text());
          await session.save(body.token, body.refresh_token);
          return "renewed";
        } catch {
          return "unavailable";
        } finally {
          inFlight = null;
        }
      })();
    }
    return inFlight;
  },
};
