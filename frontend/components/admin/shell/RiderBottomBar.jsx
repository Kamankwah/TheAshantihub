import { BarButton, quickNavStyle } from "./StaffBottomBar.jsx";

// The rider's phone bar (Dispatch canvas): Shift · Jobs · Earnings · Cash · Menu. Shift is the
// rider's Overview. Menu is a screen of its own (profile, documents, report an issue, sign out),
// so every slot is a real place and none opens a drawer.
const SLOTS = [
  { id: "overview", label: "Shift", icon: "🛵" },
  { id: "dr-jobs", label: "Jobs", icon: "📦" },
  { id: "dr-earnings", label: "Earnings", icon: "💷" },
  { id: "dr-cash", label: "Cash", icon: "🪙" },
  { id: "dr-menu", label: "Menu", icon: "☰" },
];
const MENU_SCREENS = new Set(["dr-menu", "dr-issue", "dr-documents", "reports", "tasks", "activity", "security", "approvals"]);

export default function RiderBottomBar({ activeTab, onSelect, roleColor }) {
  return (
    <nav aria-label="Quick navigation" style={quickNavStyle}>
      {SLOTS.map((slot) => (
        <BarButton key={slot.id} icon={slot.icon} label={slot.label} active={activeTab === slot.id || (slot.id === "dr-menu" && MENU_SCREENS.has(activeTab))} onClick={() => onSelect(slot.id)} roleColor={roleColor} />
      ))}
    </nav>
  );
}
