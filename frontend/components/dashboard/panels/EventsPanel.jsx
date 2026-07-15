import { useCategories } from "../../../hooks/useCategories.js";
import { useZones } from "../../../hooks/useZones.js";
import EventSubmissionPanel from "../../EventSubmissionPanel.jsx";

// Events tab — mounts the same self-contained EventSubmissionPanel used on
// the public Events page and UserPanel's My Events tab (submission form +
// "My Events" list + ticket-type/check-in management), rather than building
// a parallel business-owner-specific UI.
export default function EventsPanel({ user, PaymentComponent }) {
  const { data: categories } = useCategories();
  const { data: zones } = useZones();
  return <EventSubmissionPanel user={user} categories={categories} zones={zones} PaymentComponent={PaymentComponent} />;
}
