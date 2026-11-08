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
.staff-shell input[type="checkbox"], .staff-shell input[type="radio"] { width: 24px; height: 24px; accent-color: ${D.text}; cursor: pointer; }
/* A scrolling table region is the containing block for the visually hidden text inside it; otherwise those
   absolutely positioned bits sit outside the clip and widen the whole page. */
.staff-shell .staff-content [role="region"][tabindex] { position: relative; }
/* Phone baseline for every panel (spec §5 rules 3–4, Review Focus 5).
   !important appears only where panels set the same property inline. */
.staff-shell[data-bp="phone"] .staff-content { overflow-wrap: anywhere; }
.staff-shell[data-bp="phone"] .staff-content button, .staff-shell[data-bp="phone"] .staff-content summary { min-height: 44px !important; min-width: 44px; }
/* "anywhere" shrinks min-content to one glyph, so a button squeezed in a flex
   row would stack its label letter by letter; buttons break at words only. */
.staff-shell[data-bp="phone"] .staff-content button { overflow-wrap: normal; }
.staff-shell[data-bp="phone"] .staff-content input:not([type="checkbox"]):not([type="radio"]),
.staff-shell[data-bp="phone"] .staff-content select,
.staff-shell[data-bp="phone"] .staff-content textarea {
  min-height: 44px !important; max-width: 100%; box-sizing: border-box;
}
.staff-shell[data-bp="phone"] .leaflet-control-zoom a { width: 44px; height: 44px; line-height: 44px; }
/* The header's bell and theme toggle are chrome, outside .staff-content. */
.staff-shell[data-bp="phone"] header button { min-height: 44px !important; min-width: 44px !important; }
/* A select is as wide as its longest option; let it (and the label around it) shrink to the screen. */
.staff-shell[data-bp="phone"] .staff-content label, .staff-shell[data-bp="phone"] .staff-content select { min-width: 0; max-width: 100%; }
.staff-shell[data-bp="phone"] .staff-content select { text-overflow: ellipsis; }
/* A table scrolls inside its own region instead of widening the page. */
.staff-shell[data-bp="phone"] .staff-content section, .staff-shell[data-bp="phone"] .staff-content [role="region"] { min-width: 0; max-width: 100%; }
.staff-shell[data-bp="phone"] .staff-content input[type="color"] { min-width: 44px; }
.staff-shell[data-bp="phone"] .staff-content img,
.staff-shell[data-bp="phone"] .staff-content video { max-width: 100%; height: auto; }
`}</style>
  );
}
