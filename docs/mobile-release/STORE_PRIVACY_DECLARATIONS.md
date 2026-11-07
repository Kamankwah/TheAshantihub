> **DRAFT — requires review by a qualified Ghanaian lawyer before publication.** Answers must match the final build and the Privacy Policy; re-check before every submission.

# Store privacy declarations — first release

Assumptions: no advertising SDKs, no cross-app tracking, no data sale; error reports via Sentry with PII scrubbed; push via Expo/FCM/APNs [CONFIRM when push ships — omit push rows if not in v1].

## Apple — App Privacy ("nutrition label")
**Tracking (ATT):** *No.* No data is used to track users across other companies' apps/sites. (No ATT prompt.)

| Data type | Collected | Linked to user | Used for |
|---|---|---|---|
| Contact info: name, email, phone | Yes | Yes | App functionality, account, customer support |
| Contact info: physical address (delivery address, GhanaPost) | Yes | Yes | App functionality |
| Financial info: payment info | **No** (handled by payment partner; we keep order/payment references only) | — | — |
| Purchases (order history) | Yes | Yes | App functionality |
| User content: photos/videos (listing media, problem reports, avatar), support messages, reviews | Yes | Yes | App functionality, customer support |
| Identifiers: user ID; device ID/push token | Yes | Yes | App functionality, notifications |
| Sensitive info / Government ID: Ghana Card number & images (businesses only) | Yes | Yes | App functionality (identity verification), fraud prevention |
| Location: coarse/precise (only if the user uses a location feature, e.g. sharing shop location) | Yes (optional) | Yes | App functionality |
| Usage data / diagnostics: crash data | Yes | **No** (PII removed) | App functionality (diagnostics) |
| Biometrics | **No** (Face ID/Touch ID handled on device only) | — | — |
| Health, contacts, browsing/search history, advertising data | No | — | — |

## Google Play — Data safety
- **Does the app collect or share user data?** Collects: yes. **Shares with third parties:** only with service providers acting for us (payment partner, SMS/email, hosting) — mark as "processed on our behalf", not "shared", where Google's definition allows; confirm per provider.
- **Encrypted in transit:** Yes (HTTPS). **Users can request deletion:** Yes — in-app + web link [ACCOUNT DELETION URL].
- **Independent security review:** No.

| Category / type | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|
| Personal info: name, email, phone, address | Yes | No | Email optional | Account management, App functionality |
| Personal info: other (date of birth, gender) | Yes | No | Yes | Account management |
| Financial info: user payment info | No | — | — | — |
| Financial info: purchase history | Yes | No | No | App functionality |
| Photos and videos | Yes | No | Yes | App functionality |
| Messages: in-app messages (Support) | Yes | No | No | App functionality, Customer support |
| Files and docs: Ghana Card images (business) | Yes | No | [Optional or required — match KYC settings] | Fraud prevention, security, compliance |
| Location: approximate/precise | Yes (only on use of the feature) | No | Yes | App functionality |
| App activity / App info and performance: crash logs | Yes | No (service provider: Sentry) | No | Analytics (diagnostics) |
| Device or other IDs: push token | Yes | No | Yes | App functionality (notifications) |

Data is **not** used for advertising; there is **no** data sale.

## Permission strings (iOS Info.plist / Android) — plain language
- `NSFaceIDUsageDescription`: "AshantiHub uses Face ID to unlock the app and protect your account. Your face data stays on your phone."
- Camera: **not requested in v1.** The app only picks existing photos from the library (`launchImageLibraryAsync`), so `NSCameraUsageDescription` and the Android `CAMERA` permission are switched off in `app.config.ts`. Add both back, with an honest string, in the same release that adds a camera feature.
- `NSPhotoLibraryUsageDescription`: "Choose photos to add to a listing, profile or problem report."
- `NSLocationWhenInUseUsageDescription`: "AshantiHub uses your location only when you ask it to: to pin your delivery door so we can work out the delivery fee, or to mark your shop on the map." (matches `app.config.ts`)
- Android: `USE_BIOMETRIC`, `ACCESS_FINE_LOCATION` (only if used), `POST_NOTIFICATIONS` (Android 13+, ask in context), no `READ_SMS` (use the SMS user-consent/retriever flow for code autofill).

## Apple privacy manifest
`ios.privacyManifests` in `app.config.ts` declares no tracking, the required-reason APIs React Native/Expo use (file timestamp, user defaults, boot time, disk space) and the collected data types in the table above. Change it whenever that table changes. After the first `eas build`, open the built `PrivacyInfo.xcprivacy` once and check it against this page.
