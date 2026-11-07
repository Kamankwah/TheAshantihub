# Google Maps key (Android) — restriction checklist (review MOB-10)

The Android build embeds a Maps key (EAS secret `GOOGLE_MAPS_ANDROID_API_KEY`, read in `mobile/app.config.ts`). Anyone can pull it out of the
APK, so the key must be useless anywhere except this app. **Needs the Google Cloud Console; not verifiable from the repo.**

1. Cloud Console → APIs & Services → Credentials → the key → **Application restrictions: Android apps.** Add package `com.ashantihub.app`
   with the SHA-1 of each signing certificate that ships: the **Play App Signing** certificate (Play Console → App integrity), the **EAS upload/keystore**
   certificate (`eas credentials`), and any debug key used for internal builds.
2. **API restrictions: Restrict key → Maps SDK for Android** only.
3. Quotas: set a daily cap on Map loads for the project, and a **budget alert** (Billing → Budgets) at a low monthly figure.
4. Use a different key for staging builds than for production, so a leaked test key cannot spend the production quota.
5. Record the date this was done and by whom below. Re-check after any change of signing certificate.

| Done | By | Date | Notes |
|---|---|---|---|
| no | | | |
