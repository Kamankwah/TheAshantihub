import { useEffect, useState } from "react";
import { C } from "../../theme.js";
import { usePublicBanners } from "../../hooks/useMarketingBanners.js";
import { useOpening } from "../../hooks/useOpening.js";
import { splitRemaining } from "../../lib/openingFormat.js";
import { BODY_FONT, TABULAR } from "./storefrontType.js";

// The flash strip: Marketing's live "flash" banner (published directly by
// Marketing) as one calm line under the hero — the message, and when the
// banner has `countdown_ends_at`, "Ends in HH:MM:SS" counted on the server's
// clock (useOpening's serverNow), never the device's. A countdown that has run
// out is dropped rather than shown at zero. Renders nothing while loading, on
// an error, or with no live flash banner.
const pad = (n) => String(n).padStart(2, "0");

function countdownText(ms) {
  const { days, hours, minutes, seconds } = splitRemaining(ms);
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `Ends in ${days > 0 ? `${days}d ${clock}` : clock}`;
}

export default function FlashStrip({ onNavigate }) {
  const { data, isError } = usePublicBanners("flash");
  const { serverNow } = useOpening({ tick: false });
  const banner = !isError ? data?.banners?.[0] : null;
  const message = banner?.message || banner?.title || "";
  const endsAt = banner?.countdown_ends_at ? Date.parse(banner.countdown_ends_at) : NaN;
  const counting = Number.isFinite(endsAt);
  const [, setTick] = useState(0);

  const remaining = counting ? endsAt - serverNow() : 0;
  const live = counting && remaining > 0;
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  if (!banner || !message) return null;

  const body = (
    <>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{message}</span>
      {live && (
        <span data-testid="flash-countdown" role="timer" style={{ flexShrink: 0, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", ...TABULAR }}>
          {countdownText(remaining)}
        </span>
      )}
    </>
  );
  const row = {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 16px", width: "100%", boxSizing: "border-box",
    padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.gold}33`, borderLeft: `5px solid ${C.gold}`,
    background: C.surface, color: C.ink, fontFamily: BODY_FONT, fontSize: 15, lineHeight: 1.4, textAlign: "left",
  };

  return (
    <section aria-label="Flash offer" style={{ maxWidth: 1120, margin: "0 auto", padding: "16px 16px 0", boxSizing: "border-box" }}>
      {banner.link_path ? (
        <button type="button" onClick={() => onNavigate(banner.link_path)} style={{ ...row, cursor: "pointer" }}>{body}</button>
      ) : (
        <div style={row}>{body}</div>
      )}
    </section>
  );
}
