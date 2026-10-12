import { D } from "../theme.js";
import HeroApprovalPanel from "./HeroApprovalPanel.jsx";
import EventsModerationPanel from "./EventsModerationPanel.jsx";
import { dim } from "./panelStyles.js";

// Hero & events, one screen (Operations menu): the hero-media queue and the
// events queue, each shown to someone who may decide it (hero_media.approve /
// event.approve). The two panels keep their own data and tabs; Marketing works
// the same queues, and whoever decides first is recorded on the row.
export default function HeroEventsPanel({ auth }) {
  const canHero = auth?.hasPermission?.("hero_media.approve") ?? false;
  const canEvents = auth?.hasPermission?.("event.approve") ?? false;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={dim}>Marketing works these queues too. Whoever decides first is recorded, and the other side sees it.</div>
      {canHero && <section aria-label="Hero submissions"><HeroApprovalPanel /></section>}
      {canEvents && <section aria-label="Events moderation"><EventsModerationPanel /></section>}
      {!canHero && !canEvents && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>You don't hold approval rights for hero submissions or events.</div>}
    </div>
  );
}
