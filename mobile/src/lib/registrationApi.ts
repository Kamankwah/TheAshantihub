import { router } from "expo-router";

import { api } from "./api";
import { toResult, type AuthResult } from "./authApi";
import { useAuth } from "../state/auth";

export type RegistrationStep = "personal_info" | "business_info" | "shop_location" | "plan_selection" | "payment_info" | "terms" | "complete";

/**
 * Where a business owner belongs, from the server's registration step. A finished registration goes to the app ("/"),
 * verified or not: the home screen shows what still stops the shop going live, and staff review does not gate that.
 */
export function stepRoute(step: string, _kycStatus?: string): string {
  switch (step) {
    case "personal_info":
      return "/register/personal";
    case "business_info":
      return "/register/business";
    case "shop_location":
      return "/register/shop-location";
    case "plan_selection":
      return "/register/plan";
    case "payment_info":
      return "/register/payout";
    case "terms":
      return "/register/terms";
    default:
      return "/";
  }
}

type Me = { registration_step: string; kyc_status?: string };

/** Ask the server which step is next and go there (or to the app once registration is complete and verified). */
export async function resumeRegistration() {
  const me = await api<Me>("/api/accounts/me/");
  // The front door reads the stored step, so keep it as fresh as the answer we just got.
  const account = useAuth.getState().account;
  if (account) useAuth.setState({ account: { ...account, registrationStep: me.registration_step, kycStatus: me.kyc_status } });
  const route = stepRoute(me.registration_step, me.kyc_status);
  router.replace((route === "/" ? "/business/home" : route) as never);
}

export async function ownerLogin(input: { identifier: string; password: string }): Promise<AuthResult> {
  return toResult(await api("/api/accounts/business-owners/login/", { body: input, auth: false }), "business_owner");
}

export async function ownerRegister(input: {
  full_name: string;
  login_phone: string;
  email?: string;
  password: string;
}): Promise<AuthResult> {
  return toResult(await api("/api/accounts/business-owners/register/", { body: input, auth: false }), "business_owner");
}

export type Picked = { uri: string; name: string; type: string };

export function saveBusinessInfo(input: {
  gps_address?: string;
  business_contact_phone: string;
  is_formal: boolean;
  ghana_card_number?: string;
  tin?: string;
  ghana_card_front_image?: Picked;
  ghana_card_back_image?: Picked;
}) {
  const form = new FormData();
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === "") return;
    form.append(key, typeof value === "boolean" ? String(value) : (value as never));
  });
  return api("/api/accounts/business-owners/me/profile/", { method: "PATCH", body: form });
}

export type Plan = { id: number; tier: string; name: string; kind: string; monthly_price: string; features?: string[]; is_recommended?: boolean };
export const listPlans = () => api<Plan[]>("/api/billing/plans/", { auth: false });
export const startTrial = (input: { business_kind: string; plan: string; cycle_months: number }) =>
  api("/api/billing/subscriptions/start-trial/", { body: input });
export const saveBusinessKind = (business_kind: string) => api("/api/billing/business-kind/", { body: { business_kind } });
export const savePayout = (input: Record<string, string | undefined>) =>
  api("/api/accounts/business-owners/me/payout/", { method: "PATCH", body: input });

export type HoursDay = { weekday: number; closed: boolean; opens: string | null; closes: string | null };
export const getHours = () => api<{ has_hours: boolean; days: HoursDay[] }>("/api/accounts/business/hours/");
export const saveHours = (days: HoursDay[]) => api("/api/accounts/business/hours/", { method: "PUT", body: { days } });
export type ShopLocationState = { plus_code?: string; landmark?: string; tier?: string; tier_label?: string; is_manual?: boolean };

/**
 * Save where the shop is: a phone reading (`accuracy_m`) or a pin placed by hand (`manual: true`). A landmark goes
 * with either, trimmed, and only when there is one. The server's answer carries the plus code; nothing is worked out here.
 */
export function saveShopLocation(input: { lat: number; lng: number; accuracy_m?: number; manual?: boolean; landmark?: string }) {
  const { landmark, ...rest } = input;
  const body: Record<string, unknown> = { ...rest };
  if (landmark?.trim()) body.landmark = landmark.trim();
  return api<ShopLocationState>("/api/accounts/me/location/", { body });
}

/** Ask the server to email the owner a fresh confirmation link (it refuses past five a day). */
export const resendEmailConfirmation = () => api("/api/accounts/business-owners/me/email-confirmation/", { body: {} });

/**
 * Add or correct the owner's email (only while it is missing or unconfirmed) and mail a link to it. The server answers
 * `{ email, sent }`; it refuses a confirmed email (403 email_confirmed) and past five links a day (429, address saved).
 */
export const setOwnerEmail = (email: string) => api<{ email: string; sent: boolean }>("/api/accounts/business-owners/me/email/", { body: { email } });

export const acceptTerms = () => api("/api/accounts/business-owners/me/terms/", { body: {} });

export async function signInAndResume(result: AuthResult) {
  if (result.kind === "signedIn") {
    await useAuth.getState().signIn(result.body);
    await resumeRegistration();
  }
}
