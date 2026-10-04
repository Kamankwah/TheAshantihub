import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { D, glassCard } from "./theme.js";
import { chromeIntentUrl, detectInstallPlatform, isStandaloneDisplay, promptInstall, useStaffPwa } from "../../lib/staffPwa.js";
import StaffInstallLink, { staffInstallUrl } from "./StaffInstallLink.jsx";

// /staff/install — the link staff are sent (invite email, the Staff panel's
// "Staff app link", WhatsApp) to install the AshantiHub Staff app. No browser
// lets a page install an app by itself, so this leads with whatever the
// device in hand allows: Chrome's own install dialog once Chrome offers it,
// Safari's Add to Home Screen steps on iPhone/iPad, or a way out of an app's
// built-in browser, where nothing can be installed. It sits inside the
// /staff scope, so the staff manifest and service worker apply here.

const PLATFORM_TABS = [
  { id: "ios", label: "iPhone / iPad" },
  { id: "android", label: "Android" },
  { id: "desktop", label: "Computer" },
];

const bodyText = { margin: 0, color: D.text, fontSize: "0.92rem", lineHeight: 1.5 };
const noteText = { margin: 0, color: D.textDim, fontSize: "0.82rem", lineHeight: 1.5 };
// listStyle is explicit: Tailwind's preflight strips <ol> numbering.
const stepList = { margin: 0, paddingLeft: 22, listStyle: "decimal", display: "grid", gap: 10, ...bodyText };
const primaryButton = {
  display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minHeight: 48, boxSizing: "border-box",
  background: D.gold, color: "#1a1205", border: "none", borderRadius: 12, padding: "0 18px",
  fontSize: "0.95rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", textDecoration: "none",
};

function Notice({ tone, title, children }) {
  return (
    <section style={{ background: `${tone}12`, border: `1px solid ${tone}55`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0, color: D.text, fontSize: "0.98rem", fontWeight: 800 }}>{title}</h2>
      {children}
    </section>
  );
}

function InAppNotice({ os }) {
  return (
    <Notice tone={D.amber} title="Open this link in your browser">
      <p style={bodyText}>Apps can't be installed from inside another app, such as WhatsApp or Facebook.</p>
      {os === "android" ? (
        <>
          <a href={chromeIntentUrl(staffInstallUrl())} style={primaryButton}>Open in Chrome</a>
          <p style={noteText}>Or copy the link and paste it into Chrome:</p>
        </>
      ) : (
        <p style={bodyText}>
          In this app's <strong>•••</strong> menu, look for <strong>Open in Safari</strong> or <strong>Open in browser</strong>. Or copy
          the link and paste it into Safari:
        </p>
      )}
      <StaffInstallLink />
    </Notice>
  );
}

function IOSSteps({ platform }) {
  const needsSafari = platform.os === "ios" && !platform.iosSafari && !platform.inApp;
  return (
    <>
      {needsSafari && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={bodyText}>Open this page in Safari: copy the link, open Safari, and paste it into the address bar.</p>
          <StaffInstallLink />
        </div>
      )}
      <ol style={stepList}>
        <li>In Safari, tap <strong>Share</strong> (the square with an arrow). If you don't see it, tap <strong>•••</strong> first.</li>
        <li>Scroll down the list and tap <strong>Add to Home Screen</strong>.</li>
        <li>If you see <strong>Open as Web App</strong>, leave it on. Tap <strong>Add</strong>.</li>
        <li>Open <strong>AH Staff</strong> from your home screen and sign in.</li>
      </ol>
      <p style={noteText}>No option to add it to your home screen? You may be in another app's browser — open this link in Safari.</p>
    </>
  );
}

