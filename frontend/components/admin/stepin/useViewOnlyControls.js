import { useEffect } from "react";

// Inside a step-in, the person's real panels render unchanged; this switches
// off their controls that would change data, so the screen reads as read-only
// at a glance. It is only the visible layer: apiClient never sends a write
// while viewing (lib/viewAs.js) and the server refuses one anyway (403
// view_only), so a control this misses still changes nothing.
//
// A control counts as "changes data" when its label starts with one of these
// verbs ("Approve", "➕ Add a holiday", "Set targets", "Return with note"),
// matched as a whole word so tabs and filters ("Returned", "Approvals",
// "Resolved", "Reports") stay usable.
const CHANGES_DATA = new RegExp(
  "^(approve|return|reject|decline|save|invite|submit|send|resend|delete|remove|confirm|record|add|create|new|mark|resolve|" +
    "reopen|re-open|assign|reassign|unassign|suspend|unsuspend|reactivate|deactivate|release|refund|set|edit|change|update|" +
    "upload|log|check in|check out|check-in|check-out|register|propose|withdraw|acknowledge|remind|end|revoke|grant|publish|" +
    "unpublish|hide|unhide|dismiss|escalate|re-review|take|claim|start|stop|apply|undo|request|flag|export|download|reveal|" +
    "reply|snooze|generate|pay|renew|extend|archive|restore|accept|verify|block|unblock|pin|unpin|transfer|reset|sign out|" +
    "cancel\\s+\\S+|turn on|turn off|enable|disable|schedule|report a|raise|book|share|copy link|retry|run|import|sync|link|unlink|" +
    "close case|close the|merge|split|move|rename|replace|upgrade|downgrade|pause|resume|activate|deny|allow|notify|nudge|" +
    "wake|note|internal note|tag|retire|loop in|pass to)\\b",
  "i",
);
export const OFF_TITLE = "Switched off while viewing someone else's workspace";
const CONTROLS = "button, input[type=submit], input[type=button], input[type=file], [role=button]";

export function changesData(label) {
  return CHANGES_DATA.test((label || "").replace(/^[^\p{L}]+/u, "").trim());
}

function labelOf(element) {
  return element.getAttribute("aria-label") || element.value || element.textContent || "";
}

export function switchOffControls(root) {
  for (const element of root.querySelectorAll(CONTROLS)) {
    if (element.dataset.viewOnly === "off") {
      if (!element.disabled && "disabled" in element) element.disabled = true;
      continue;
    }
    if (element.type !== "file" && !changesData(labelOf(element))) continue;
    element.dataset.viewOnly = "off";
    element.setAttribute("aria-disabled", "true");
    element.title = OFF_TITLE;
    if ("disabled" in element) element.disabled = true;
    else element.style.pointerEvents = "none";
  }
}

export default function useViewOnlyControls(ref, enabled) {
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return undefined;
    let pending = false;
    const scan = () => {
      pending = false;
      switchOffControls(root);
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      setTimeout(scan, 0);
    };
    scan();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, [ref, enabled]);
}
