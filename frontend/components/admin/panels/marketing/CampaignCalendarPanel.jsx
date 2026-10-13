import { useState } from "react";
import { useMarketingCalendar } from "../../../../hooks/useMarketingCampaigns.js";
import { D } from "../../theme.js";
import { addDays, isoDay } from "../opsPeopleParts.jsx";
import { Honest, Loading, PageHead, Section, button, dim, page } from "./mkParts.jsx";

// ─── 04 Calendar ─────────────────────────────────────────────────────────────
// Messages, offers (flash sales) and banners in one month. Quiet days are the ones the sending policy
// has no messages on; the overlaps list holds real overlaps only (same people inside the per-person limit,
// requests that may not be approved in time).
const KINDS = { message: ["Messages", "SMS, WhatsApp, email, in-app", "#E8E8F6"], flash_sale: ["Offers", "flash sales", "#FBF3DC"], banner: ["Banners", "home and category", D.panelBg2] };
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHANNEL_WORD = { sms: "SMS", whatsapp: "WhatsApp", email: "Email", inapp: "In-app" };

const entryText = (e) => {
  const when = new Date(e.starts_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
  if (e.kind === "message") return `${CHANNEL_WORD[e.channel] || "Message"} ${when} · ${e.title}${e.status === "sent" ? " · sent" : e.status === "waiting_approval" ? " · waiting for Super Admin" : e.status === "draft" ? " · draft" : ""}`;
  if (e.kind === "flash_sale") return `Flash sale · ${e.title}`;
  return `Banner · ${e.title}`;
};

export default function CampaignCalendarPanel({ onNavigate }) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [shown, setShown] = useState({ message: true, flash_sale: true, banner: true });
  const first = addDays(month, -((month.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const weeks = cells[35].getMonth() === month.getMonth() ? 6 : 5;
  const days = cells.slice(0, weeks * 7);
  const from = isoDay(days[0]);
  const to = isoDay(days[days.length - 1]);
  const { data, isError, refetch } = useMarketingCalendar(from, to);
  const move = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  if (!data) return <div style={page}><PageHead title="Calendar" /><Loading error={isError} onRetry={refetch} what="the calendar" /></div>;

  const quiet = new Map(data.quiet_days.map((q) => [q.date, q.why]));
  const byDay = new Map();
  for (const e of data.entries) {
    if (!shown[e.kind]) continue;
    const start = isoDay(new Date(new Date(e.starts_at).toLocaleString("en-US", { timeZone: "Africa/Accra" })));
    const end = e.ends_at ? isoDay(new Date(new Date(e.ends_at).toLocaleString("en-US", { timeZone: "Africa/Accra" }))) : start;
    for (let d = start; d <= end && d <= to; d = isoDay(addDays(`${d}T12:00:00`, 1))) if (d >= from) byDay.set(d, [...(byDay.get(d) || []), e]);
  }
  const todayKey = isoDay(today);
  const window = data.window;

  return (
    <div style={page}>
      <PageHead title="Calendar">
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button type="button" aria-label="Previous month" onClick={() => move(-1)} style={button(D.panelBg, D.text)}>‹</button>
          <b style={{ minWidth: 130, textAlign: "center" }}>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b>
          <button type="button" aria-label="Next month" onClick={() => move(1)} style={button(D.panelBg, D.text)}>›</button>
        </div>
        <button type="button" onClick={() => onNavigate?.("mk-new-campaign")} style={button(D.gold, D.text)}>New campaign</button>
      </PageHead>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: "0.8rem" }}>
        <b>Show</b>
        {Object.entries(KINDS).map(([key, [label, hint, bg]]) => (
          <label key={key} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={shown[key]} onChange={() => setShown({ ...shown, [key]: !shown[key] })} />
            <span style={{ background: bg, borderRadius: 6, padding: "1px 7px", fontWeight: 800 }}>{label}</span> {hint}
          </label>
        ))}
        <span style={{ ...dim, display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ width: 14, height: 14, borderRadius: 4, background: "#EFE6D2", border: `1px solid ${D.cardBorder}` }} />Quiet day: no messages</span>
      </div>
      <Section id="cal-month" title={month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760, display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 5 }}>
            {DAY_NAMES.map((n) => <div key={n} style={{ ...dim, fontWeight: 800, padding: "2px 6px" }}>{n}</div>)}
            {days.map((d) => {
              const key = isoDay(d);
              const outside = d.getMonth() !== month.getMonth();
              const why = quiet.get(key);
              const items = byDay.get(key) || [];
              return (
                <div key={key} role="group" aria-label={`${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${why ? `, quiet day: ${why}` : ""}`}
                  style={{ minHeight: 104, boxSizing: "border-box", borderRadius: 10, padding: 6, background: why ? "#EFE6D2" : outside ? "#FDFAF2" : D.panelBg, border: key === todayKey ? `2px solid ${D.gold}` : `1px solid ${D.cardBorder}`, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", fontWeight: 800, color: outside ? D.textFaint : D.text }}>
                    <span>{d.getDate()}{d.getDate() === 1 ? ` ${d.toLocaleDateString("en-GB", { month: "short" })}` : ""}</span>
                    <span style={dim}>{key === todayKey ? "Today" : why ? (why === "Quiet day" ? "Quiet day" : why) : ""}</span>
                  </div>
                  {items.map((e) => (
                    <button key={`${e.kind}-${e.id}`} type="button" onClick={() => e.kind === "message" && onNavigate?.(e.status === "sent" ? "mk-results" : "mk-new-campaign", String(e.id))}
                      style={{ textAlign: "left", font: "inherit", fontSize: "0.68rem", fontWeight: 700, lineHeight: 1.3, border: 0, borderRadius: 6, padding: "3px 5px", background: KINDS[e.kind]?.[2] || D.panelBg2, color: D.text, cursor: e.kind === "message" ? "pointer" : "default" }}>{entryText(e)}</button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </Section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="cal-clash" title="Overlaps to look at">
          {data.clashes.length === 0 ? <Honest>Nothing overlaps right now.</Honest> : data.clashes.map((c, i) => <div key={i} style={{ display: "flex", gap: 12, fontSize: "0.82rem", lineHeight: 1.5, padding: "6px 0", borderTop: `1px solid ${D.divider}` }}><b style={{ minWidth: 80 }}>{c.when}</b><span>{c.text}</span></div>)}
        </Section>
        <Section id="cal-rules" title="Why some days are empty">
          <div style={{ fontSize: "0.8rem", lineHeight: 1.55 }}>Messages go out only {window.window_start}–{window.window_end} on {window.send_day_names.join(", ")}. A send time outside those hours can't be scheduled. Banners, flash sales and coupons on the site still run on quiet days.</div>
        </Section>
      </div>
    </div>
  );
}
