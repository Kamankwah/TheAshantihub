import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../../apiClient.js";
import { setViewAsLive, setViewAsScreen } from "../../../lib/viewAs.js";
import { endViewAs, startViewAs, useViewAs } from "../../../hooks/useViewAs.js";
import { D, glassCard } from "../theme.js";
import { button, dim } from "../panels/panelStyles.js";

// Step-in (Super Admin SA-6). While this tab is stepped into someone's
// workspace, the staff shell is rendered for THAT person: their own /me
// (role, permissions, manager) read through the view, so their real menu and
// panels appear exactly as they see them, with the Super Admin's banner on
// top. Their data lives in a separate query cache, so nothing of theirs is
// left in the Super Admin's cache afterwards (and nothing of the Super
// Admin's shows in theirs). Writes never leave the browser (lib/viewAs.js)
// and the server refuses them anyway (backend/accounts/view_as.py).
export default function StepInGate({ Shell, ...props }) {
  const view = useViewAs();
  if (!view || props.auth?.user?.role !== "super_admin") return <Shell {...props} />;
  return <StepInShell key={view.person.id} Shell={Shell} view={view} {...props} />;
}

const refuse = () => Promise.reject(Object.assign(new Error("Read-only view"), { status: 403, body: { code: "view_only" } }));

function StepInShell({ Shell, view, auth, onExit, onViewSite, NotificationsSlot, theme, toggleTheme }) {
  const parent = useQueryClient();
  const [client] = useState(() => new QueryClient({ defaultOptions: parent.getDefaultOptions() }));
  // Requests carry X-View-As only while this is mounted. A layout effect runs
  // before the passive effects in which queries start fetching.
  // The person's shell opens on their Overview; it names each screen after that.
  useLayoutEffect(() => {
    setViewAsLive(true);
    setViewAsScreen("overview");
    return () => setViewAsLive(false);
  }, []);
  const me = useQuery({
    queryKey: ["view-as-me", view.person.id],
    queryFn: () => apiFetch("/api/accounts/me/?viewing=1"),
    retry: false,
  }, client);

  const exit = useCallback(() => endViewAs(), []);
  const switchTo = useCallback((person) => startViewAs(person), []);
  // Signing out (or leaving for the site) ends the view first, so the
  // sign-out itself goes as the Super Admin and the end is recorded.
  const signOut = useCallback(async () => { await endViewAs(); onExit?.(); }, [onExit]);
  const viewSite = useCallback(async () => { await endViewAs(); onViewSite?.(); }, [onViewSite]);

  const targetAuth = useMemo(() => {
    if (!me.data) return null;
    const user = { ...me.data, account_type: "staff" };
    return {
      user,
      hasPermission: (codename) => user.permissions?.includes(codename) ?? false,
      refreshUser: () => me.refetch(),
      completeSignIn: refuse, verifyTwoFactor: refuse, startTwoFactorEnrolment: refuse, confirmTwoFactorEnrolment: refuse,
    };
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewAs = useMemo(() => ({
    person: view.person, startedAt: view.startedAt, viewer: auth.user, onExit: exit, onSwitch: switchTo,
  }), [view, auth.user, exit, switchTo]);

  if (!targetAuth) {
    return (
      <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 16, background: D.pageBg }}>
        <div role={me.isError ? "alert" : "status"} style={{ ...glassCard, padding: "22px 24px", maxWidth: 440, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ color: D.text, fontWeight: 800 }}>
            {me.isError ? `Couldn't open ${view.person.full_name}'s workspace` : `Opening ${view.person.full_name}'s workspace, read-only…`}
          </div>
          {me.isError && <div style={dim}>{me.error?.body?.detail || "The view has ended. Start it again from Teams (step in)."}</div>}
          <button type="button" onClick={exit} style={{ ...button(D.text, D.panelBg), alignSelf: "flex-start" }}>Back to my workspace</button>
        </div>
      </main>
    );
  }

  return (
    <QueryClientProvider client={client}>
      <Shell auth={targetAuth} viewAs={viewAs} onExit={signOut} onViewSite={onViewSite ? viewSite : undefined} NotificationsSlot={NotificationsSlot} theme={theme} toggleTheme={toggleTheme} />
    </QueryClientProvider>
  );
}
