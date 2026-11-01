import type { Feather } from "@expo/vector-icons";

export type OrderItem = { id: number; listing: number | null; listing_name: string; variant_label?: string; quantity: number; unit_price: string; line_total: string };
export type Order = {
  id: number;
  status: "pending" | "paid" | "cancelled";
  delivery_status: "processing" | "shipped" | "out_for_delivery" | "delivered";
  total_amount: string;
  placed_at: string;
  delivery_method?: "door_to_door" | "store_pickup";
  delivery_address?: string;
  delivery_gps_address?: string;
  delivery_landmark?: string;
  delivery_fee?: string | null;
  delivery_assignment_status?: string | null;
  delivery_code?: string | null;
  collection_code?: string | null;
  collect_by?: string | null;
  delivery_stops?: { total: number; done: number } | null;
  items: OrderItem[];
};

export type StatusMeta = { tone: "success" | "warn" | "error" | "neutral"; icon: keyof typeof Feather.glyphMap; label: string };

/** One status per order, always words plus an icon. Nothing here invents a date. */
export function orderStatus(o: Order): StatusMeta {
  if (o.status === "cancelled") return { tone: "error", icon: "x-circle", label: "Cancelled" };
  if (o.status === "pending") return { tone: "warn", icon: "clock", label: "Payment pending" };
  if (o.delivery_assignment_status === "confirmed") return { tone: "success", icon: "check-circle", label: "Receipt confirmed" };
  if (o.delivery_status === "delivered" || o.delivery_assignment_status === "delivered") return { tone: "success", icon: "package", label: "Delivered" };
  if (o.delivery_method === "store_pickup") return { tone: "neutral", icon: "shopping-bag", label: "Paid, collect from the seller" };
  if (o.delivery_status === "out_for_delivery") return { tone: "neutral", icon: "truck", label: "Out for delivery" };
  if (o.delivery_status === "shipped") return { tone: "neutral", icon: "truck", label: "Shipped" };
  return { tone: "neutral", icon: "clock", label: "Being prepared" };
}

export const STEPS: { key: Order["delivery_status"]; label: string }[] = [
  { key: "processing", label: "Being prepared" },
  { key: "shipped", label: "Shipped" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
];

/** Orders still moving: worth refreshing while the screen is open. */
export const isActive = (o: Order) => o.status === "paid" && o.delivery_status !== "delivered" && o.delivery_assignment_status !== "confirmed";

export const placedOn = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Accra" });
