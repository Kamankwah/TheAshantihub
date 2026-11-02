import * as WebBrowser from "expo-web-browser";

import { api } from "../../lib/api";
import { waitForPayment } from "../cart/checkout";

export type Settled<T> =
  | { status: "immediate"; body: T }
  | { status: "paid" | "failed" | "timeout" | "stopped" };

/**
 * POST a payment. The simulated provider answers at once (the body is the result); a real provider answers with a
 * checkout address: open it, then ask for the payment's status until it is paid, failed or given up on.
 */
export async function postPayment<T>(path: string, body: Record<string, unknown>, stopped: () => boolean = () => false): Promise<Settled<T>> {
  const res = await api<T & { mode?: string; checkout_url?: string; reference?: string }>(path, { body });
  if (res && (res as { mode?: string }).mode === "redirect" && (res as { reference?: string }).reference) {
    const r = res as { checkout_url?: string; reference: string };
    if (r.checkout_url) void WebBrowser.openBrowserAsync(r.checkout_url);
    const settled = await waitForPayment(r.reference, stopped);
    return { status: settled.status };
  }
  return { status: "immediate", body: res as T };
}
