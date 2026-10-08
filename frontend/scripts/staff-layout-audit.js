// Staff layout audit (docs/superpowers/plans/2026-10-03-staff-pwa-responsive.md
// Task 9). Paste this function into the Playwright MCP's
// browser_run_code_unsafe tool (it receives `page`). Needs the local audit
// stack: API on :8110 with a super_admin, `vite preview` on :4173 built with
// VITE_API_BASE_URL=http://localhost:8110 (8000/8100 are commonly held by other
// local projects; change API to wherever the audit stack's `web` is published).
// Returns every panel × viewport where the page scrolls sideways or an element
// pokes past the viewport (elements inside their own horizontal scroller are
// allowed — spec §5 rule 2).
//
// Pasted as-is it audits the super admin (every panel) exactly as before. To
// audit as another staff account, wrap it and pass options, e.g.
//   async (page) => (<this function>)(page, {
//     email: 'scout.seed@theashantihub.com', password: 'Password123!',
//     shots: '/tmp/staff-audit-roles/scout', viewports: [[375, 812], [1440, 900]],
//   })
// Only that account's permitted panels are audited: each /staff/<panel> URL is
// visited and kept only if the app itself leaves it there (the shell sends an
// unpermitted panel URL back to /staff — the same isPermittedTab gate a real
// session gets). Every 4xx/5xx API response seen while a panel is open is
// reported under `apiErrors`, so a permitted panel or Overview card that
// calls an endpoint the role can't reach shows up as a 403 with its URL.
async (page, options = {}) => {
  const BASE = options.base || 'http://localhost:4173';
  const API = options.api || 'http://localhost:8110';
  const SHOTS = options.shots || process.env.STAFF_AUDIT_SHOTS || '/tmp/staff-audit';
  const EMAIL = options.email || 'audit.admin@local.test';
  const PASSWORD = options.password || 'AuditPass!2026';
  // The signed-out entry points don't depend on who is auditing; only the
  // default (super admin) run checks them unless asked.
  const SIGNED_OUT = options.signedOut ?? !options.email;
  const PANELS = ['overview', 'kyc', 'moderation', 'hero', 'events-moderation', 'reviews', 'event-pricing',
    'subscription-plans', 'subscription-plans-approval', 'escrow', 'disputes', 'transactions', 'credit',
    'users', 'staff', 'scout-assignments', 'field-verification', 'register-business', 'delivery-coordination', 'my-deliveries',
    'categories-zones', 'promotions', 'site-settings', 'delivery', 'contact-messages', 'messaging', 'analytics'];
  const VIEWPORTS = options.viewports || [[320, 640], [375, 812], [768, 1024], [1024, 768], [1440, 900]];

  const measure = (scope) => page.evaluate((scopeSelector) => {
    const vw = document.documentElement.clientWidth;
    const inOwnScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll(`${scopeSelector} *`)]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !inOwnScroller(el); })
      .slice(0, 8)
      .map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 60), right: Math.round(el.getBoundingClientRect().right) }));
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders };
  }, scope);

  const login = await page.request.post(`${API}/api/accounts/staff/login/`, { data: { identifier: EMAIL, password: PASSWORD } });
  if (!login.ok()) return { error: `login failed for ${EMAIL}: HTTP ${login.status()}` };
  const auth = await login.json();
  const me = await (await page.request.get(`${API}/api/accounts/me/`, { headers: { Authorization: `Bearer ${auth.token}` } })).json().catch(() => ({}));
  await page.goto(`${BASE}/`);
  // A staff SW left over from an earlier build would keep serving its precache
  // (registerType "prompt" never takes over by itself), so audit the fresh build.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.evaluate((a) => localStorage.setItem('ashantihub.auth', JSON.stringify(a)), auth);

  // Collect API failures per panel visit.
  let currentPanel = null;
  const apiErrors = [];
  const onResponse = (res) => {
    if (currentPanel && res.url().startsWith(API) && res.status() >= 400) {
      apiErrors.push({ panel: currentPanel, status: res.status(), method: res.request().method(), url: res.url().slice(API.length) });
    }
  };
  page.on('response', onResponse);

  const panelPath = (id) => `/staff${id === 'overview' ? '' : `/${id}`}`;
  const openPanel = async (id) => {
    currentPanel = id;
    await page.goto(`${BASE}${panelPath(id)}`);
    await page.waitForSelector('main.staff-content', { timeout: 20000 });
    await page.waitForTimeout(1000);
  };

  // Discover the permitted panels: an unpermitted one is replaced by /staff.
  await page.setViewportSize({ width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] });
  const permitted = [];
  for (const id of PANELS) {
    await openPanel(id);
    if (new URL(page.url()).pathname === panelPath(id)) permitted.push(id);
  }

  const failures = [];
  let bottomBar = null;
  let checked = 0;
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    for (const id of permitted) {
      await openPanel(id);
      checked += 1;
      const result = await measure('.staff-shell');
      if (result.scrollWidth > result.vw || result.offenders.length) failures.push({ viewport: `${width}x${height}`, panel: id, ...result });
      await page.screenshot({ path: `${SHOTS}/${width}-${id}.png`, fullPage: true });
    }

    // Phone chrome, per phone width: header (role chip), bottom bar, open drawer.
    if (width <= 760) {
      await openPanel('overview');
      await page.locator('header').first().screenshot({ path: `${SHOTS}/${width}-chrome-header.png` });
      const bar = page.getByRole('navigation', { name: 'Quick navigation' });
      await bar.screenshot({ path: `${SHOTS}/${width}-chrome-bottom-bar.png` });
      bottomBar = (await bar.getByRole('button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/${width}-chrome-drawer.png` });
      await page.keyboard.press('Escape');
    }
  }
  currentPanel = null;
  page.off('response', onResponse);

  // Signed-out staff entry points at phone widths.
  if (SIGNED_OUT) {
    await page.evaluate(() => localStorage.removeItem('ashantihub.auth'));
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ['/staff', '/staff/activate?token=audit']) {
        await page.goto(`${BASE}${path}`);
        await page.waitForTimeout(2600); // boot LoadingScreen + modal
        const result = await measure('body');
        checked += 1;
        if (result.scrollWidth > result.vw || result.offenders.length) failures.push({ viewport: `${width}`, panel: path, ...result });
        await page.screenshot({ path: `${SHOTS}/${width}-${path.replace(/[/?=]/g, '_')}.png`, fullPage: true });
      }
    }
  }
  return {
    account: EMAIL, role: me.role, permissions: me.permissions, panels: permitted,
    bottomBar,
    checked, failures, apiErrors,
  };
}
