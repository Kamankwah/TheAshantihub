# Updating, force-updating and rolling back the mobile app (review MOB-01)

Three tools, from lightest to heaviest. Use the lightest one that fixes the problem.

## 1. Over-the-air (JS only) — `expo-updates`

- Every build carries a **runtime version** equal to its app `version` (`app.config.ts`, policy `appVersion`) and listens on a
  **channel** named after its EAS profile (`preview`, `play-internal`, `production`, `testflight`). An update only reaches builds on
  the same channel and the same runtime version, so a JS bundle can never land on a binary whose native code it was not built for.
- Publish a JS-only fix: `cd mobile && eas update --channel production --message "what changed"`. Test it first on `preview`.
- Not for: new native modules or permissions, anything that changes what the store listing declares, or a version bump (those need a build).
- **Roll back a bad update:** `eas update:republish --channel production --group <previous group id>` (find ids with
  `eas update:list --channel production`), or `eas channel:edit production --branch <last good branch>`. Phones pick it up on their next launch.
- The first build with `expo-updates` has to go through the stores once; builds made before it cannot receive updates.

## 2. Force-update gate — `MOBILE_MIN_VERSION`

- The app sends `X-App-Version` and `X-App-Build` on every request. When the API environment sets `MOBILE_MIN_VERSION` (for example `1.2.0`),
  any mobile request below it, or from a build that sends no version at all, is answered `426 upgrade_required`, and the app replaces
  itself with a full-screen "Please update AshantiHub" page whose button opens `MOBILE_STORE_URL` (or the default store page).
- Set both in the server `.env` and restart `web`; clear `MOBILE_MIN_VERSION` to switch the gate off. Web, staff and webhook traffic is never gated.
- Only raise the minimum after the fixed build is live in both stores (and, on Play, rolled out to 100%), or people are told to update to nothing.
- Use it for: a security fix, or a backend change that older builds cannot survive.

## 3. New store build

Needed for native changes. `eas build --profile production` → internal testing → `eas submit`. Play review takes hours to days, which is
why 1 and 2 exist. Keep `version` and the store build number in step; `autoIncrement` handles the build number.

## Checklist for a bad release

1. Can a JS fix undo it? Publish an update on `preview`, check on a device, then on `production`.
2. Is the damage in the bundle itself? Roll the channel back (above).
3. Is it native or does it corrupt data? Pause the staged rollout in the Play Console, ship a fixed build, then raise `MOBILE_MIN_VERSION`.
