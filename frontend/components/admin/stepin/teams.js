// The Super Admin's "Teams (step in)" screens (canvas Part 1, 11-15) and whose
// workspace each opens; the server's own list is accounts/view_as.py TEAMS.
// `rebuilt` says whether that team's dashboard has been built to its approved
// canvas yet. Until it is, stepping in shows the screens the person uses today
// with a plain note; the new design appears by itself once it is built,
// because a step-in renders the person's real shell.
export const STEP_IN_TEAMS = [
  { id: "operations", navId: "step-in-operations", label: "Operations & scouts", roles: ["operations", "scout"], rebuilt: true },
  { id: "support", navId: "step-in-support", label: "Support", roles: ["support"], rebuilt: true },
  { id: "delivery", navId: "step-in-delivery", label: "Delivery & dispatch", roles: ["delivery_manager"], rebuilt: true },
  { id: "marketing", navId: "step-in-marketing", label: "Marketing", roles: ["marketing"], rebuilt: true },
  { id: "accounting", navId: "step-in-accounting", label: "Accounting", roles: ["accountant"], rebuilt: true },
];

export const teamById = (id) => STEP_IN_TEAMS.find((team) => team.id === id);
export const teamOfRole = (role) => STEP_IN_TEAMS.find((team) => team.roles.includes(role));
// Roles whose dashboard is built to its canvas (Scouts were built first, then Operations, then the rest).
const REBUILT_ROLES = new Set(["operations", "scout", "accountant", "support", "marketing", "delivery_manager", "dispatch"]);
export const isRebuiltRole = (role) => REBUILT_ROLES.has(role);
export const firstName = (name) => (name || "").trim().split(/\s+/)[0] || name;

// "Operations" from a person's role label, as the banner names the view.
export const workspaceName = (person) => person?.role_label || person?.role || "";
