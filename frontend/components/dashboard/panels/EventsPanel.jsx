import { useCategories } from "../../../hooks/useCategories.js";
import { useZones } from "../../../hooks/useZones.js";
import EventSubmissionPanel from "../../EventSubmissionPanel.jsx";

// Events tab — mounts the same self-contained EventSubmissionPanel used on
// the public Events page and UserPanel's My Events tab (submission form +
// "My Events" list + ticket-type/check-in management), rather than building
// a parallel business-owner-specific UI. EventSubmissionPanel hardcodes an
// always-dark palette (see App.jsx's MyEventsTab comment — it was written for
// the always-dark public Events page and the Command Center's former dark
// theme, and UserPanel already carries this as a known limitation in light
// mode). Since the Command Center is light now, this tab wraps it in a dark
// card here — chrome only, EventSubmissionPanel itself is untouched — so its
// white/light text stays legible instead of rendering white-on-cream.
export default function EventsPanel({ user, PaymentComponent }) {
  const { data: categories } = useCategories();
  const { data: zones } = useZones();
  return (
    <div style={{ background: "#1F140C", borderRadius: 16, padding: "20px 18px" }}>
      <EventSubmissionPanel user={user} categories={categories} zones={zones} PaymentComponent={PaymentComponent} />
    </div>
  );
}
