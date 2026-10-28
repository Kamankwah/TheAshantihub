import { RoleChip } from "../shell/StaffHeader.jsx";
import { D, ROLE_ACCENTS } from "../theme.js";
import { chip, dim } from "./panelStyles.js";
import { when } from "./sessionParts.jsx";

// Pieces shared by the Super Admin People screens (Staff directory and profile,
// Teams, Invites, Roles, Sessions). A fact the server did not send is said to be
// missing, never filled in.

export const ROLE_LABEL = {
  super_admin: "Super Admin", general_manager: "General Manager", operations: "Operations", delivery_manager: "Delivery Manager", accountant: "Accounting",
  marketing: "Marketing", support: "Support", scout: "Scout", dispatch: "Dispatch", cosigner: "Co-signer", pickup_desk: "Pickup Desk",
};
export const roleLabel = (role) => ROLE_LABEL[role] || role;

export const RolePill = ({ role }) => <RoleChip role={role} roleColor={ROLE_ACCENTS[role] || D.textDim} />;

const STATUS = {
  active: ["Active", D.green], invited: ["Invited", D.amber], invite_expired: ["Invite expired", D.red],
  suspended: ["Suspended", D.red], deactivated: ["Deactivated", D.textDim],
};
export const statusWords = (status) => STATUS[status]?.[0] || status;
export const StatusChip = ({ status }) => <span style={chip(STATUS[status]?.[1] || D.textDim)}>{statusWords(status)}</span>;

const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short" }) : "");
export const dayText = day;
export const fullDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" }) : "");

// "Today 08:30", "3 Oct 18:20" or the honest "Not yet" for someone who never signed in.
export function lastSignInText(iso, status) {
  if (iso) return when(iso);
  return status === "invited" || status === "invite_expired" ? "Not yet" : "No sign-in in the last 90 days";
}

// 2-step sign-in as a cell: on | off | required (Super Admin) | none for a pending invite.
export function twoStepText(row) {
  if (row.two_step == null) return "—";
  if (row.two_step === "on") return row.two_step_required ? "On · required" : "On";
  return row.two_step_required ? "Off · required" : "Off";
}

export const TwoStep = ({ row }) => <span style={{ color: D.text, fontWeight: row.two_step === "on" ? 800 : 600 }}>{twoStepText(row)}</span>;

export const note = { ...dim, lineHeight: 1.5 };
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
