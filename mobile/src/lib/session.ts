import * as SecureStore from "expo-secure-store";

import { API_BASE } from "./config";

const ACCESS = "ashantihub.access";
const REFRESH = "ashantihub.refresh";

let cachedAccess: string | undefined;
let cachedRefresh: string | undefined;
let inFlight: Promise<boolean> | null = null;

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
  refresh(): Promise<boolean> {
    if (!inFlight) {
      inFlight = (async () => {
        try {
          if (!cachedRefresh) return false;
          const res = await fetch(`${API_BASE}/api/accounts/session/refresh/`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Client": "mobile" },
            body: JSON.stringify({ refresh_token: cachedRefresh }),
          });
          if (!res.ok) return false;
          const body = JSON.parse(await res.text());
          await session.save(body.token, body.refresh_token);
          return true;
        } catch {
          return false;
        } finally {
          inFlight = null;
        }
      })();
    }
    return inFlight;
  },
};
