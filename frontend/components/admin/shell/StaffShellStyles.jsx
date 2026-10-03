import { D } from "../theme.js";

// The staff shell's single component-local <style> (frontend/CLAUDE.md
// allows these for what inline styles can't express): dynamic-viewport
// heights so mobile URL bars don't cause a jump, the drawer keyframes, and a
// visible keyboard focus ring.
export default function StaffShellStyles() {
  return (
    <style>{`
.staff-shell { min-height: 100vh; }
.staff-sidebar { height: 100vh; }
@supports (height: 100dvh) {
  .staff-shell { min-height: 100dvh; }
  .staff-sidebar { height: 100dvh; }
}
@keyframes staffDrawerIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
.staff-shell button:focus-visible, .staff-shell a:focus-visible, .staff-shell input:focus-visible,
.staff-shell select:focus-visible, .staff-shell textarea:focus-visible {
  outline: 2px solid ${D.text}; outline-offset: 2px;
}
`}</style>
  );
}
