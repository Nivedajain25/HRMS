# Stencil HRMS — mobile app (`@stencil/mobile`)

Native Android / iOS app built with **Expo SDK 57** (React Native 0.86, React 19.2) and
**Expo Router** (file-based, typed routes). It talks to the same API as the web app and
imports business rules (Zod schemas, permissions, workflow state machines, labels) from
`@stencil/shared` and DTO types from `@stencil/types`.

## Structure

```
index.tsx                    app entry (see "Entry point & assets" below)
assets/fonts/                Inter 400/500/600/700 (SIL OFL, see OFL.txt), bundled locally
app/                         Expo Router routes (thin files that re-export screens)
  _layout.tsx                providers, fonts, splash, auth gate (Stack.Protected)
  (auth)/login.tsx
  (app)/_layout.tsx          push registration + notification tap routing
  (app)/(tabs)/_layout.tsx   bottom tabs: Home, Attendance, Leave, Approvals*, More
  (app)/(tabs)/index.tsx     Home
  (app)/(tabs)/attendance/   clock in/out (selfie + GPS), history, regularizations
  (app)/(tabs)/leave/        balances, requests, apply, cancel
  (app)/(tabs)/approvals/    leave / regularization / expense inbox — tab only for
                             leave:approve, attendance:approve, expense:approve or expense:pay
  (app)/(tabs)/more/         payslips, expenses, notifications, announcements, profile,
                             documents, assets, team, settings, sign-out
src/
  theme/                     tokens mirroring apps/web/src/styles/index.css, ThemeProvider
  components/                Screen, Header, Card, Button, TextField, Select, DateField,
                             Badge/StatusBadge, Avatar, EmptyState, ErrorState, Skeleton,
                             ListItem, SectionHeader, BottomSheet, ConfirmSheet, Toast…
  lib/                       api (fetch + refresh), auth (zustand), push, links, time, format
  features/<name>/           feature code (api.ts, components/, screens/)
scripts/                     generate-icons.mjs (PNG assets), typegen.cjs (typed routes)
```

## Configuration

| Variable              | Where                              | Purpose                                                                 |
| --------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | `eas.json` → `build.<profile>.env` | Origin of the Stencil deployment, e.g. `https://hr.example.com`. The API is `${EXPO_PUBLIC_API_URL}/api/v1`. |
| EAS project id        | `app.json` (`expo.extra.eas.projectId`, written by `eas init`) or `EAS_PROJECT_ID` env | Required for Expo push tokens. |

Phones cannot reach `localhost` or a LAN-only server: the API must be reachable on
**public HTTPS** (valid certificate). For local development create `apps/mobile/.env`
with `EXPO_PUBLIC_API_URL=https://<your-tunnel-or-server>`.

## In-app updates (Android)

Every push to `main` that touches the mobile app runs **GitHub Actions → Android APK**: it builds the APK,
checks it opens on an emulator, then publishes it as the GitHub release `android-v<build>`
(always available at `https://github.com/Nivedajain25/HRMS/releases/latest/download/stencil-hrms.apk`).

- The API (`GET /api/v1/app/latest`) checks GitHub every 10 minutes. A new release is pushed once as
  "Update available" to every phone on an older build, and phones still behind get a reminder at 10:00 each day.
- On an older build the app pops up **Update available** once a day — the first time the user opens the app or
  signs in that day — until they update ("Remind me tomorrow" closes it for the day). Tapping the notification or
  Settings → About → **Check for updates** opens it any time. "Update now" downloads the APK and opens Android's
  installer; the first time, Android asks to allow "Install unknown apps" for Stencil HRMS.
- Only APKs from this workflow can update each other (same signing key). A phone with an EAS-built app, or an
  APK from before in-app updates existed, needs the latest APK installed by hand once (uninstall first if it was
  an EAS build).
- The release description is the "What's new" text in the app; edit it on GitHub → Releases if needed.

## Building APKs with EAS (cloud)

No Android SDK / Java is needed locally.

> **Warning (this workstation):** do **not** run `pnpm dlx …` from inside the repository.
> The root `.npmrc` points `virtual-store-dir` at the shared `C:/stencil-hrms-pnpm/virtual`,
> and `pnpm dlx` treats that folder as its own and prunes it — deleting every installed
> package of the monorepo (recover with `pnpm install` at the root). Install the EAS CLI
> globally from a folder **outside** the repo instead:
>
> ```powershell
> cd $HOME; pnpm add -g eas-cli      # then run `eas …` inside apps/mobile
> ```
>
> On machines without that `.npmrc`, `pnpm dlx eas-cli <cmd>` is fine.

