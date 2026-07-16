import { C } from "../theme.js";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion.js";

// ─── ChatLauncher ──────────────────────────────────────────────────────────
// Floating chat-bubble button opening MessagingCenter (real, DB-backed
// support chat — backend.messaging) — App.jsx passes setShowMessaging as
// onOpen. Sits above the pre-existing floating WhatsApp button (see App.jsx
// `bottom` prop).

export default function ChatLauncher({ unreadMessages = 0, onOpen, bottom = 24 }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <button
      onClick={onOpen}
      aria-label="Open messages"
      style={{
        position: "fixed", bottom, right: 20, zIndex: 997,
        width: 54, height: 54, borderRadius: "50%",
        background: `linear-gradient(135deg, ${C.gold}, ${C.deepGold})`,
        border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 4px 20px ${C.gold}66`,
        fontSize: "1.4rem",
      }}
    >
      💬
      {unreadMessages > 0 && (
        <span style={{ position: "absolute", top: -2, right: -2, background: C.kente1, color: "white", borderRadius: "50%", minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.62rem", fontWeight: 900, border: "2px solid white" }}>
          {unreadMessages}
        </span>
      )}
      <span aria-hidden="true" style={{ position: "absolute", inset: -4, borderRadius: "50%", border: `2px solid ${C.gold}`, opacity: 0.5, animation: reducedMotion ? "none" : "chatPulseRing 2.2s ease-out infinite" }} />
      <style>{`
        @keyframes chatPulseRing {
          0% { transform: scale(0.9); opacity: 0.6; }
          70% { transform: scale(1.35); opacity: 0; }
          100% { opacity: 0; }
        }
      `}</style>
    </button>
  );
}
