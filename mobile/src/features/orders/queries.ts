import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { isActive, type Order } from "./status";

/** What the buyer's tracking answers: the rider as a first name, a vehicle and a position, never a phone number. */
export type Tracking = {
  stage: string;
  stops?: { total: number; done: number; skipped?: number };
  rider?: { first_name?: string; vehicle_type?: string; lat?: number; lng?: number; age_s?: number; stale?: boolean } | null;
  drop?: { lat: number; lng: number } | null;
  leg?: { to: string; distance_km: number; duration_s?: number; basis?: string } | null;
  /** [lat, lng] pairs of the road route; null when none could be drawn. */
  route?: [number, number][] | null;
  rider_busy?: boolean;
};

export const useOrders = () =>
  useQuery({
    queryKey: ["orders"],
    queryFn: () => api<Order[]>("/api/orders/"),
    refetchInterval: (q) => ((q.state.data ?? []).some(isActive) ? 30_000 : false),
  });

export const useOrder = (id: string) =>
  useQuery({
    queryKey: ["order", id],
    queryFn: () => api<Order>(`/api/orders/${id}/`),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data) ? 20_000 : false),
  });

export const useTracking = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["order-tracking", id],
    enabled,
    queryFn: () => api<Tracking>(`/api/orders/${id}/tracking/`),
    refetchInterval: enabled ? 20_000 : false,
  });
