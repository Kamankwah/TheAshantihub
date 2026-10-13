import { D } from "../../theme.js";
import { Honest } from "./mkParts.jsx";

// Shared by the flash-sale and coupon screens.
export const SALE_STATUS = {
  draft: ["Draft", D.textDim], waiting_sellers: ["Waiting for sellers", D.amber], scheduled: ["Scheduled", D.blue],
  live: ["Live", D.green], ended: ["Ended", D.textDim], cancelled: ["Cancelled", D.textDim],
};
export const whenWord = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function OffNotice({ data }) {
  if (!data || data.promos_enabled) return null;
  return <Honest tone="warn">{data.off_notice}</Honest>;
}

