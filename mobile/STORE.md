# HealthPoint IDR Mobile — Store Readiness (EAS)

Checklist for shipping the Expo app (`mobile/`) to the App Store and Google
Play. This app handles PHI-adjacent claims data — privacy declarations are
part of the release gate, not an afterthought.

## 0. Prerequisites

- [ ] `npm install` in `mobile/` (pins are Expo SDK 52; run
      `npx expo install --check` after any dependency change).
- [ ] `npm run typecheck` passes.
- [ ] Binary assets added (NOT committed): see `assets/README.md` —
      `icon.png` (1024², no alpha), `adaptive-icon.png`, `splash.png`,
      `notification-icon.png`.
- [ ] `app.json → expo.extra.eas.projectId` replaced with the real project
      id (`npx eas init` — the committed `00000000-…` value is a placeholder).
- [ ] Universal-link host: replace the placeholder
      `app.healthpoint.example.com` in `ios.associatedDomains` and the
      Android `intentFilters` with the real domain, and publish
      `/.well-known/apple-app-site-association` + `/.well-known/assetlinks.json`
      on that host. The custom scheme `healthpoint://` works regardless.
- [ ] Production endpoints set in `expo.extra` (`apiUrl`, `keycloakUrl`,
      `keycloakRealm`, `keycloakClientId`) — override per build profile via
      `eas.json` env if environments diverge.
- [ ] Keycloak public client `healthpoint-app` has redirect URI
      `healthpoint://auth/callback` (and the universal-link callback if used),
      PKCE enabled, `offline_access` scope allowed.

## 1. Build

```bash
cd mobile
npx eas build --profile preview --platform ios       # internal/Simulator smoke
npx eas build --profile production --platform ios
npx eas build --profile production --platform android
```

- Version: `app.json → expo.version` (1.0.0); iOS `buildNumber` and Android
  `versionCode` auto-increment via `eas.json → production.autoIncrement`
  (`cli.appVersionSource: remote`).
- First iOS build: EAS prompts for Apple team + distribution certs (or
  `eas credentials`).

## 2. Submit

```bash
npx eas submit --platform ios     # needs App Store Connect app + API key
npx eas submit --platform android # needs Play Console service account JSON
```

Fill `submit.production` in `eas.json` with `appleId` / `ascAppId` /
`appleTeamId` (iOS) and `serviceAccountKeyPath` / `track` (Android) —
never commit the key files themselves.

## 3. Screenshots (both stores)

Capture on physical device (or iOS simulators 6.7"/6.5", Android emulator):

1. Login screen (SSO brand shot).
2. Disputes list with status badges and filter chips.
3. Dispute detail — IDR timeline expanded.
4. Dispute detail — amounts/deadlines cards.
5. Alerts tab with unread items + tab badge.
6. Profile tab (org card visible).
7. Biometric lock screen (App Store reviewers like seeing the re-auth gate
   for a PHI app).

## 4. Privacy declarations

This is a healthcare claims app. Tokens live in expo-secure-store (Keychain /
EncryptedSharedPreferences); cached dispute/notification payloads live in
AsyncStorage and are wiped on sign-out.

### App Store — App Privacy (nutrition labels)

| Data type                 | Collected? | Linked to user | Purpose            |
| ------------------------- | ---------- | -------------- | ------------------ |
| Contact info (name/email) | Yes (SSO)  | Yes            | App functionality  |
| User ID (Keycloak sub)    | Yes        | Yes            | App functionality  |
| Health/medical claims data| Yes        | Yes            | App functionality  |
| Financial info (amounts)  | Yes        | Yes            | App functionality  |
| Documents (uploads)       | Yes        | Yes            | App functionality  |
| Device push token         | Pending —  | —              | (see note)         |
| Tracking / advertising    | No         | —              | —                  |

Note: push-token upload is gated on a server endpoint that does not exist
yet (`src/notifications/push.ts` → `PUSH_TOKEN_ENDPOINT`). Declare the device
token as collected ("App functionality", not tracking) once that ships.

### Google Play — Data safety

- Data encrypted in transit: **Yes** (HTTPS only; Bearer JWT).
- Data deletion request mechanism: **Yes** (account deletion via support —
  link the privacy policy page).
- Collected & shared: personal info (name, email, user ID), health
  info (claims), financial info (dispute amounts), files & docs — all
  "App functionality", none shared with third parties, none used for ads.
- No data collected for analytics/ads/personalisation.

### HIPAA/BAA note

This app surfaces PHI (patient state, claim references). Confirm the hosting
stack's BAA coverage before production release; the store listings must link
to a privacy policy URL that states retention and deletion terms.

## 5. Permissions justification

| Permission / usage string        | Why                                                        |
| -------------------------------- | ---------------------------------------------------------- |
| iOS `NSFaceIDUsageDescription`   | Biometric re-entry lock protecting PHI (BiometricGate)     |
| Android `POST_NOTIFICATIONS`     | Deadline/determination alerts (expo-notifications)         |
| (implicit) `INTERNET`            | API + Keycloak traffic                                     |

No camera/location/contacts permissions are requested. Do not add any
without updating this table and both privacy declarations.

## 6. Known pre-submission gaps

- [ ] Binary icon/splash assets (see §0).
- [ ] Real universal-link host + AASA/assetlinks files.
- [ ] Server push-token endpoint (push registration is otherwise a no-op).
- [ ] Expo Go cannot exercise push/biometrics on all paths — validate on a
      physical device via a `development` build.
