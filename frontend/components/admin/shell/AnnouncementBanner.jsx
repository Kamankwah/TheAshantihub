import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyAnnouncements } from "../../../hooks/useStaffSecurity.js";
import { D } from "../theme.js";

// Staff announcements (Super Admin 16) as they reach everyone: a banner at the top of the
// staff app for each notice still waiting. One that asks to be confirmed stays until the
// person taps "I've read this"; any other goes when they dismiss it. Nothing renders while
// there is nothing waiting, or if the list cannot be loaded.
export default function AnnouncementBanner() {
  const queryClient = useQueryClient();
  const { data } = useMyAnnouncements();
  const [failed, setFailed] = useState(false);
  if (!data || data.length === 0) return null;

  const answer = async (item) => {
    setFailed(false);
    try {
      await apiPost(`/api/announcements/mine/${item.id}/${item.require_confirm ? "confirm" : "open"}/`, {});
      queryClient.invalidateQueries({ queryKey: ["announcements", "mine"] });
    } catch {
      setFailed(true);
    }
  };

  return (
    <section aria-label="Announcements" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
      {data.map((item) => (
        <article key={item.id} role="status" style={{ background: "#FFF6DB", border: `1px solid ${D.gold}`, borderRadius: 12, padding: "10px 14px", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ color: D.textDim, fontSize: "0.68rem", fontWeight: 800 }}>{`📣 From ${item.from}`}</span>
            <strong style={{ color: D.text, fontSize: "0.88rem" }}>{item.title}</strong>
            <span style={{ color: D.text, fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>{item.body}</span>
          </div>
          <button type="button" onClick={() => answer(item)} style={{ minHeight: 44, background: item.require_confirm ? D.gold : "transparent", color: D.text, border: `1px solid ${D.gold}`, borderRadius: 10, padding: "0 16px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
            {item.require_confirm ? "I’ve read this" : "Dismiss"}
          </button>
        </article>
      ))}
      {failed && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", fontWeight: 700 }}>That did not save. Try again.</div>}
    </section>
  );
}
