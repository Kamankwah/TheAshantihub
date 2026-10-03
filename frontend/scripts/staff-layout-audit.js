// Staff layout audit (docs/superpowers/plans/2026-10-03-staff-pwa-responsive.md
// Task 9). Paste this function into the Playwright MCP's
// browser_run_code_unsafe tool (it receives `page`). Needs the local audit
// stack: API on :8110 with a super_admin, `vite preview` on :4173 built with
// VITE_API_BASE_URL=http://localhost:8110 (8000/8100 are commonly held by other
// local projects; change API to wherever the audit stack's `web` is published).
// Returns every panel × viewport where the page scrolls sideways or an element
// pokes past the viewport (elements inside their own horizontal scroller are
// allowed — spec §5 rule 2).
async (page) => {
  const BASE = 'http://localhost:4173';
  const API = 'http://localhost:8110';
  const SHOTS = process.env.STAFF_AUDIT_SHOTS || '/tmp/staff-audit';
  const PANELS = ['overview', 'kyc', 'moderation', 'hero', 'events-moderation', 'reviews', 'event-pricing',
    'subscription-plans', 'subscription-plans-approval', 'escrow', 'disputes', 'transactions', 'credit',
    'users', 'staff', 'scout-assignments', 'field-verification', 'delivery-coordination', 'my-deliveries',
    'categories-zones', 'promotions', 'site-settings', 'delivery', 'contact-messages', 'messaging', 'analytics'];
  const VIEWPORTS = [[320, 640], [375, 812], [768, 1024], [1024, 768], [1440, 900]];

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

  const login = await page.request.post(`${API}/api/accounts/staff/login/`, { data: { identifier: 'audit.admin@local.test', password: 'AuditPass!2026' } });
  const auth = await login.json();
  await page.goto(`${BASE}/`);
  // A staff SW left over from an earlier build would keep serving its precache
  // (registerType "prompt" never takes over by itself), so audit the fresh build.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.evaluate((a) => localStorage.setItem('ashantihub.auth', JSON.stringify(a)), auth);

  const failures = [];
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    for (const id of PANELS) {
      await page.goto(`${BASE}/staff${id === 'overview' ? '' : `/${id}`}`);
      await page.waitForSelector('main.staff-content', { timeout: 20000 });
      await page.waitForTimeout(1000);
      const result = await measure('.staff-shell');
      if (result.scrollWidth > result.vw || result.offenders.length) failures.push({ viewport: `${width}x${height}`, panel: id, ...result });
      await page.screenshot({ path: `${SHOTS}/${width}-${id}.png`, fullPage: true });
    }
  }

  // Signed-out staff entry points at phone widths.
  await page.evaluate(() => localStorage.removeItem('ashantihub.auth'));
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/staff', '/staff/activate?token=audit']) {
      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(2600); // boot LoadingScreen + modal
      const result = await measure('body');
      if (result.scrollWidth > result.vw || result.offenders.length) failures.push({ viewport: `${width}`, panel: path, ...result });
      await page.screenshot({ path: `${SHOTS}/${width}-${path.replace(/[/?=]/g, '_')}.png`, fullPage: true });
    }
  }
  return { checked: VIEWPORTS.length * PANELS.length + 4, failures };
}
