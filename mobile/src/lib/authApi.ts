import { api, ApiError } from "./api";
import type { LoginBody } from "../state/auth";

export type Challenge = { mfa_token: string; channels: string[]; /** The code is asked for from an authenticator app (or a recovery code), not sent by text. */ authenticator?: boolean };

/** The route params for the /otp screen. */
export function challengeParams(challenge: Challenge, kind?: "business_owner"): Record<string, string> {
  return { mfa_token: challenge.mfa_token, channels: challenge.channels.join(","), ...(challenge.authenticator ? { authenticator: "1" } : {}), ...(kind ? { kind } : {}) };
}
export type AuthResult = { kind: "signedIn"; body: LoginBody } | { kind: "challenge"; challenge: Challenge };

/** A sign-in, sign-up or code check answers either with a session or with a code still owed. */
export function toResult(response: any, accountType: "customer" | "business_owner"): AuthResult {
  if (response?.two_factor_required && response?.mfa_token) return { kind: "challenge", challenge: { mfa_token: response.mfa_token, channels: [], authenticator: true } };
  if (response?.mfa_token && !response?.token) {
    const channels = ((response.channels ?? []) as (string | { channel: string })[]).map((c) => (typeof c === "string" ? c : c.channel));
    return { kind: "challenge", challenge: { mfa_token: response.mfa_token, channels } };
  }
  return {
    kind: "signedIn",
    body: {
      token: response.token,
      refresh_token: response.refresh_token,
      account_type: response.account_type ?? accountType,
      id: response.id,
      full_name: response.full_name,
    },
  };
}

export async function customerLogin(input: { identifier: string; password: string }): Promise<AuthResult> {
  return toResult(await api("/api/accounts/customers/login/", { body: input, auth: false }), "customer");
}

export async function customerRegister(input: {
  full_name: string;
  phone: string;
  email?: string;
  password: string;
  marketing_consent?: { sms: boolean; email: boolean };
}): Promise<AuthResult> {
  return toResult(await api("/api/accounts/customers/register/", { body: input, auth: false }), "customer");
}

export async function otpSend(input: { mfa_token: string; channel: string }): Promise<{ hint?: string; resend_in?: number }> {
  return api("/api/otp/sign-in/send/", { body: input, auth: false });
}

export async function otpVerify(input: { mfa_token: string; code?: string; recovery_code?: string }, accountType: "customer" | "business_owner") {
  return toResult(await api("/api/otp/sign-in/verify/", { body: input, auth: false }), accountType);
}

/** A readable message for a failed form request. */
export function messageFor(error: unknown, fallback: string): string {
  const code = (error as { code?: string })?.code;
  if (code === "staff_not_supported") return "Staff accounts sign in on the AshantiHub web dashboard, not in this app.";
  const body = (error as { body?: Record<string, unknown> })?.body;
  if (body && typeof body === "object") {
    const first = Object.values(body).flat()[0];
    if (typeof first === "string") return first;
  }
  return fallback;
}