```powershell
cd apps/mobile
eas login                            # once   (elsewhere: pnpm dlx eas-cli login)
eas init                             # once: creates the EAS project and writes projectId to app.json
# set EXPO_PUBLIC_API_URL for each profile in eas.json first
eas build -p android --profile preview      # installable APK (internal distribution)
eas build -p android --profile production   # Play Store AAB
eas build -p ios --profile production       # needs an Apple developer account
```

If `eas init` cannot write to the config (dynamic `app.config.ts`), add the id manually to
`app.json` → `expo.extra.eas.projectId`, or set `EAS_PROJECT_ID` in each `eas.json` profile's
`env` **and** in your shell when running `eas build`.

Profiles (`eas.json`):

- `development` — development client (APK) for `expo start --dev-client`.
- `preview` — release **APK**, internal distribution (share the link / QR code).
- `production` — Android App Bundle + iOS, auto-incremented build numbers.

Monorepo notes:

- The repository root is uploaded (pnpm workspace). `/.easignore` excludes the
  workstation-specific root `.npmrc` (pnpm store on `C:`), `node_modules`, env files and
  generated native folders. EAS installs with pnpm `10.18.0` (same as `packageManager`).
- The repo is not a git repository; run EAS with `EAS_NO_VCS=1` (and, if EAS picks the wrong
  root, `EAS_PROJECT_ROOT=<repo root>`), or initialise git first.
- Push notifications on Android need FCM credentials: `eas credentials` → Android →
  Google Service Account / FCM V1 key (see Expo "Push notifications setup").

## Development

```powershell
pnpm install                                   # at the repo root
pnpm --filter @stencil/mobile start            # needs a development build on the phone
pnpm --filter @stencil/mobile typecheck        # generates typed routes, then tsc
pnpm exec eslint apps/mobile                   # at the repo root
pnpm --filter @stencil/mobile icons            # regenerate PNG icons from the logomark

# release bundle smoke test — run from apps/mobile (the CLI resolves the project from cwd)
cd apps/mobile; node node_modules/expo/bin/cli export --platform android --output-dir $env:TEMP\stencil-export
```

Browser preview (quick UI checks, no phone needed): start the API with `pnpm --filter @stencil/api
dev:memory`, put `EXPO_PUBLIC_API_URL=http://localhost:5000` in `apps/mobile/.env.local`, allow the
origin in the root `.env` (`CLIENT_URL=http://localhost:5173,http://localhost:8081`), then run
`node node_modules/expo/bin/cli start --web --port 8081` in `apps/mobile`. Camera, GPS, secure
storage and push are native-only; on web the session is not persisted across reloads.

### Entry point & assets

`package.json` → `"main": "index.tsx"` instead of `expo-router/entry`. The stock entry builds
the route context from inside the `expo-router` package; with the pnpm store on `C:` and the app
on `D:`, no relative path exists between them and **no routes get bundled**. `index.tsx` creates
the context next to `app/`. For the same reason the Inter fonts are vendored in `assets/fonts`
(loaded with `require()` in `app/_layout.tsx`) instead of resolved from `@expo-google-fonts/inter`
— Metro's web asset URLs cannot cross drives either.

`expo-doctor`: install it in a scratch folder outside the repo (`pnpm add expo-doctor` there)
and run `node <scratch>/node_modules/expo-doctor/bin/expo-doctor.js` from `apps/mobile`.
Its ".expo is not ignored by Git" warning is expected while the repo is not a git repository.

`metro.config.js` extends Expo's monorepo defaults (repo root is watched so the TypeScript
sources of `packages/shared` and `packages/types` are transpiled) and adds pnpm's external
virtual store to `watchFolders` when it lives outside the repo (this workstation's `.npmrc`).

## Auth & push

- `POST /auth/login` with `X-Client: mobile` returns the refresh token in the body; it is
  stored in SecureStore, the 15-minute access token only in memory. A 401 triggers one
  shared (single-flight) `POST /auth/refresh`; the request is retried once and the user is
  signed out if the refresh fails. A `null` refresh token in the response keeps the stored one.
- After sign-in the app asks for notification permission, registers the Expo push token
  with `POST /devices`, and unregisters it (`DELETE /devices/:token`) before signing out.
  Notification taps route through `src/lib/links.ts` (web link → app route).
