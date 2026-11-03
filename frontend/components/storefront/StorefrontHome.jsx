import { C } from "../../theme.js";
import CountdownTakeover from "./CountdownTakeover.jsx";
import CtaBlock from "./CtaBlock.jsx";
import DealsRow from "./DealsRow.jsx";
import DepartmentShelves from "./DepartmentShelves.jsx";
import DepartmentShowcase from "./DepartmentShowcase.jsx";
import FlashStrip from "./FlashStrip.jsx";
import HeroSlider from "./HeroSlider.jsx";
import NewArrivalsRow from "./NewArrivalsRow.jsx";
import { BODY_FONT } from "./storefrontType.js";

// The marketplace home at "/". Order, top to bottom: the countdown takeover
// (only before opening), the header (`header`, App's StorefrontHeader — it
// replaces the Navbar here), then the hero slider, the flash strip, the
// department tiles (a full picture per department with its name on top), today's
// deals, new arrivals, a row of products per department with a "See all" link,
// and the call-to-action block; `children` follow for anything App adds later.
// No section is titled on screen (the headings are kept for screen readers).
// Each section owns its feed and renders nothing when the feed is empty or
// failing, so an empty marketplace still shows the header and the call to
// action rather than a blank page — never placeholder tiles. Navigation, the
// auth modal and registration are App's, threaded in as props.
// Colours come from the --ah-* CSS variables (index.css) so the header theme
// toggle restyles this surface; the fallbacks are the light `C` values.
export default function StorefrontHome({ header, user, onNavigate, onOpenListing, onSignIn, onSell, children }) {
  return (
    <div data-testid="storefront-home" style={{ background: C.canvas, color: C.ink, fontFamily: BODY_FONT, overflowX: "clip" }}>
      <CountdownTakeover />
      {header}
      <main>
        <HeroSlider onNavigate={onNavigate} />
        <FlashStrip onNavigate={onNavigate} />
        <DepartmentShowcase onNavigate={onNavigate} />
        <DealsRow onOpen={onOpenListing} />
        <NewArrivalsRow onOpen={onOpenListing} />
        <DepartmentShelves onNavigate={onNavigate} onOpen={onOpenListing} />
        <CtaBlock user={user} onSignIn={onSignIn} onSell={onSell} />
        {children}
      </main>
    </div>
  );
}