function AndroidSteps({ showWaitNote }) {
  return (
    <>
      {showWaitNote && (
        <p style={noteText}>An Install button may appear above after a few seconds — Chrome decides when to offer it. You don't need to wait:</p>
      )}
      <ol style={stepList}>
        <li>In Chrome, tap <strong>⋮</strong> at the top right.</li>
        <li>Tap <strong>Install app</strong>. On some phones it says <strong>Add to Home screen</strong>, then <strong>Install</strong>.</li>
        <li>Open <strong>AH Staff</strong> from your home screen or app list and sign in.</li>
      </ol>
      <p style={noteText}>Using Samsung Internet? Tap <strong>≡</strong> at the bottom right, then <strong>Add page to</strong> → <strong>Home screen</strong>.</p>
    </>
  );
}

function DesktopSteps() {
  return (
    <>
      <p style={bodyText}>Open this link on your phone to install the app there:</p>
      <StaffInstallLink />
      <p style={noteText}>To install it on this computer too, use Chrome or Edge: click the install icon at the right end of the address bar.</p>
    </>
  );
}

export default function StaffInstallPage() {
  const [platform] = useState(() => detectInstallPlatform(typeof navigator === "undefined" ? {} : navigator));
  const [tab, setTab] = useState(platform.os);
  const { installPrompt, installed } = useStaffPwa();

  // Opened from the home screen: the app is already installed.
  if (isStandaloneDisplay()) return <Navigate to="/staff" replace />;

  return (
    <div className="shadcn-scope command-center" style={{
      minHeight: "100dvh", boxSizing: "border-box", display: "flex", justifyContent: "center",
      padding: "max(28px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom))",
    }}>
      <main style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src="/icons/pwa-192x192.png" alt="" width={56} height={56} style={{ borderRadius: 14, boxShadow: D.shadow, flexShrink: 0 }} />
          <div>
            <div style={{ color: D.deepGold, fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>AshantiHub Staff</div>
            <h1 style={{ margin: 0, color: D.text, fontSize: "1.35rem", lineHeight: 1.15, letterSpacing: "-0.02em", fontWeight: 800 }}>Install the AshantiHub Staff app</h1>
          </div>
        </header>
        <p style={{ ...noteText, fontSize: "0.9rem" }}>It puts the staff dashboard on your home screen, and it opens full-screen like any other app.</p>

        {installed ? (
          <Notice tone={D.green} title="✓ AshantiHub Staff is installed">
            <p style={bodyText}>Open <strong>AH Staff</strong> from your home screen and sign in.</p>
          </Notice>
        ) : (
          <>
            {platform.inApp && <InAppNotice os={platform.os} />}
            {installPrompt && !platform.inApp && (
              <section style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <button type="button" onClick={promptInstall} style={primaryButton}>⬇ Install AshantiHub Staff</button>
                <p style={{ ...noteText, textAlign: "center" }}>Your device will ask you to confirm.</p>
              </section>
            )}
            <section style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              <div role="group" aria-label="Show the steps for" style={{ display: "flex", gap: 6 }}>
                {PLATFORM_TABS.map(({ id, label }) => {
                  const active = tab === id;
                  return (
                    <button key={id} type="button" aria-pressed={active} onClick={() => setTab(id)} style={{
                      flex: "1 1 0", minWidth: 0, minHeight: 44, padding: "0 6px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                      fontSize: "0.8rem", fontWeight: active ? 800 : 600, color: active ? D.text : D.textDim,
                      background: active ? D.goldSoft : "transparent", border: `1px solid ${active ? D.cardBorderStrong : D.divider}`,
                    }}>{label}</button>
                  );
                })}
              </div>
              {tab === "ios" && <IOSSteps platform={platform} />}
              {tab === "android" && <AndroidSteps showWaitNote={platform.os === "android" && !platform.inApp && !installPrompt} />}
              {tab === "desktop" && <DesktopSteps />}
            </section>
          </>
        )}

        <footer style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={noteText}>New to AshantiHub staff? Activate your account from your invite email first, then sign in to the app.</p>
          <Link to="/staff" style={{ color: D.deepGold, fontSize: "0.85rem", fontWeight: 800, textDecoration: "none" }}>Continue in the browser instead →</Link>
        </footer>
      </main>
    </div>
  );
}
