# AshantiHub — architecture as found (2026-11-06)

Derived from `infra/compose/docker-compose.yml`, `infra/hestia/templates/`, `infra/README.md`, `deploy.sh`, `ss -tlnp`
and `docker compose ps` on the staging stack, response headers from the live hosts, and the source. Evidence: `docs/reviews/evidence/`.

## C4 level 1 — system context

```mermaid
C4Context
  title AshantiHub — system context (as found)
  Person(shopper, "Shopper / business owner", "Mid-range Android + iOS, 3G/4G, Ghana")
  Person(staff, "Staff (13 roles)", "Staff PWA dashboards, 2FA for Super Admin")
  System(ah, "AshantiHub", "Marketplace: listings, orders, bookings, events, wallets/escrow (switches off), delivery")
  System_Ext(hubtel, "Hubtel", "Payments + SMS. Payments SIMULATED today; webhook scheme UNVERIFIED")
  System_Ext(stackmail, "20i / stackmail SMTP", "Outbound mail relay via Exim")
  System_Ext(sentry, "Sentry (org demarbells)", "Backend errors only. No frontend/mobile reporting")
  System_Ext(stores, "App Store / Play Console / EAS", "Mobile builds; Play upload is manual")
  System_Ext(maps, "OSM tiles / Nominatim / Google Maps (Android)", "Map tiles, geocoding")
  Rel(shopper, ah, "Web + mobile app", "HTTPS")
  Rel(staff, ah, "Staff PWA", "HTTPS + WebSocket")
  Rel(ah, hubtel, "Checkout API / callbacks")
  Rel(ah, stackmail, "SMTP 587")
  Rel(ah, sentry, "Exceptions")
  Rel(ah, maps, "Tiles, geocode")
  Rel(stores, shopper, "Distributes mobile builds")
```

## C4 level 2 — containers (one Hetzner CX33: 4 vCPU / 8 GB / 80 GB, prod + staging side by side)

```mermaid
flowchart TB
  subgraph clients[Clients]
    web[Web SPA<br/>React 19 + Vite 5.4]
    pwa[Staff PWA<br/>/staff, service worker]
    mob[Expo RN app<br/>SecureStore tokens<br/>NO OTA, NO force-update]
  end

  subgraph vercel[Vercel]
    stgfe[test.theashantihub.com<br/>STAGING frontend only<br/>vercel.json headers apply here only]
  end

  subgraph host[Hetzner CX33 — single host, iptables INPUT DROP]
    nginx[HestiaCP nginx :80/:443<br/>templates in infra/hestia/templates]
    prodfe[(Prod SPA docroot<br/>built ON the server by deploy.sh<br/>no security headers)]
    media[(backend/media + backend/private<br/>bind mounts, NOT in backups)]
    exim[Exim :25/465/587]
    subgraph prod[compose project: ashantihub]
      pweb[web: gunicorn sync x4 :8000]
      prt[realtime: gunicorn + 1 uvicorn worker :8100 /ws/]
      pwk[worker: celery concurrency 2, ONE queue]
      pbeat[beat: 38 entries]
      pdb[(Postgres 16.15<br/>app role = superuser<br/>no WAL archive, ssl off)]
      pred[(Redis 7<br/>no persistence, 128MB<br/>broker + channels)]
      posrm[OSRM routing]
    end
    subgraph stg[compose project: ashantihub-staging :8001/:8101]
      sweb[web + realtime + worker + beat]
      sdb[(Postgres, 25 MB)]
    end
    backups[(backups/ nightly pg_dump.gz<br/>same disk, files 0644, 14-day retention<br/>NO offsite, NO restore test)]
    cron[/etc/cron.d/ashantihub<br/>02:30 prod, 03:00 staging backup<br/>hourly expire_events/]
  end

  web -->|HTTPS| nginx
  pwa --> nginx
  mob -->|HTTPS api.theashantihub.com| nginx
  stgfe -->|HTTPS api-test| nginx
  nginx --> prodfe
  nginx -->|/api| pweb
  nginx -->|/ws/| prt
  nginx -->|/media/ alias, NO AUTH| media
  pweb --> pdb
  pweb --> pred
  pwk --> pdb
  pwk --> pred
  pbeat --> pred
  prt --> pred
  pweb --> posrm
  pweb --> exim
  cron --> backups
  pdb -.pg_dump.-> backups
  pweb -.HTTP inside transaction when Hubtel is live.-> hubtel[(Hubtel)]
  hubtel -.webhook, status parsed by substring.-> pweb
  exim --> smtp[(stackmail SMTP)]
  pweb -.-> sentry[(Sentry)]
```

## Documented vs found — gap list

| # | Documented / assumed | Found | Evidence |
|---|---|---|---|
| 1 | `settings.py:708-710`: media is "served to anyone", so private files must use private storage | Ghana Card, business certificate, signboard and dispute images are written to public `MEDIA_ROOT` and nginx serves `/media/` with no auth | `accounts/models.py:455-477`, `ashantihub-api.stpl.in:36`, staging HEAD returned 200 |
| 2 | `infra/README.md`: nightly backups, 14-day retention | Same disk as the DB, no offsite, no WAL, files 0644, no restore test, uploads not backed up | `backup-db.sh`, `ls -l backups` on staging |
| 3 | `orders/views.py:89-93`: webhook empties the cart | No cart code in the finalizer; only the simulated branch clears it | `payments/services.py:40-58` |
| 4 | Frontend "hosted on Vercel" (my brief) / `frontend/vercel.json` header policy | Only **staging** is on Vercel. Production is nginx with server-built assets and no HSTS/CSP/XFO | `curl -I https://theashantihub.com` |
| 5 | Mobile API client generated from OpenAPI (my brief) | Hand-written fetch wrapper, 79 unchecked `as T` casts; OpenAPI schema exists unused | `mobile/src/lib/api.ts` |
| 6 | `frontend/CLAUDE.md`: App.jsx "~4,000 lines" | 3,478 lines | `wc -l` |
| 7 | `docs/HUBTEL_INTEGRATION.md:62`: `POST /api/payments/checkout/` | Endpoint does not exist | grep |
| 8 | Hardening spec G1–G5 | "Nothing built" at HEAD: throttles, lockout, field encryption | `2026-10-16-security-hardening-design.md` vs code |
| 9 | CLAUDE.md "verify-before-merge gate" | Exists only as prose for an AI agent; no `.github`, no hooks, `deploy.sh` runs no tests | `ls -a`, `deploy.sh` |
| 10 | Docker health = app healthy | `/api/health/` returns 200 without touching DB or Redis | `core/views.py:46-48` |
