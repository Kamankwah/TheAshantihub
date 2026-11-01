import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { isActive, type Order } from "./status";

export type Tracking = {
  stage: string;
  stops?: { total: number; done: number; skipped?: number };
  rider?: { first_name?: string; vehicle_type?: string } | null;
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
