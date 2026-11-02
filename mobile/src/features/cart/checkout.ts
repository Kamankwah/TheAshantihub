import { api, ApiError } from "../../lib/api";

export type CheckoutForm = {
  method: "door_to_door" | "store_pickup";
  address: string;
  phone: string;
  gps: string;
  landmark: string;
  lat?: number;
  lng?: number;
};

/** Door-to-door needs a delivery address, a phone, the GhanaPost digital address and a landmark; pickup needs none. */
export function canPay(f: CheckoutForm): boolean {
  if (f.method === "store_pickup") return true;
  return [f.address, f.phone, f.gps, f.landmark].every((v) => v.trim().length > 0);
}

export function checkoutBody(f: CheckoutForm): Record<string, unknown> {
  if (f.method === "store_pickup") return { payment_method: "momo", delivery_method: "store_pickup" };
  return {
    payment_method: "momo",
    delivery_method: "door_to_door",
    delivery_address: f.address.trim(),
    delivery_phone: f.phone.trim(),
    delivery_gps_address: f.gps.trim().toUpperCase(),
    delivery_landmark: f.landmark.trim(),
    ...(f.lat !== undefined && f.lng !== undefined ? { delivery_lat: f.lat, delivery_lng: f.lng } : {}),
  };
}

/** Field errors the checkout can answer with, keyed by the form field they belong under. */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return out;
  const map: Record<string, string> = {
    delivery_gps_address: "gps",
    delivery_landmark: "landmark",
    delivery_address: "address",
    delivery_phone: "phone",
    delivery_lat: "pin",
  };
  for (const [key, field] of Object.entries(map)) {
    const v = (err.body as Record<string, unknown>)[key];
    const text = Array.isArray(v) ? v[0] : v;
    if (typeof text === "string") out[field] = text;
  }
  return out;
}

export const POLL_MS = 2000;
const MAX_POLLS = 150;

export type Settled = { status: "paid" | "failed" | "timeout" | "stopped"; orderId?: number };

/** Ask for the payment's status until it is paid or failed (about five minutes at most). */
export async function waitForPayment(reference: string, stopped: () => boolean): Promise<Settled> {
  for (let i = 0; i < MAX_POLLS; i += 1) {
    if (stopped()) return { status: "stopped" };
    try {
      const s = await api<{ status: string; order_id: number | null }>(`/api/payments/checkout-sessions/${reference}/`);
      if (s.status === "success" || s.status === "paid") return { status: "paid", orderId: s.order_id ?? undefined };
      if (s.status === "failed" || s.status === "expired") return { status: "failed" };
    } catch {
      // a dropped request is not a failed payment: keep asking
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { status: "timeout" };
}
