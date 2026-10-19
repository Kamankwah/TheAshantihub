import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeliveryScheduled } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, dim } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Status, Title, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, dayTime } from "./deliveryParts.jsx";
import SendNow from "./SendNow.jsx";

// ─── Delivery Manager: Scheduled ─────────────────────────────────────────────
// Paid orders held until their vendors open (GET /api/delivery/scheduled/, the same set as the queue's
// scheduled_count), soonest first. Each shows the held-until time and every vendor's own next opening; a vendor
// the server gives no opening for (open now, or no hours) says so instead of showing a made-up time.
export default function ScheduledPanel({ auth }) {
  const canSend = Boolean(auth?.hasPermission?.("delivery.manage"));
  const [pageNo, setPageNo] = useState(1);
  const scheduled = useDeliveryScheduled(pageNo);
  const queryClient = useQueryClient();
  // Releasing the last order on page N leaves it empty and the server answers 404 for it: fall back to the first page.
  useEffect(() => { if (scheduled.isError && pageNo > 1) setPageNo(1); }, [scheduled.isError, pageNo]);
  const data = scheduled.data;
  const rows = data?.results || [];
  const refresh = () => ["delivery-scheduled", "delivery-queue", "delivery-live"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  return (
    <div style={page}>
      <Title>Scheduled</Title>
      <Status isLoading={scheduled.isLoading} isError={scheduled.isError}>
        {data && (
          <section aria-labelledby="held" style={section}>
            <h3 id="held" style={sectionTitle}>Held until the shop opens ({data.count}), soonest first</h3>
            {rows.length === 0 ? <Empty>No order is waiting for a shop to open.</Empty> : (
              <div style={scroll}>
                <table style={table}>
                  <thead><tr>{["Order", "Vendors and next opening", "Held until", ""].map((h, i) => <th key={i} scope="col" style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.order_id}>
                        <td style={{ ...td, fontWeight: 800 }}>#{o.order_id}<div style={dim}>{o.customer_name || ""}{o.delivery_address ? ` · ${o.delivery_address}` : ""}</div></td>
                        <td style={td}>{o.vendors.map((v) => (
                          <div key={v.business_id}>{v.business_name}: <span style={{ fontWeight: 700 }}>{v.next_open ? `opens ${dayTime(v.next_open)}` : "no opening time to show"}</span></div>
                        ))}</td>
                        <td style={{ ...td, fontWeight: 800 }}>{dayTime(o.ready_not_before)}</td>
                        <td style={td}><SendNow canSend={canSend} orderId={o.order_id} readyNotBefore={o.ready_not_before} onDone={refresh} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(data.next || pageNo > 1) && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)} style={button(D.panelBg, D.text, pageNo <= 1)}>Previous</button>
                <span style={dim}>Page {pageNo}</span>
                <button type="button" disabled={!data.next} onClick={() => setPageNo(pageNo + 1)} style={button(D.panelBg, D.text, !data.next)}>Next</button>
              </div>
            )}
          </section>
        )}
      </Status>
    </div>
  );
}
