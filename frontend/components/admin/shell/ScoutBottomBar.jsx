import { BarButton, quickNavStyle } from "./StaffBottomBar.jsx";

// The scout's phone bar (staff phase 2A, Decision 15): Businesses · Register ·
// Calls, each only when the scout's menu has that panel, then Menu, which
// opens the drawer, and Today (the scout's Overview) leads the bar. The slot
// labels are the canvas's tab names; the icons are the nav items'.
const TODAY = { id: "overview", label: "Today", icon: "📊" };
const SLOTS = [
  { id: "portfolio", label: "Businesses" },
  { id: "register-business", label: "Register" },
  { id: "calls", label: "Calls" },
];

export default function ScoutBottomBar({ navGroups, activeTab, onSelect, onMenu, badgeFor, roleColor }) {
  const items = navGroups.flatMap((group) => group.items);
  const slots = [{ ...TODAY, item: TODAY }, ...SLOTS
    .map((slot) => ({ ...slot, item: items.find((item) => item.id === slot.id) }))
    .filter((slot) => slot.item)];
  const inBar = slots.some((slot) => slot.id === activeTab);
  return (
    <nav aria-label="Quick navigation" style={quickNavStyle}>
      {slots.map((slot) => (
        <BarButton key={slot.id} icon={slot.item.icon} label={slot.label} active={activeTab === slot.id}
          count={badgeFor(slot.id)} onClick={() => onSelect(slot.id)} roleColor={roleColor} />
      ))}
      <BarButton icon="☰" label="Menu" active={!inBar} onClick={onMenu} roleColor={roleColor} />
    </nav>
  );
}
