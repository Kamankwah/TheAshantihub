import { C } from "../../theme.js";
import CountdownTakeover from "./CountdownTakeover.jsx";
import CtaBlock from "./CtaBlock.jsx";
import DealsRow from "./DealsRow.jsx";
import FlashStrip from "./FlashStrip.jsx";
import HeroSlider from "./HeroSlider.jsx";
import MostVisitedCategories from "./MostVisitedCategories.jsx";
import { BODY_FONT } from "./storefrontType.js";

// The marketplace home at "/". Order, top to bottom: the countdown takeover
// (only before opening), the header (`header`, App's StorefrontHeader — it
// replaces the Navbar here), then the hero slider, the flash strip, today's
// deals, the most visited categories and the call-to-action block; `children`
// follow for anything App adds later. Each section owns its feed and renders
// nothing when the feed is empty or failing, so an empty marketplace still
// shows the header and the call to action rather than a blank page — never
// placeholder tiles. Navigation, the auth modal and registration are App's,
// threaded in as props.
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
        <DealsRow onOpen={onOpenListing} />
        <MostVisitedCategories onNavigate={onNavigate} />
        <CtaBlock user={user} onSignIn={onSignIn} onSell={onSell} />
        {children}
      </main>
    </div>
  );
}
