# Local Data and OTA Updates

How the phone app's on-device data must change so that a JS update can ship over the air (OTA)
safely, and when a change needs a new native runtime instead.

> **Read this before changing anything the phone app stores** — `apps/mobile/src/lib/storage.ts`,
> the shapes in `apps/mobile/src/lib/types.ts`, or files under the app's documents directory.

---

## 1. Why old JS can meet new data

`apps/mobile/app.config.js` sets `runtimeVersion: { policy: "appVersion" }`. Every build with the
same `version` accepts the same OTA updates, so one runtime can run several JS bundles over its
life: the bundle embedded in the binary, and each update published to it.

Local data does not move with the bundle. The key-value store (`expo-sqlite/kv-store`) and the
downloaded episodes live in app data, and they keep whatever the newest bundle wrote. These cases
can then run an **older** bundle against that data:

| Case | What runs next |
|---|---|
| An update is rolled back on EAS (to the embedded bundle, or to an earlier update) | The older bundle |
| An update fails to launch, and expo-updates falls back to the embedded bundle | The embedded bundle |

Android's **Clear storage** is not one of these cases. expo-updates keeps downloaded updates in
`filesDir/.expo-internal`, which is app data, so Clear storage deletes the update and the stored
data together. **Clear cache** deletes neither.

The oldest bundle that can run against your data is the one embedded in the binary for the current
`version`. Design for it.

---

## 2. The rule: additive only

A local data change can ship OTA only when **the oldest bundle on the same runtime still works
correctly with the new data**, and the new bundle works again after that older bundle has run.

Allowed in an OTA:

- A new key.
- A new **optional** field on a stored object. Old code ignores it.
- A new value that old code never reads.

Not allowed in an OTA:

- Removing or renaming a key or a field.
- Changing a field's type, unit, or meaning.
- Rewriting an existing key into a new format ("migrating in place"). Old code then reads the new
  format.
- Adding a value to a field that old code does read and does not tolerate — for example a new
  `DownloadStatus` that old code would treat as an error or drop.
- Moving or renaming downloaded files that old code finds by path.

Also check the other direction. While the older bundle runs, it updates the keys it knows and
ignores the new ones. When the newer bundle returns, its new keys may be out of date. New code must
tolerate that: treat new keys as a cache that can be stale, and prefer values that heal
themselves on the next write.

---

## 3. When the change is not additive: change the native runtime

If a change breaks the rule in section 2, it **must not ship OTA**. Change the native runtime so
that no older bundle can run against the new data:

1. Bump `version` in `apps/mobile/app.config.js` (for example `1.0.3` → `1.0.4`). With the
   `appVersion` policy, the new `version` is a new runtime, and OTA updates for the old runtime
   never reach it. `bun run bump:phone-version` does **not** do this: it changes the Android
   `versionCode`, which is not part of the runtime version.
2. Ship the change in a store build, not an OTA update.
3. Write the migration in the new build. It can assume the data came from an older build, but it
   never has to survive an older bundle afterward.

A native runtime change also means users who have not installed the new binary stay on the old
runtime. They get no further OTA updates until they update from the store.

This is a separate question from the phone ↔ watch contract. A watch contract change follows
`docs/watch-sync.md` § 2 and the watch API version. Local data is phone-only.

---

## 4. Checklist for a change to stored data

- [ ] Every stored key and field the change touches is listed in the ledger below.
- [ ] Only new keys and new optional fields. No removal, rename, retype, or in-place migration.
- [ ] Old code that reads a changed key still behaves correctly.
- [ ] New code tolerates its new keys being stale or orphaned after an older bundle has run.
- [ ] If any box above fails: bump the runtime (section 3) and ship through the store.
- [ ] The ledger and the change log are updated in the same commit.

---

## 5. Ledger of stored keys

All keys are in `expo-sqlite/kv-store`, defined in `apps/mobile/src/lib/storage.ts`. The ledger
starts on 2026-09-26; keys that existed before then are grouped as the baseline.

| Key | Added by | Notes |
|---|---|---|
| `subscriptions`, `downloads`, `watchList`, `episodes:<podcastId>`, `playback:<guid>`, `playbackProgressEpoch`, `wifiOnlyDownloads`, `subscriptionsViewMode`, storage-limit keys, `watchReportedSizes`, `syncPlaybackProgress`, `onboardingSeen` | Baseline | Shapes as in `storage.ts` and `types.ts` on 2026-09-26 |
| `feedMeta:<podcastId>` | #48 | Derived from `episodes:<podcastId>`. Rebuilt from it when missing |
| `subscriptionsSortMode` | #48 | Old code ignores it |
| `subscriptionsShowLatestDates` | #48 | Old code ignores it |
| `autoDownload:<podcastId>` | Auto-download | Per-podcast opt-in and last-check state |

---

## 6. Change log

Newest first. Add an entry for every change to stored data, including the result of the audit.

### 2026-09-26 — auto-download (`keith/auto-download`)

Additive. OTA-safe on the current runtime.

- New key `autoDownload:<podcastId>`. No existing key or type changed.
- Writes `downloads` and `watchList` only through the existing `addToDownloads` and
  `addToWatchList`, in the existing shapes. An older bundle sees an auto-downloaded episode as an
  ordinary manual add.
- An older bundle stops auto-downloading, and it does not remove `autoDownload:<podcastId>` on
  unsubscribe. `addSubscription` now deletes that key, so a resubscribed podcast starts with
  auto-download off, as intended.

### 2026-09-26 — audit of #48 (auto-refresh feeds, newest episode tag)

Additive. OTA-safe on the current runtime.

- New keys `feedMeta:<podcastId>`, `subscriptionsSortMode`, `subscriptionsShowLatestDates`. No
  existing key or type changed. `playback:<guid>` gained an in-memory change listener, but its
  stored shape is unchanged.
- An older bundle does not update `feedMeta` when it fetches a feed, and does not remove it on
  unsubscribe. When the newer bundle returns, `fetchedAt` can only be older than the real fetch,
  so the feed counts as stale and is fetched again, which rewrites `feedMeta`. The newest-episode
  sort and date tag can be wrong until that fetch. This heals itself.
