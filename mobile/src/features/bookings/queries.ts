import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { Money } from "./terms";

export type Booking = {
  id: number; listing: number; listing_name: string; check_in: string; check_out: string; nights: number; units: number;
  nightly_rate: string; total_price: string; status: string; paid_at: string | null; money: Money | null;
};
export type ServiceRequest = {
  id: number; listing: number; listing_name: string; message: string; budget: string | null; agreed_price: string | null; decline_reason: string;
  progress_note: string; status: "requested" | "accepted" | "declined" | "in_progress" | "completed" | "cancelled"; responded_at: string | null;
  paid_at: string | null; completed_at: string | null; created_at: string; auto_accept_at: string | null; settled: boolean; problem_reported: boolean; money: Money | null;
};

export const useMyBookings = () => useQuery({ queryKey: ["my-bookings"], queryFn: () => api<Booking[]>("/api/bookings/mine/") });
export const useMyRequests = () => useQuery({ queryKey: ["my-requests"], queryFn: () => api<ServiceRequest[]>("/api/services/requests/mine/") });

export const BOOKING_STATUS: Record<string, string> = {
  pending: "Pending payment", confirmed: "Confirmed", checked_in: "Checked in", checked_out: "Checked out", cancelled: "Cancelled",
};
export const REQUEST_STATUS: Record<ServiceRequest["status"], string> = {
  requested: "Requested", accepted: "Quote ready, awaiting payment", declined: "Declined", in_progress: "In progress", completed: "Done", cancelled: "Cancelled",
};
