import { D } from "../theme.js";
import { chip } from "./panelStyles.js";

// Shared pieces of the Visits and Check-in screens. Colours come from D only.

export const RADIUS_M = 100;
export const FOOTER_RULE = "A visit counts once you check out. Three flagged check-ins in 7 days open a review by Operations.";
export const LOCATION_RULE = "Your location is read only at check-in, check-out and when you take a photo — never in between.";

export const PURPOSES = [
  ["subscription_follow_up", "Subscription follow-up"], ["prospecting", "Prospecting"], ["registration", "Registration"],
  ["onboarding_photos", "Onboarding & photos"], ["delivery_follow_up", "Delivery follow-up"], ["info_update", "Info update"],
  ["verification", "Verification"],
];

export const timeOf = (value) => (value ? new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

export function dayLabel(date, now = new Date()) {
  const full = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return sameDay(date, now) ? `Today · ${full}` : full;
}

export const flagText = (visit) => `Outside the ${visit.radius_m || RADIUS_M} m radius · ${visit.distance_m} m`;

// The orange "outside the radius" chip used on both screens.
export const FlagChip = ({ children }) => (
  <span style={{ ...chip(D.amber), display: "inline-flex", alignSelf: "flex-start", fontSize: "0.72rem" }}>{`🚩 ${children}`}</span>
);
