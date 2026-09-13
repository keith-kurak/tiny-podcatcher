# Watchcasts

## Project

Podcast app built with Expo Router and React Native. Monorepo with the mobile app at `apps/mobile/`. This is an **Android-only** app — always use the `{ ios, android }` object form of `SymbolView` `name` to include Material Symbol names (e.g. `{ ios: 'arrow.trianglehead.2.clockwise', android: 'sync' }`). Never pass iOS-only SF Symbol strings.

## Phone ↔ Watch Sync

`docs/watch-sync.md` is the living reference for how the phone app and the Wear OS app
(`apps/watch/`) exchange data, and for how the watch downloads episodes.

**Read it before changing any of:**

- The Data Layer contract (`packages/shared/src/datalayer.ts`, `DataLayerContract.kt`,
  `WearDataLayerModule.kt` — the paths are mirrored by hand in all three)
- `EpisodeDownloadWorker`, `SyncedWatchEpisodes`, `SyncedSubscriptions`,
  `WatchDownloadStatusReporter`, `DataLayerListenerService`
- `syncWatchEpisodes` / `useWatchDownloadStatusListener` on the phone

**Update it in the same commit as the change.** Revise the affected section, resolve or
amend the matching entry in its Known issues table, and add a Change log entry at the top
of that section. A behavior change that lands without a doc update is incomplete.

### Keep the phone independently shippable

The phone app and the watch app ship as separate artifacts. A phone release must not
require a watch release. Before changing anything the watch reads or writes, follow
**Rules for a phone-only release** in `docs/watch-sync.md` § 2. In short:

- Add fields; never remove, rename, or retype one.
- Never change an existing field's unit or meaning.
- Keep sending every field and every DataItem the watch already requires, on the same
  triggers. Dropping one fails silently — no build error, no runtime error.
- Tolerate missing or unknown values coming from the watch. An older watch omits new
  fields; a newer watch may send status values this phone build has never seen.
- Change all three mirrored contract files together.

### Watch API version

`packages/shared/src/watch-api-version.json` holds the contract version, and is the **only**
place to edit it. `datalayer.ts`, `apps/mobile/app.config.js`, and the watch's
`build.gradle.kts` all read that file.

Bump it only for a contract change: MAJOR when an older peer cannot survive the change
(both sides must then ship together), MINOR for a purely additive change, PATCH for a fix
that alters no wire shape. **Most changes need no bump** — do not bump for phone-only UI,
storage, or playback work.

## Argent Testing Workflow

After making code changes that affect the mobile UI:

1. **Reload the app** — Run `debugger-reload-metro` to push JS changes to the emulator/simulator (don't wait for auto-refresh).
2. **Verify visually** — Take a `screenshot` to confirm the change rendered correctly.
3. **Use discovery before interaction** — Always call `describe` (or `debugger-component-tree`) before tapping. Never guess coordinates from screenshots.

### Device preferences

- Use `list-devices` at session start and prefer already-running devices.
- The user typically has a Pixel 9a Android emulator and an iPhone iOS simulator running.

### When to test

- Any change to UI components, layout, styling, navigation, or screen composition.
- Route structure changes (adding/removing screens, changing tab order).
- Don't need to test for pure logic/data changes with no visual impact.
