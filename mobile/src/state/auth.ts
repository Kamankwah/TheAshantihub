import { create } from "zustand";

import { api, ApiError, setSessionLostHandler } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { session } from "../lib/session";

export type Account = { type: "customer" | "business_owner"; id: number; fullName: string; canBuy?: boolean };

/** The body every successful sign-in, sign-up or code check answers with. */
export type LoginBody = {
  token: string;
  refresh_token?: string;
  account_type: string;
  id: number;
  full_name: string;
};

type AuthState = {
  status: "loading" | "signedOut" | "signedIn";
  account?: Account;
  signIn: (body: LoginBody) => Promise<void>;
  signOut: () => Promise<void>;
  bootstrap: () => Promise<void>;
};

export const useAuth = create<AuthState>((set, get) => ({
  status: "loading",
  account: undefined,

  async signIn(body) {
    if (body.account_type !== "customer" && body.account_type !== "business_owner") {
      throw new ApiError(403, body, "staff_not_supported"); // staff use the web dashboards
    }
    await session.save(body.token, body.refresh_token);
    set({ status: "signedIn", account: { type: body.account_type, id: body.id, fullName: body.full_name } });
  },

  async signOut() {
    const refresh = session.refreshToken;
    if (refresh) {
      try {
        await api("/api/accounts/session/logout/", { body: { refresh_token: refresh }, auth: false });
      } catch {
        // signing out must work offline too
      }
    }
    await session.clear();
    queryClient.clear();
    set({ status: "signedOut", account: undefined });
  },

  async bootstrap() {
    const { access } = await session.load();
    if (!access) {
      set({ status: "signedOut" });
      return;
    }
    try {
      const me = await api<{ account_type: string; id: number; full_name: string; can_buy?: boolean }>(
        "/api/accounts/me/",
      );
      if (me.account_type !== "customer" && me.account_type !== "business_owner") throw new Error("staff");
      set({
        status: "signedIn",
        account: { type: me.account_type, id: me.id, fullName: me.full_name, canBuy: me.can_buy },
      });
    } catch {
      await get().signOut();
    }
  },
}));

// A refresh that failed means the session is gone: forget it locally (no network call).
setSessionLostHandler(() => {
  void session.clear();
  queryClient.clear();
  useAuth.setState({ status: "signedOut", account: undefined });
});
