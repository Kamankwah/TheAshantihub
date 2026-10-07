import { useState } from "react";
import { isStaffSession } from "../lib/staffSession.js";

// The click-time half of the staff view-only gate (lib/staffSession.js).
// A buy/sell/book/create handler starts with `if (gate.blocked()) return;` —
// for a staff session that records which action was stopped and returns true,
// and the component renders <StaffGateNotice/> where `gate.shownFor` says.
// Pass a key when one component has several gated actions (e.g. one per
// ticket type) so the notice lands next to the one that was pressed.
export function useStaffGate(user) {
  const [shownFor, setShownFor] = useState(null);
  const isStaff = isStaffSession(user);
  const blocked = (key = true) => {
    if (!isStaff) return false;
    setShownFor(key);
    return true;
  };
  return { isStaff, blocked, shownFor, dismiss: () => setShownFor(null) };
}
