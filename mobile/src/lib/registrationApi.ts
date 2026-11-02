import { router } from "expo-router";

import { api } from "./api";
import { toResult, type AuthResult } from "./authApi";
import { useAuth } from "../state/auth";

export type RegistrationStep = "personal_info" | "business_info" | "plan_selection" | "payment_info" | "terms" | "complete";

/** Where a business owner belongs, from the server's registration step and verification status. */
export function stepRoute(step: string, kycStatus?: string): string {
  switch (step) {
    case "personal_info":
      return "/register/personal";
    case "business_info":
      return "/register/business";
    case "plan_selection":
      return "/register/plan";
    case "payment_info":
      return "/register/payout";
    case "terms":
      return "/register/terms";
    default:
      return kycStatus === "verified" || kycStatus === "rejected" ? "/" : "/register/submitted";
  }
}

type Me = { registration_step: string; kyc_status?: string };

/** Ask the server which step is next and go there (or to the app once registration is complete and verified). */
export async function resumeRegistration() {
  const me = await api<Me>("/api/accounts/me/");
  router.replace(stepRoute(me.registration_step, me.kyc_status) as never);
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
  gps_address: string;
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
export const acceptTerms = () => api("/api/accounts/business-owners/me/terms/", { body: {} });

export async function signInAndResume(result: AuthResult) {
  if (result.kind === "signedIn") {
    await useAuth.getState().signIn(result.body);
    await resumeRegistration();
  }
}
