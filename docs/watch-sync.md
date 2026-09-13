# Phone ↔ Watch Sync

How the Podcatch phone app and the Wear OS app exchange data, and how the watch downloads episodes.

> **Keep this current.** Any change to the Data Layer contract, the download worker, or watch-side state must be reflected here in the same commit. See [Change log](#change-log).
>
> **Status:** describes behavior as of 2026-09-11. The [Known issues](#known-issues) section lists defects that exist in the code today.
>
> **Shipping a phone change?** Read [Rules for a phone-only release](#rules-for-a-phone-only-release) before touching anything the watch reads.

---

## 1. Participants

| Side | Code | Language |
|---|---|---|
| Phone | `apps/mobile` | TypeScript (Expo Router) |
| Phone native bridge | `apps/mobile/modules/wear-data-layer` | Kotlin (Expo module) |
| Watch | `apps/watch/android` | Kotlin (Wear Compose) |

### Identity constraint

The two apps pair only when **both** conditions hold:

1. Same `applicationId`
2. Same signing key

Per variant:

| Variant | applicationId |
|---|---|
| dev | `com.keithkurak.tinypodcatcher.dev` |
| prod | `com.keithkurak.tinypodcatcher` |

The phone side sets this in `apps/mobile/app.config.js`. The watch side uses `applicationIdSuffix = "dev"` on its debug build type in `apps/watch/android`. A dev phone build cannot pair with a prod watch build.

The watch app is also marked standalone (`com.google.android.wearable.standalone = true` in `AndroidManifest.xml`), so it runs without the phone app installed. It just has nothing to sync.

---

## 2. The contract

Path and key constants are **duplicated by hand in three places**. There is no shared code across the language boundary.

| File | Role |
|---|---|
| `packages/shared/src/datalayer.ts` | Source of truth, by convention |
| `apps/watch/.../data/DataLayerContract.kt` | Watch mirror |
| `apps/mobile/modules/wear-data-layer/.../WearDataLayerModule.kt` | Phone mirror (private consts) |

A change to one without the others breaks sync **silently** — no compile error, no runtime error, just messages that never arrive.

> The comment in `datalayer.ts` says the contract is mirrored in two places. It is three. See [Known issues](#known-issues).

### DataClient paths — persistent, replicated

`DataItem`s survive disconnection and replicate when the devices reconnect. Both are phone → watch.

| Path | Payload | Direction |
|---|---|---|
| `/podcatch/subscriptions` | `{ items, updatedAt }` | phone → watch |
| `/podcatch/watch-episodes` | `{ items, updatedAt }` | phone → watch |
| `/podcatch/settings` | `{ items, updatedAt }` | phone → watch |
| `/podcatch/playback-progress/phone` | `{ items, updatedAt }` | phone → watch |
| `/podcatch/playback-progress/watch` | `{ items, updatedAt }` | **watch → phone** |

`items` is a JSON **string** under the DataMap key `items`. `updatedAt` is a long under `updatedAt`.

### MessageClient paths — transient RPC

Messages are fire-and-forget. They are dropped if the peer is unreachable.

| Path | Direction | Payload | Sent by |
|---|---|---|---|
| `/podcatch/request-sync` | **phone → watch** | empty | `sendForceDownload()` |
| `/podcatch/request-download-status` | phone → watch | empty | `requestWatchDownloadStatus()` |
| `/podcatch/watch-download-status` | watch → phone | JSON array | `WatchDownloadStatusReporter` |
| `/podcatch/retry-watch-episode` | **phone → watch** | episode guid | `retryWatchEpisode()` |

### Settings

`/podcatch/settings` carries settings the phone owns and the watch honours. Payload today:

```json
{ "wifiOnlyDownloads": true, "syncPlaybackProgress": true }
```

`SyncedSettings.update` applies each field only when the payload carries it, so a phone
build predating a field leaves the watch on its stored value. The two directions stay
independently deployable.

The watch stores it in `SharedPreferences("watch-settings")` via `SyncedSettings`, for the
same reason the episode list is persisted — a worker can run in a fresh process. Its default
(`true`) matches the phone's, so the two agree before any sync has happened.

`SyncedSettings.load()` is called from `MainActivity.onCreate`, the settings branch of
`DataLayerListenerService`, `WatchDownloadStatusReporter`, and
`EpisodeDownloadWorker.buildRequest`. `MainActivity.onResume` also reads the replicated
DataItem directly, so a freshly installed watch picks up an existing preference.

### Capabilities

Advertised via `CapabilityClient` so each side can discover the other: `podcatch_phone`, `podcatch_watch`.

### Watch API version

The two apps ship separately. A phone release almost never needs a matching watch release,
and the point of this version is to record the rare case where it does.

One number, declared in one file:

| File | How it is used |
|---|---|
| `packages/shared/src/watch-api-version.json` | **The value.** Edit only this. |
| `packages/shared/src/datalayer.ts` | Re-exports it as `WATCH_API_VERSION` |
| `apps/mobile/app.config.js` | Reads it into `extra.watchApiVersion` |
| `apps/watch/android/app/build.gradle.kts` | Reads it into `BuildConfig.WATCH_API_VERSION` |

It is internal bookkeeping. Nothing is sent over the wire, and neither side refuses to run
on a mismatch. It answers one question after the fact: which phone builds and which watch
builds can be mixed.

**Current version: 1.0.0** — the contract as documented in this section on 2026-09-11. It is
the baseline. It says nothing about builds that shipped before it.

#### When to bump

| Part | Meaning | Examples |
|---|---|---|
| MAJOR | An older peer cannot survive the change. Phone and watch must be released together. | A path removed or renamed. A DataMap key removed or renamed. A payload's shape or unit changed. An existing field's meaning changed. A field that used to be optional becoming required. |
| MINOR | Purely additive. An older peer ignores the new surface and keeps working. | A new path. A new optional field in an existing payload. A new `SyncedSettings` field. A new status value that falls into an existing default branch. |
| PATCH | A fix inside a version that changes no wire shape. | A bug in how a payload is built or read, where the shape itself is unchanged. |

**No bump is the normal case.** Most phone releases touch no contract surface at all. Do not
bump for phone-only UI, storage, or playback changes.

### Rules for a phone-only release

These rules exist so that a phone release does not need a watch release. Follow them and a
change stays MINOR; break one and it is MAJOR, which means shipping both sides at once.

**When the phone sends:**

1. **Add fields, never remove or rename them.** The watch reads a payload field by name.
   A removed field reads as absent, and how the watch handles absent is per-field — some
   fall back, some skip the episode. A renamed field is a removal plus an addition.
2. **Never change the type, unit, or meaning of an existing field.** `positionMs` is
   milliseconds forever. A field that meant "feed-declared size" cannot start meaning
   "measured size".
3. **Keep sending everything the watch already requires.** The episode payload
   (`guid, title, podcastTitle, podcastId, audioUrl, duration, pubDate, artworkUrl`) is a
   floor, not a suggestion. Dropping `audioUrl` does not fail a build on either side — the
   watch simply stops downloading.
4. **Keep publishing every DataItem the watch reads**, on the same triggers. A path the
   phone silently stops writing looks identical to a phone that is out of range.
5. **A new field must be optional on the watch side too.** The phone adding it is only half
   the change; the watch must already tolerate its absence, because an old phone will not
   send it. This is how `SyncedSettings.update` works today — it applies only the fields the
   payload carries.

**When the phone receives:**

6. **Tolerate missing and unknown values.** A new `WatchEpisodeStatus` from a newer watch
   must not crash or blank the UI, and a field an older watch does not send must have a
   fallback. `sizeBytes` is the model: `0` from an old watch means "unknown", and the phone
   falls back to the feed's number.
7. **Never make an incoming watch message mandatory for phone correctness.** The watch is
   often unreachable. Anything the phone needs must have a path that works without it.

**Always:**

8. **Change all three mirrored contract files together** — `datalayer.ts`,
   `DataLayerContract.kt`, `WearDataLayerModule.kt`. Drift here breaks sync with no compile
   error and no runtime error.
9. **A MAJOR bump is a release-coordination task.** Bump the version, ship both artifacts,
   and note it in the change log below.

---

## 3. Phone → watch: the watch episode list

### What the phone sends

`useWatchListMutations.triggerSync()` in `apps/mobile/src/lib/queries.ts` builds the payload. For every entry in the stored watch list it emits:

```
guid, title, podcastTitle, podcastId, audioUrl, duration, pubDate, artworkUrl
```

Episodes whose cached episode record cannot be found are skipped. The payload carries **no download state** — the watch owns that.

`triggerSync()` fires on every watch-list add and remove.

### The phone caps what it will queue

`WatchToggle` refuses to add an episode when the watch storage limit is on and the queue has
already reached it. `getWatchLimitState()` in `apps/mobile/src/lib/storage.ts` sums the
**feed-declared** `enclosure/@length` of every queued episode — the phone cannot see the watch's
filesystem, so this is an estimate, not a measurement.

Two consequences worth knowing:

- Feeds that omit the length, or publish `length="0"` (audioboom does), contribute **zero** to the
  total. A queue of such episodes never trips the limit.
- The limit is **soft** and **phone-side only**. Nothing is sent to the watch, the watch does not
  enforce it, and going over never deletes anything — it only refuses the next add. The watch will
  still download everything already in the list.

The contract is unchanged: `SyncedSettings` does not carry the limit, so the watch has no knowledge
of it. Enforcing on the watch instead would require the limit in all three mirrored contract files
plus `EpisodeDownloadWorker`. See **K20**.

### When the watch receives it

Three entry points call `SyncedWatchEpisodes.update(json)`:

| Entry point | When |
|---|---|
| `DataLayerListenerService.onDataChanged` | Data item changed; works with the app closed |
| `MainActivity.onDataChanged` | Data item changed while the activity is resumed |
| `MainActivity.onResume` → `getDataItems()` | Catches up on items replicated before listening started |

`WearableListenerService` will **start a fresh process** to deliver a Data Layer event if the app is not running.

### What `update()` does

`SyncedWatchEpisodes.update(json)` reconciles the incoming list against in-memory state:

- **`localPath`** — keeps the previous value, else probes disk for `<filesDir>/episodes/<guid>.mp3`
- **`artworkPath`** — keeps the previous value, else probes disk for the hashed artwork filename
- **`downloadProgress`** — `100` if a local file exists, else the previous value, else `0`
- **`error`** — **not carried over.** Always resets to `false`
- **Removed episodes** — their audio file, their artwork (if unshared), and their `PlaybackState` entry are all deleted
- **Tombstoned episodes** — skipped entirely, however the phone lists them (see below)

### Removal is owned by the watch

The phone owns the queue, but *removal* is the one action the watch will not let the phone
undo. "Remove from watch" is a strong statement, and treating it as a hint produced a bad
sequence in the field: the episode vanished, came back as `waiting-wifi` a few minutes later,
and then downloaded itself again on reconnect.

Two independent ways the request gets lost:

1. The phone is out of Bluetooth range.
2. The phone is in range with its app **closed**. The handler is a JS listener in
   `WatchStatusProvider`, so it only runs while the phone app is open. Nothing wakes it.

`SyncedWatchEpisodes.removedGuids` closes both. A removal writes a persisted tombstone, and:

| Mechanism | Effect |
|---|---|
| `update()` skips tombstoned guids | No sync and no replayed DataItem can restore the episode |
| `PhoneRequests.resendPendingRemovals()` | Re-asks the phone on every list arrival and every app open |
| `update()` prunes tombstones absent from the incoming list | The phone dropping the episode *is* the acknowledgement |

Absence from the list is used as the ack deliberately. An explicit ack would mean a fourth
message path across three hand-mirrored contract files, for information the list already
carries.

Pruning is what keeps a tombstone from becoming permanent. Without it, deliberately re-adding
the same episode from the phone later would be silently ignored forever.

**Known trade-off:** a watch whose phone app is never opened again keeps its tombstones
indefinitely. They are small, and the alternative is resurrecting episodes the user deleted.

---

## 4. Watch-side state ownership

| State | Where | Persisted? |
|---|---|---|
| Subscription list | `SyncedSubscriptions` | **No** — memory only |
| Watch episode list | `SharedPreferences("watch-episodes")` via `SyncedWatchEpisodes` | Yes |
| Pending removals | same, under `removedGuids` | Yes |
| Download progress | same | Yes, throttled to every 5% |
| Download error flag | same | Yes |
| Downloaded audio | `<filesDir>/episodes/<guid>.mp3` | Yes, on disk |
| Cached artwork | `<filesDir>/episodes/artwork/<hash>.img` | Yes, on disk |
| Playback position | `SharedPreferences("playback")` via `PlaybackState` | Yes, with an `updatedAt:` per guid — see [Playback progress sync](#7-playback-progress-sync) |

Wear OS kills app processes aggressively, and WorkManager will start a fresh process to run
a worker. **Treat process death as the normal case, not the exception.**

### The load contract

Anything that reads `SyncedWatchEpisodes.episodes` must call `load(context)` first, or it
will see an empty list in a fresh process and conclude there is nothing to download. Current
call sites: `EpisodeDownloadWorker.doWork`, both `DataLayerListenerService` message branches,
`DataLayerListenerService.onDataChanged`, and `MainActivity.onCreate`.

`load()` is idempotent and **first-call-wins** — a later call cannot overwrite a live
in-memory list with a staler copy from disk. `init(context)` wires up preferences and
`episodesDir`; `load()` calls it, so callers rarely need it directly.

### Trust-but-verify on restore

A stored `localPath` or `artworkPath` is only adopted if the file still exists. If a record
claimed a completed download and the file is gone, `downloadProgress` resets to `0` rather
than keeping its stored `100` — otherwise the phone is told a download finished when it did
not. A record that was mid-download keeps its stored progress.

### `hasStoredList`

Distinguishes "the watch has nothing queued" from "this process has no idea what is queued".
Both look like an empty `episodes` list but mean very different things. `EpisodeDownloadWorker`
uses it to decide between `Result.success()` and `Result.failure()`.

`SyncedSubscriptions` is still memory-only. It feeds a browse UI rather than the download
pipeline, so losing it is cosmetic.

---

## 5. The download pipeline

### Enqueue

Four call sites enqueue the worker. All use the unique work name `episode-downloads` with `ExistingWorkPolicy.KEEP`.

| Call site | Trigger |
|---|---|
| `DataLayerListenerService.onDataChanged` | New watch-episode list arrived |
| `DataLayerListenerService.onMessageReceived` | `/podcatch/request-sync` from the phone |
| `MainActivity.enqueueDownloads` | Activity resumed, or live data change |
| `retryEpisodeDownload` (`MainActivity.kt`) | User chose Retry from the long-press menu |

All go through `EpisodeDownloadWorker.buildRequest`, so the network constraint cannot drift
between them: `NetworkType.UNMETERED` when Wi-Fi-only downloads are on, `CONNECTED` otherwise.

**The constraint is fixed at enqueue time.** A request queued under the old setting would
outlive a change to it, so the settings branch of `DataLayerListenerService` re-enqueues with
`ExistingWorkPolicy.REPLACE`. Replacing a running worker is safe — partial downloads resume
from their `.tmp`.

The sites differ in whether they ask for expedited work.

Expedited quota is finite and per-app, so it is **reserved for triggers where a person is
waiting.** Spending it on every automatic list sync is what left none for a deliberate
request — the original cause of "it works for the first few, then stops".

| Trigger | Expedited? |
|---|---|
| `onDataChanged` — phone pushed a list | No — automatic and frequent |
| `request-sync` — force-download from the phone | Yes |
| `MainActivity` — watch app opened | Yes |
| Long-press retry | Yes |

`KEEP` means an enqueue is **discarded** if work with that name already exists in any
non-terminal state. That is safe now that auto-retry and its backoff are gone: a running
worker re-reads the episode list on every loop pass, so clearing an `error` flag makes that
episode eligible without needing to replace the work.

### Network selection

**This is the single biggest factor in download speed.** Wear OS keeps Wi-Fi off while the
watch holds a Bluetooth link to the phone, and proxies all internet traffic over that link.
The proxy runs at a few hundred kbit/s, so a 100 MB episode takes hours.

The proxy also reports `NOT_METERED`. WorkManager's `UNMETERED` constraint is therefore
satisfied, so the worker starts happily and then crawls. No constraint can express "fast".

`HighBandwidthNetwork.acquire()` fixes this. It calls
`ConnectivityManager.requestNetwork` with an explicit transport list — `TRANSPORT_WIFI`,
plus `TRANSPORT_CELLULAR` when the Wi-Fi-only setting is off. **Naming the transports is
what excludes the Bluetooth proxy**, and the request brings Wi-Fi up when a known network is
in range.

Three rules follow from the API:

- **The returned `Network` must be used to open the connection.** The process default stays
  the proxy. `EpisodeDownloadWorker.openConnection` does this for audio and artwork alike.
- **`bindProcessToNetwork` is deliberately not used.** It is process-wide and would drag
  unrelated traffic, including Play Services, off the companion link.
- **The lease must be released.** An unreleased request keeps Wi-Fi awake and flattens the
  battery. The worker releases it in a `finally`.

Acquisition is allowed 45 s. Radio on, associate, DHCP and validation all take real time on
a watch, and a short timeout reports "no Wi-Fi" while it is still connecting.

| Outcome | What the worker does |
|---|---|
| Lease acquired | Downloads on that network |
| No lease, but `isDefaultHighBandwidth()` is true | Downloads on the process default |
| No lease, default is the Bluetooth proxy | Downloads nothing; reports `waiting-wifi`; returns `success()` |

`isDefaultHighBandwidth()` covers a watch with no phone in range and the Wear emulator. In
both, the default network is already Wi-Fi, so `acquire()` may return `null` simply because
there was nothing to bring up. It explicitly rejects `TRANSPORT_BLUETOOTH`.

The last row is a deliberate refusal, not a failure. Crawling over Bluetooth for hours is
worse than waiting. It returns `success()` rather than `retry()` on purpose — `retry()` plus
`KEEP` is exactly what caused **K6**, and the existing triggers (app opened, phone sync,
settings change) re-enqueue soon enough.

**Known trade-off:** a watch that never sees a known Wi-Fi network never downloads. Before
this change it did download, just unusably slowly.

### The worker

`EpisodeDownloadWorker` is a `CoroutineWorker` running on `Dispatchers.IO`.

1. Calls `setForeground()` (see below), then `SyncedWatchEpisodes.load()`, then ensures
   `<filesDir>/episodes` exists
2. If the list is empty: returns `success()` when `hasStoredList` is true (genuinely nothing
   queued), or `failure()` when it is false (no persisted state — reporting success here
   would silently swallow every queued download)
3. If nothing is eligible — no episode with `localPath == null && !error && audioUrl` and
   no missing artwork — returns `success()` **before touching the network**. The enqueue
   sites filter too, but this is the check that holds: WorkManager replays queued work
   after a reboot, and the listener-service filter counts errored episodes the loop below
   skips
4. Consults the crash-loop breaker via `DownloadRunGuard.beginRun()` (see below). A tripped
   breaker means: report `halted`, return `failure()`, run nothing
5. Acquires a high-bandwidth network (see above), or returns early when only the Bluetooth
   proxy is available
6. Calls `downloadArtwork()` — caches every missing artwork image; failures are logged and skipped
7. Loops: takes the **first** episode where `localPath == null && !error && audioUrl.isNotBlank()`
8. Checks the free-space floor (see below) before and during each episode
9. Resumes from `<guid>.mp3.tmp` if one exists (see below), else starts fresh
10. Streams the body to `<guid>.mp3.tmp` in 8 KB chunks
11. Renames `.tmp` → `.mp3` on completion, then calls `markDownloaded`
12. Breaks out of the loop when no eligible episode remains, and returns `Result.success()`
13. Releases the network lease and calls `DownloadRunGuard.endRun()` in a `finally`, whatever
    the outcome

Ordering is the phone's watch-list order. There is no priority and no parallelism — strictly one file at a time.

### Long-running worker

`doWork` calls `setForeground(getForegroundInfo())` before doing anything else. This promotes
the worker to a foreground service for its whole run, so it is not subject to the ~10 minute
job execution limit. Without it, a slow download is killed mid-file — and before resume
existed, that meant restarting at byte 0 forever.

Requirements, all of which must agree:

- `FOREGROUND_SERVICE_DATA_SYNC` permission in the manifest
- `androidx.work.impl.foreground.SystemForegroundService` declared with
  `android:foregroundServiceType="dataSync"` via `tools:node="merge"`
- `ForegroundInfo` built with `ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC`

Promotion failure is caught and logged, not fatal. The work still runs at background
priority, and resume means a truncated attempt is no longer wasted.

### Making the download visible

Being promoted to a foreground service and *showing* something are separate problems. Two
things are needed, and neither is implied by `setForeground()`:

- **`POST_NOTIFICATIONS` must be granted at runtime.** From Android 13 a foreground service
  notification is **not displayed** when it is denied. The service still runs; only the
  notification is hidden. `MainActivity` requests it on first launch. Declaring it in the
  manifest is not enough, and `adb install -r` preserves an existing denial.
- **Wear OS needs an `OngoingActivity`.** A plain foreground-service notification is easy to
  miss. `getForegroundInfo()` wraps the notification in an `OngoingActivity`
  (`androidx.wear:wear-ongoing`) with a static icon and a touch intent back into the app, so
  a running download appears on the watch face and in the launcher.

`OngoingActivity` only adopts a notification that sets both `setOngoing(true)` and
`CATEGORY_PROGRESS`.

To check it is really there, look for `android.wearable.ongoingactivities.EXTENSIONS` in
`adb shell dumpsys notification --noredact`. Confirming `isForeground=true` proves only that
promotion worked, which is why this was missed for so long — see **K17**.

On Android 15 a `dataSync` service is capped at 6 cumulative hours per 24. WorkManager 2.10.0
handles that timeout internally.

### Resume

Partial downloads persist in `<guid>.mp3.tmp` across attempts, including failures.

- If a `.tmp` exists, the request carries `Range: bytes=<size>-`
- `206 Partial Content` → append to the existing file, seeding the byte counter
- `200 OK` → the server ignored the range, so truncate and start over
- Anything else → throw, so the episode is marked failed

`update()` deletes the `.tmp` when an episode leaves the watch list, since partials otherwise
outlive their episode.

### Progress reporting

- **Watch-local** — every whole-percent change calls `updateProgress`
- **To the phone** — throttled to roughly every 5%

Total size comes from `getContentLengthLong()` plus any resumed offset. The `Long` variant
matters because the `Int` one silently wraps above 2 GB.

When the server sends no `Content-Length` — chunked or gzipped responses — no percentage can
be derived. Progress is then set to `EpisodeDownloadWorker.INDETERMINATE` (`-1`), which the
reporter maps to status `downloading` with progress `0`. The phone renders a percentage only
when progress is `> 0`, so such a download reads as "Downloading…" with no number, and the
watch shows `…`. Previously it froze at 1% for the entire transfer.

### Failure handling — network failures retry, everything else is sticky

An exception in the download loop is sorted by `isNetworkGone()`, which matches on
exception **type** rather than message (messages are localised and vary by OEM):
`UnknownHostException`, `SocketTimeoutException`, `ConnectException`,
`NoRouteToHostException`, `PortUnreachableException`, `SSLException`, `SocketException`,
and anything wrapping one of those.

| Kind | What happens |
|---|---|
| Network went away | The episode is **not** marked failed. The run stops and returns `Result.retry()` |
| Anything else — 404, bad URL, full disk | `markError(guid)`, report, **continue to the next episode**, finish with `success()` |

The partial `.tmp` is kept either way, so a retry resumes from it.

The whole run stops on a network failure rather than moving to the next episode: the next
one would fail identically, and each attempt costs another connect timeout.

**Why network failures are not sticky.** A sticky error outranks every other status the
phone can show — `ep.error` is checked before `waitingForWifi` in the reporter — so one
flaky moment left an episode reading "Error" until a human intervened, even after Wi-Fi
came back. That is not a fact about the episode, and it should not need a person to clear.

**Why this is not a return of K6.** The auto-retry removed in Phase 3 backed off
exponentially toward a 5 hour cap while `KEEP` discarded every new request in the meantime,
so a download could sit dead for hours with the UI saying nothing. Three things keep that
from recurring:

- Backoff is `LINEAR` from 30s, topping out near 3 minutes over `MAX_NETWORK_RETRIES` (6).
- After 6 attempts the episode *is* marked failed, so it surfaces rather than retrying
  invisibly forever.
- Every user-initiated trigger enqueues with **`REPLACE`**, not `KEEP` — the phone's
  refresh, the phone's long-press retry, and the watch's long-press retry. A pending
  backoff can no longer swallow a deliberate request. Replacing a running worker is safe;
  partial downloads resume from their `.tmp`.

### Crash-loop breaker

`DownloadRunGuard` (`SharedPreferences("download-guard")`) stops the worker from sustaining
a device boot loop.

The failure shape it exists for: everything past `beginRun()` can plausibly take the whole
device down, because `HighBandwidthNetwork.acquire()` powers the Wi-Fi radio up through
kernel and firmware code the app cannot see into. A firmware panic there reboots the watch —
and WorkManager's `RescheduleReceiver` restarts pending work on `BOOT_COMPLETED`, so the run
re-arms itself after every boot. Reported from the field as a watch stuck rebooting after
first install, with no window to uninstall.

Mechanics:

- `beginRun()` stamps the current boot id (`/proc/sys/kernel/random/boot_id`) before the
  worker touches the network; `endRun()` clears the stamp in the worker's `finally`.
- A stamp left over from an **earlier boot** means the device went down mid-run. `beginRun()`
  folds it into a consecutive-crash counter.
- At **2** consecutive mid-run reboots the breaker trips: `beginRun()` returns `false`, the
  worker reports status `halted` and returns `failure()` — not `retry()`, since nothing may
  re-arm it automatically.
- Any orderly worker exit — success, failure, or retry — resets the counter to zero.
  Tripping therefore requires *consecutive* device crashes (the boot-loop signature), not
  one reboot a month from a dead battery.
- Boot identity, not process identity: Wear kills the worker's process constantly without
  rebooting, and that must never count.

Only a **deliberate user action** re-arms downloads, via `resetBreaker()`:

| Trigger | Call site |
|---|---|
| Opening the watch app | `MainActivity.onCreate`, before `onResume` enqueues |
| Phone refresh button (`/podcatch/request-sync`) | `DataLayerListenerService` |
| Phone long-press retry (`/podcatch/retry-watch-episode`) | `DataLayerListenerService` |

The refused-run path writes no stamp, so a refusal can never be counted as a crash.

### Free-space floor

The worker refuses to take the watch's free storage below **500 MB**
(`EpisodeDownloadWorker.MIN_FREE_BYTES`). The floor protects the *system*, not the download —
Wear OS gets unstable, up to failing to boot, when `/data` runs out.

Three checks, all with the same outcome:

1. Before each episode: `dir.usableSpace < MIN_FREE_BYTES`
2. Once the response reveals the real size: remaining bytes would not fit above the floor
3. In the catch block: a write failed **and** free space is measured below the floor —
   ENOSPC surfaces as a plain `IOException`, and the measurement avoids matching localised
   messages

On any of them the run stops with `success()` (like the no-network refusal — the queue is
left intact, `retry()` plus `KEEP` is the K6 shape), sets a persisted out-of-space flag in
`DownloadRunGuard`, and reports. The reporter maps the flag to status `no-space`. The flag
clears itself on the next pass that finds room, so freeing space plus any normal trigger
(app open, sync, list change) resumes the queue.

This is **not** the phone-side storage limit (K20) — that caps what gets queued; this stops
a queued download from destabilising the watch. A full disk is deliberately not `markError`:
it is not the episode's fault, and freeing space should not require per-episode retries.

### Retrying

Downloading is automatic. The only manual download action is retrying a failure.

There are now three ways to clear a failure, because the watch was the only place that
could and that is the device you are least likely to be holding when you notice:

| Trigger | Effect |
|---|---|
| **Watch** long-press → **Retry download** | `clearError(guid)`, then enqueue |
| **Phone** long-press a failed row → **Retry download** | `/podcatch/retry-watch-episode` with the guid; the watch clears that flag and enqueues |
| **Phone** refresh button | `/podcatch/request-sync`, which now calls `clearAllErrors()` first |

The refresh button clearing failures is deliberate: sync is what someone reaches for when a
download is stuck, and having it skip precisely the episodes that need attention was the
wrong reading of the word.

The phone's long-press offers nothing for a healthy episode — an empty menu is a dead end —
and applies nothing optimistically. The watch reports its own status back, so if the message
is lost the row keeps saying Error, which is the truth.

The dialog holds a **snapshot** of the episode, not a `guid` it re-looks-up in `episodes`.
Removing takes the episode out of the list immediately, so a lookup went `null` while the
dialog was still animating out — which rendered the "not downloaded yet / Retry download"
variant for a frame on the way past. Visibility is now its own flag.

Tapping a non-downloaded episode does nothing. It used to enqueue a download and show a
"Downloading…" toast that lied whenever `KEEP` discarded the request.

Wear Compose Material 1.4 has no `Card(onLongClick)`, so the gestures live in a
`combinedClickable` on the `Row` inside the card. A child clickable wins over the Card's own,
which is why `Card(onClick = {})` is a deliberate no-op.

---

## 6. Watch → phone: download status

`WatchDownloadStatusReporter.reportStatus(context)` reads `SyncedWatchEpisodes.episodes.value` and sends one JSON array to every connected node.

Per episode it derives:

| Field | Rule |
|---|---|
| `status` | `complete` if `localPath != null`, else `error` if `error`, else `halted` if the crash-loop breaker is tripped, else `downloading` if `downloadProgress != 0`, else `no-space` if the last run stopped at the free-space floor, else `waiting-wifi` if held by the Wi-Fi-only setting, else `pending` |
| `progress` | `100` if complete, `0` if error, else `max(downloadProgress, 0)` |
| `sizeBytes` | `File(localPath).length()` when complete, else `0` |

`halted` outranks `downloading` deliberately: a mid-download percentage is persisted, so it
survives exactly the reboots that trip the breaker, and nothing is actually moving. Both
`halted` and `no-space` are read from `DownloadRunGuard`'s persisted state, for the same
cross-process reason as signal 2 below. The phone renders `halted` as
"Paused after watch restarts — sync to retry" and `no-space` as "Watch storage full".

`sizeBytes` is the only field that reports **measured** state rather than derived state. It is
`0` for anything not yet downloaded, and `0` from watch builds predating the field. The phone
treats `0` as "unknown" and falls back to the feed-declared size — never as "uses no space".

`waiting-wifi` exists so the phone can say *why* nothing is happening. Two independent
signals produce it, and both are needed:

1. `SyncedSettings.isWaitingForWifi` — `NET_CAPABILITY_NOT_METERED` is missing. The same
   signal WorkManager's `UNMETERED` constraint uses, so the reported status and the
   constraint that gates the work cannot disagree.
2. `HighBandwidthNetwork.lastAcquireFailed(context)` — an actual acquire attempt found no
   fast network. **The metered check cannot catch this**, because the Bluetooth companion
   proxy reports `NOT_METERED`: with no Wi-Fi anywhere, signal 1 cheerfully says "unmetered,
   all good".

Signal 2 is **persisted** (`SharedPreferences("network-state")`). Wear kills processes
constantly, and the reporter usually runs in a *different* process from the worker that did
the trying — `DataLayerListenerService` starts a fresh one. Held only in memory, the fact
evaporated between the two and the phone was told `pending`, rendering as "Waiting…", when
the watch had already established there was no Wi-Fi to be had. Reported from the field.

It is called after every meaningful state transition: list update, download start, each ~5% step, completion, failure, and on request from the phone.

**It returns early on an empty list.** The phone replaces its whole map with whatever arrives,
so an empty report wipes its UI. An empty list here means either "nothing queued" — in which
case the phone already shows nothing — or "state not loaded yet", which must never be
broadcast as fact.

### Phone side

`useWatchDownloadStatusListener` in `apps/mobile/src/hooks/useWearDataLayer.ts`:

- Subscribes to the `onWatchDownloadStatus` native event
- On mount, sends `/podcatch/request-download-status` once
- On each message, **replaces** its whole map: `setStatuses(new Map(event.statuses.map(...)))`

Replace-not-merge means any report the watch sends becomes the phone's entire view of watch download state.

**`sizeBytes` is the exception — it is merged and persisted.** `mergeWatchReportedSizes()` in
`lib/storage.ts` writes reported sizes to the `watchReportedSizes` key, keyed by guid, and only
for values greater than zero. Two reasons it cannot follow the replace-everything rule:

- The watch storage limit is checked from `WatchToggle` through plain storage calls, which cannot
  read React context. The numbers have to outlive the in-memory map.
- A report covers only what is queued *right now*, and a zero means "not downloaded yet". Replacing
  would drop a measured size every time the watch reported mid-download.

Entries for guids no longer on the watch list are pruned on each merge, so the map cannot grow
without bound. `getWatchQueuedBytes()` prefers a measured size and falls back to the feed's.

The `/podcatch/request-download-status` handler on the watch calls `load()` before reporting,
so a fresh process reports real state rather than nothing.

---

## 7. Playback progress sync

Both ways, so an episode continues on the other device from where you left it. Governed by
the `syncPlaybackProgress` setting, default on.

### Why DataItems and not messages

The device you listened on is usually the one that is *not* connected — a watch on a run, a
phone left at home. The position has to survive the disconnection and replicate on
reconnect, which is exactly what a `DataItem` does and exactly what a message does not.

**One path per writer.** Both nodes can write a `DataItem`, but two writers on one path
means each overwrites the other's copy, and the loser's positions are gone before anyone
merges them.

### Payload

Both paths carry the same array under `items`:

```json
[{ "guid": "…", "positionMs": 812000, "durationMs": 3600000, "updatedAt": 1754500000000 }]
```

Milliseconds on the wire in both directions. The watch works in milliseconds and the phone
in seconds, so one side has to convert; naming a wire unit means it is always the same one.

The phone sends progress **only for episodes on the watch list**. The watch has no use for
the position of an episode it does not have, and the phone's full listening history grows
without bound.

### The merge rule

`updatedAt` is a per-episode timestamp and is the entire conflict resolution rule. The
DataMap's own `updatedAt` says when the *batch* was published and cannot settle a
per-episode conflict.

An incoming entry is applied when **all** of these hold:

| Condition | Why |
|---|---|
| `syncPlaybackProgress` is on | Checked on send *and* on apply. Checking only on send leaves a device publishing positions the other has stopped asking for |
| `positionMs > 0` | A zero is "no position recorded", not "start of the episode" |
| The episode is **not playing** on the receiving device | Its position is advancing and is only written to storage every few seconds, so any stored value is stale by construction. Applying one would jump the audio the listener is hearing |
| The incoming `updatedAt` is newer than the local one | Newest listener wins |

**The incoming timestamp is stored as-is, never re-stamped.** Re-stamping would make the
receiving device look like the more recent listener and push the same position straight
back on its next publish.

Two clocks are being compared, the phone's and the watch's. Wear OS keeps a paired watch
synced to its phone, and the rule's real granularity is "which listening session happened
later", so the residual skew does not matter.

### Loaded but paused

Skipping only the *playing* episode leaves a hole: a paused player still holds its old
position in memory and writes it on pause and on teardown, with a newer timestamp — putting
the old position straight back over the merged one.

So the merge also moves the local player when the episode it applied to is the loaded one:

| Side | Mechanism |
|---|---|
| Phone | `AudioProvider` calls `player.seekTo` on the merged position |
| Watch | `PlaybackState.applyRemoteProgress` raises a `SeekRequest`; `PlaybackService` collects it and seeks |

The watch needs the indirection because `PlaybackState` is a singleton with no handle on
the ExoPlayer. The request is cleared whether or not it could be acted on — the merge is
already durable in preferences, and a stale request would mask the next one.

### Legacy positions

Positions recorded before this feature have no `updatedAt`. Treating them as `0` would mean
the first sync after upgrading rewound every episode to whatever the other device had. Both
sides substitute a single stamped-once epoch instead — `playbackProgressEpoch` in the
phone's kv-store, `legacyProgressEpoch` in the watch's `playback` preferences — so legacy
entries are all older than anything recorded from now on and newer than nothing.

### A save that records nothing must not re-stamp

Both sides save a position on a timer — the phone every ~5 s while playing, the watch from
its player screen's autosave. A save that writes the *same* position must not take a fresh
`updatedAt`, or the device becomes the "most recent listener" for a position it may have
just been handed by the other side, and pushes it straight back.

Each side therefore skips the write when the position has moved less than a second:

| Side | Guard |
|---|---|
| Phone | `saveProgress` compares against the stored progress. When it skips and the session is ending, it still publishes, so a move sitting behind the throttle is not lost |
| Watch | `PlaybackState.savePosition` compares against the **persisted** position from preferences |

The watch comparing against preferences rather than its in-memory map is load-bearing:
`publishPosition` advances the in-memory value once a second to drive the UI *without*
recording it, so comparing there makes every save look like a no-op and nothing persists at
all.

For the same reason `PlaybackProgressSync` publishes from
`PlaybackState.savedProgressSnapshot()`, not from the live `progress` flow. The flow's
position is up to a second ahead of its own timestamp, so publishing it sent a fresh
position judged by a stale clock.

Both defects were found on-device, not by reading the code — see the change log.

### Publish triggers

Throttled to one publish per 30 s on both sides. A save every few seconds during playback
is not worth a `DataItem` put over the companion link, and nothing on the other side reacts
to a position moving in real time. Anything that *ends* a listening session bypasses the
throttle, since that is the position that matters.

| Side | Throttled | Immediate |
|---|---|---|
| Phone | periodic save while playing | pause, switching episode, watch-list change, turning the setting on |
| Watch | periodic save while playing | pause, service teardown, a merge that changed something, settings arriving with the setting on |

The phone's throttle *trails* rather than drops: a pause landing inside the window is
published when the window closes, instead of being the last event of the session and never
sent.

### Receive triggers

| Side | Entry point |
|---|---|
| Watch | `DataLayerListenerService.onDataChanged`, `MainActivity.onDataChanged`, `MainActivity.onResume` → `getDataItems()` |
| Phone | `WearDataLayerModule.onDataChanged`, plus a `getDataItems()` read when JS starts observing |

The phone side is the first `DataClient` listener that module has ever had; before this it
only listened for messages. Both phone entry points filter to the **watch's** path — the
Data Layer delivers a node its own writes back, and the phone must not re-apply its own.

The `getDataItems()` read matters more than the live listener. The normal sequence is that
the watch recorded a position while the phone app was closed, so the item is already sitting
replicated when it next opens.

---

## 8. Up Next — watch only

The watch keeps a queue of up to five episodes, played automatically after the current one.
`SharedPreferences("up-next")` via `UpNextQueue`.

**Nothing about it crosses the Data Layer, and the phone has no notion of it.** No contract
path, no ownership question, nothing mirrored across three files. It is set on the watch
and seen on the watch.

That is a deliberate narrowing. Earlier versions put a queue on the phone too — first one
phone-local queue behind both phone tabs, then a phone-owned queue synced to the watch.
Both were harder to understand than the thing they were automating: two queues invited the
question of which one you were looking at, and managing the watch's queue from the phone
was a layer of indirection over a decision you make in the moment, on the device you are
listening on. This section exists only because the feature touches code this document owns.

### Where it touches synced state

Pruning, in both directions an episode can leave the watch list:

- `SyncedWatchEpisodes.update()` calls `UpNextQueue.pruneTo()` with the incoming guids, and
  `removeEpisode()` drops the guid it removes. An episode that has left the list cannot
  play, so it cannot be up next.
- `DataLayerListenerService` calls `UpNextQueue.load()` **before** `update()`, so the prune
  works on a loaded queue rather than silently pruning an empty one in a fresh process.

Pruning matters because a stale entry is **invisible but still occupies a slot** — nothing
renders it, and the queue reads as full with fewer than five episodes shown.

### On the watch

Queued episodes sort to the top of the list under a Wear `ListHeader` (`Up Next` /
`All episodes`); the headings only appear when something is queued. Long-press offers
`Add to Up Next` / `Remove from Up Next`, and only for a downloaded episode — queuing one
that has not arrived would promise a playback the watch cannot deliver. A full queue shows
a disabled `Up Next is full` chip rather than hiding the option, since an action that
silently vanishes reads as a bug.

Adding scrolls the list to the top. Queuing inserts the Up Next section *above* the current
scroll position, and the list keeps that position — so on a round screen showing two or
three rows the whole change happens off-screen and reads as nothing having happened.
Reported from the field the day it landed.

### Auto-advance

`Player.STATE_ENDED` in `PlaybackService.playNextFromQueue` starts the next queued episode
and removes it from the queue **as it starts**, not when it was queued — an episode is "up
next" until it becomes "now playing".

It **skips** a queued episode with no `localPath` rather than stopping at it, and leaves it
queued. A finished episode restarts from zero and a part-listened one resumes, the same
rule the player screen already used.

---

## 9. Known issues

Open defects. Each is a real, reproducible cause of user-visible breakage.

### Fixed

| # | Issue | Fixed in |
|---|---|---|
| ~~K1~~ | Watch state memory-only; a worker in a fresh process saw an empty list and returned `success()` without downloading anything | Phase 1 |
| ~~K2~~ | `request-download-status` reported before syncing, so a fresh process sent `[]` and wiped the phone's display | Phase 1 |
| ~~K10~~ | `update()` did not carry over `error`, silently re-arming failed episodes on every sync | Phase 1 |
| ~~K3~~ | No `Range` resume; any interruption restarted the file at byte 0 | Phase 2 |
| ~~K4~~ | No `connectTimeout` or `readTimeout`, so a stalled connection hung forever | Phase 2 |
| ~~K5~~ | Expedited quota spent on automatic syncs, leaving none for user-initiated requests | Phase 2 |
| ~~K7~~ | `setForeground()` never called, so downloads were cut off by the execution limit | Phase 2 |
| ~~K8~~ | Progress depended on the `Int` `contentLength`, freezing at 1% when absent | Phase 2 |
| ~~K13~~ | The download loop never checked `isStopped` | Phase 2 |
| ~~K6~~ | `KEEP` plus exponential retry backoff silently dropped requests for up to 5 h | Phase 3 |
| ~~K11~~ | `markError` left a stale percentage and the watch had no error state | Phase 3 |
| ~~K12~~ | Tapping an episode enqueued a download it could not prioritize, behind a toast that lied | Phase 3 |
| ~~K16~~ | All downloads ran over the Bluetooth companion proxy at a few hundred kbit/s. The proxy reports `NOT_METERED`, so the `UNMETERED` constraint was satisfied and the worker crawled instead of stalling | High-bandwidth network |
| ~~K17~~ | `POST_NOTIFICATIONS` was declared but never requested, so the foreground service ran with its notification suppressed. Phase 2 verified `isForeground=true`, which does not imply a visible notification | High-bandwidth network |
| ~~K18~~ | Removing on the watch was fire-and-forget. A lost request — phone out of range, or in range with its app closed — meant the next sync restored the episode and downloaded it again | Durable removal |
| ~~K19~~ | The long-press dialog looked its episode up by guid, so removing it flashed the "not downloaded / Retry" variant during the exit animation | Durable removal |
| ~~K23~~ | `lastAcquireFailed` was in-memory and process-scoped, so the status reporter — usually a different process — never saw it. A download with no Wi-Fi anywhere showed "Waiting…", never "Waiting for Wi-Fi" | Retry and reachability |
| ~~K24~~ | A transient network failure marked the episode errored, and `error` outranks `waiting-wifi` in the reporter, so it read "Error" forever — including after Wi-Fi returned | Retry and reachability |

### Medium — correctness

| # | Issue | Effect |
|---|---|---|
| K9 | `HttpURLConnection` will not follow HTTP↔HTTPS redirects. Podcast prefix URLs redirect constantly. | The redirect page is written and renamed to `.mp3`. A tiny, broken file looks complete. |
| K20 | The watch storage limit is enforced only on the phone. The watch neither receives nor enforces it. | Going over blocks the next add on the phone, but nothing stops the watch downloading what is already queued. |
| K21 | Only a **completed** download has a measured size. A queued-but-not-downloaded episode still falls back to the feed, and audioboom publishes `length="0"`. | Such an episode counts as zero until it finishes. The running total is right for space already used, and can undercount what is still incoming. |
| K22 | Progress sync is governed only by the phone's setting. The watch has no UI to change it, so a watch whose phone app is never opened keeps whatever it last received. | Matches how `wifiOnlyDownloads` already works — the phone owns settings — but means the setting cannot be turned off from the watch alone. |

K9 is deferred as T2, and disappears if T1 (OkHttp) lands first.

K20 is a deliberate scope choice — enforcing on the watch means adding the limit to
`SyncedSettings` in all three mirrored contract files plus `EpisodeDownloadWorker`. Reporting the
measured size (below) narrowed it: the phone's total is now measured for everything already on the
watch, which is the part that determines whether there is room.

K21 is the residue of that, and is self-correcting — the zero is replaced by a real number as soon
as the episode finishes downloading.

### Documentation drift

| # | Issue | Fixed in |
|---|---|---|
| ~~K14~~ | `datalayer.ts` claimed the contract was mirrored in two places; it is three | Wi-Fi-only setting |
| ~~K15~~ | `datalayer.ts` documented `REQUEST_SYNC` as "Watch -> phone"; the phone sends it | Wi-Fi-only setting |

The comments are corrected, but the duplication itself remains. T4 in `docs/todo.md` still
tracks generating the two Kotlin mirrors from `datalayer.ts`.

### Deferred

`docs/todo.md` tracks understood-but-unscheduled work in this area: T1 (migrate to OkHttp),
T2 (K9, cross-protocol redirects), T3 (deterministic download start), T4 (K14/K15, contract
duplication).

---

## 10. Change log

Newest first. Add an entry whenever sync behavior changes.

### 2026-09-11 — watch API version, and the rules that let a phone release ship alone

No behavior change. This adds the bookkeeping that makes independent phone releases safe to
reason about.

- New `packages/shared/src/watch-api-version.json`, the single declaration of the contract
  version. `datalayer.ts` re-exports it as `WATCH_API_VERSION`, `app.config.js` puts it in
  `extra.watchApiVersion`, and the watch's `build.gradle.kts` puts it in
  `BuildConfig.WATCH_API_VERSION`. One file, three readers — a second hand-maintained copy
  would be the same drift problem the three mirrored contract files already have.
- The watch build now enables `buildFeatures.buildConfig`, which AGP 8 defaults off.
- New [Watch API version](#watch-api-version) and [Rules for a phone-only
  release](#rules-for-a-phone-only-release) in section 2: what MAJOR/MINOR/PATCH mean here,
  and the nine rules that keep a phone change from needing a simultaneous watch release.

**Version 1.0.0 is the contract as documented on this date.** It is a baseline, not a claim
about earlier builds. Nothing is sent over the wire and nothing enforces a match; the
version records which builds can be mixed, for a human reading git history.

### 2026-09-04 — crash-loop breaker and free-space floor

Two new refusal paths in the download worker, both surfaced to the phone. **Contract
change: two new `status` values (`halted`, `no-space`) on
`/podcatch/watch-download-status`.** A phone build predating them shows the raw strings'
absence as no status row; the paths and payload shape are unchanged, so the three mirrored
contract files needed only a comment update in `datalayer.ts`.

Prompted by a field report: a watch entered a boot loop on first open of the app, with no
window to uninstall. The suspected trigger is a Wi-Fi firmware panic during
`HighBandwidthNetwork.acquire()`'s radio bring-up; whatever the trigger, WorkManager's
`RescheduleReceiver` restarting pending work on `BOOT_COMPLETED` is what turns one crash
into a self-sustaining loop.

- New `DownloadRunGuard`. `beginRun()`/`endRun()` bracket the worker's network section with
  a persisted boot-id stamp; a stamp surviving into a later boot counts as a mid-run device
  crash. Two consecutive crashes trip the breaker: the worker reports `halted` and returns
  `failure()` without touching the network.
- Only deliberate user actions re-arm it: opening the watch app (`MainActivity.onCreate`),
  the phone's refresh (`request-sync`), and the phone's per-episode retry
  (`retry-watch-episode`).
- `EpisodeDownloadWorker` now refuses to take free storage below 500 MB
  (`MIN_FREE_BYTES`): checked before each episode, re-checked against the response's real
  size, and measured in the catch block so ENOSPC does not need message matching. The run
  stops with `success()`, a persisted flag makes the reporter say `no-space`, and the flag
  clears on the next pass with room. Not `markError` — a full disk is not the episode's
  fault.
- Reporter ordering: `halted` outranks `downloading` (persisted progress survives the
  reboots that tripped it); `no-space` sits between `downloading` and `waiting-wifi`.
- Phone: `WatchEpisodeStatus.status` union gains the two values; the watch tab renders
  "Paused after watch restarts — sync to retry" and "Watch storage full" in the error color.
- The worker now verifies eligibility itself before touching the network: with no
  undownloaded, un-errored audio and no missing artwork it returns `success()` without
  acquiring Wi-Fi or arming the breaker. Previously a non-empty but fully-downloaded list —
  work replayed after a reboot, or a list of only errored episodes (the listener-service
  filter does not exclude `error`) — brought Wi-Fi up for nothing.

Verified: not yet — needs both apps rebuilt. The breaker's crash path also cannot be
exercised on an emulator without inducing a mid-run reboot (e.g. `adb reboot` during a
download, twice).

### 2026-08-07 — Up Next, on the watch only

A queue of up to five episodes on the watch, played automatically after the current one.
**No contract change** — nothing crosses the Data Layer. See [Up Next](#8-up-next--watch-only).

- New `UpNextQueue`, persisted like the rest of watch state. Queued episodes sort to the
  top under a Wear `ListHeader`, with `Add to Up Next` / `Remove from Up Next` in the
  existing long-press dialog, and auto-advance in `PlaybackService`.
- `SyncedWatchEpisodes.update()` and `removeEpisode()` prune it; `DataLayerListenerService`
  loads it before `update()` so a fresh process prunes a real queue rather than an empty one.
- The episode row moved into an `EpisodeCard` composable so the Up Next group and the rest
  of the list cannot drift apart.

Two designs were built and discarded first, both phone-involving, neither committed:

1. A phone-local queue shared by the Downloads and Watch tabs, plus a separate watch queue.
   The Watch tab's Up Next was then a phone-side fiction the watch never saw — queuing on
   the phone did nothing on the watch.
2. A phone-owned queue synced to the watch over a new DataItem plus a request message,
   following the watch-episode-list ownership pattern. It worked end to end, but two
   queues and remote management of the watch's one were harder to follow than the feature
   warranted.

The lesson is in the shape of the thing, not the plumbing: the queue answers "what next, on
this device, right now", which is a decision made where you are listening. Both discarded
designs were attempts to make it answerable from somewhere else.

Verified on the Wear emulator: cold start, long-press a mid-list episode, list jumps to the
top showing `Up Next` / `All episodes`; removing returns it. Auto-advance confirmed from
stored state — a finished episode handed over to the queued one, which left the queue.

Not exercised: the five-episode cap and its "Up Next is full" state, and the skip-over path
where a queued episode has no local file.

### 2026-08-06 — playback progress sync

New setting **Sync latest progress**, default on, and a listen position exchanged both
ways. Adds **K22**. **Contract change: both apps must be rebuilt.**

- Two new `DataItem` paths, one per writer: `/podcatch/playback-progress/phone` and
  `/podcatch/playback-progress/watch`. Mirrored into all three contract files. Payload is
  `[{ guid, positionMs, durationMs, updatedAt }]`, milliseconds in both directions.
- `SyncedSettings` gains `syncPlaybackProgress`. Both sides check it before publishing and
  before applying. `SyncedSettings.update` now applies each field only when the payload
  carries it, so the two sides stay independently deployable.
- Merge is newest-wins on the per-episode `updatedAt`, and never touches an episode that is
  **playing** on the receiving device. The incoming timestamp is stored as-is; re-stamping
  would push the same position straight back.
- A loaded-but-paused player is seeked onto the merged position, or its own pause and
  teardown writes would put the old one back. The watch does it through a new
  `PlaybackState.seekRequest` that `PlaybackService` collects.
- New `PlaybackProgressSync` on the watch; new `lib/playback-sync.ts` on the phone. Both
  throttle to one publish per 30 s, with session-ending events bypassing the throttle.
- `WearDataLayerModule` gains its first `DataClient` listener, plus a `getDataItems()` read
  at subscribe time — the usual case is a position recorded while the phone app was closed.
- Positions predating this change have no timestamp. Both sides substitute a stamped-once
  epoch rather than `0`, so upgrading does not rewind them.
- `publishSettings()` on the phone now assembles the whole settings payload from storage.
  The item is replaced wholesale, so a caller sending only the field it changed would reset
  the others.

- A save that records no new position no longer re-stamps `updatedAt`. Both sides save on a
  timer, and re-stamping an unchanged position makes a device the most recent listener for
  a position it was just given. See [A save that records nothing must not
  re-stamp](#a-save-that-records-nothing-must-not-re-stamp).

Verified end to end on the Wear emulator (`emulator-5556`) against the phone emulator
(`emulator-5554`), both dev builds, with an NPR News Now episode queued to the watch:

1. **Phone → watch.** Played on the phone and paused at 0:34. The watch's preferences held
   `position=34827`, `duration=280058`, and `updatedAt` equal to the phone's timestamp —
   confirming the stamp is stored as-is, not regenerated. Opening the episode on the watch
   resumed from there rather than from zero.
2. **Watch → phone.** Played on the watch to 2:16 and paused. The phone's episode screen
   showed 2:16: the merge both wrote storage and seeked the loaded-but-paused player.
3. **Playing is never overwritten.** With the phone playing, jumped the watch to 3:43 and
   paused so it published a much later position. The phone kept advancing 2:38 → 2:58 and
   never jumped.
4. **Setting off.** Toggled off; the watch's `watch-settings` showed
   `syncPlaybackProgress=false` with `wifiOnlyDownloads` preserved. The watch then played
   to 3:54 and published nothing; the phone received nothing. Toggling back on made both
   sides publish immediately.
5. **Idle stability.** With both sides paused, neither timestamp moved for 95 s.

Two defects were found this way and fixed before landing, neither visible from the code:

- Applying a merge on the phone seeks the loaded player; that seek arrived as a status
  update and the periodic save re-stamped the merged position, publishing an echo ~25 ms
  later. Logs showed receive-then-publish pairs 25–89 ms apart.
- The same re-stamp on the watch, driven by the player screen's autosave, made the two
  sides re-send one stale position to each other every 30 s indefinitely. Observed directly
  as the phone's `updatedAt` advancing by exactly 30000 ms while nothing was playing.

The first fix, applied naively to the watch, then caused a third: comparing against the
in-memory position defeated itself, because the UI ticker had already advanced it, so
pausing stopped persisting entirely. The guard compares against preferences for that
reason.

Not exercised: a real disconnection. Both emulators were paired throughout, so the case the
DataItem choice exists for — a position recorded while the peer is unreachable, replicating
on reconnect — still needs a watch out of Bluetooth range.

### 2026-08-06 — the watch reports its measured download size

Narrows **K20**, adds **K21**. **Contract change: both apps must be rebuilt.**

- `WatchDownloadStatusReporter` adds `sizeBytes` to each entry of the
  `/podcatch/watch-download-status` payload — `File(localPath).length()` when complete, else `0`.
- `WearDataLayerModule.parseStatusJson` reads it with `optLong`, so a watch build predating the
  field yields `0` rather than failing. The two directions are independently deployable.
- `mergeWatchReportedSizes()` persists non-zero sizes to the `watchReportedSizes` key.
  `getWatchQueuedBytes()` prefers them over the feed's, and the watch tab shows the measured value.
- The `sizeBytes` field is documented in `packages/shared/src/datalayer.ts`.
  `DataLayerContract.kt` lists paths only, not payload shapes, so it needed no change.

Verified: both Kotlin sides compile (`:app:compileDebugKotlin` on the watch,
`:wear-data-layer:compileDebugKotlin` on the phone). **Not yet verified on device** — that needs
the two rebuilds.

### 2026-08-05 — phone-side watch storage limit

Adds **K20**. No contract change: `SyncedSettings` is untouched and the watch is unaware of the limit.

- `Episode.sizeBytes` now carries `enclosure/@length` from the feed. `parseEnclosureLength` in
  `lib/rss.ts` rejects anything that is not a positive integer, so `length="0"` becomes `undefined`
  rather than a bogus zero.
- `getWatchLimitState()` sums those sizes across the stored watch list. `WatchToggle` refuses to add
  when the limit is on and the total has reached it.
- Cached episodes from before this change have no `sizeBytes` until their feed is refetched, so the
  estimate reads low until then.
- The watch tab shows each episode's feed-declared size. Rows whose feed omits it show nothing.

### 2026-08-04 — durable removal from the watch

Fixes **K18** and **K19**, both found in field testing.

- `SyncedWatchEpisodes` persists `removedGuids` alongside the episode list. `update()` skips
  any tombstoned guid, so no phone sync and no replayed DataItem can restore an episode the
  user deleted on the watch.
- `PhoneRequests.resendPendingRemovals()` re-asks the phone on every list arrival and every
  app open. Needed because the phone's handler is a JS listener that only runs while its app
  is open — an in-range phone with a closed app silently dropped the request.
- `update()` prunes tombstones the phone no longer lists. That absence is the ack, and the
  pruning is what lets the user deliberately re-add the same episode later.
- The long-press dialog now holds an episode snapshot with its own visibility flag, instead
  of looking the episode up by guid. Removing no longer flashes the "Retry download" variant
  while the dialog animates out.

Verified end to end on the Wear emulator against the phone emulator, isolating each half:

1. With the **phone app force-stopped**, removed "Episode 784: The Cave" (`163093572`).
   Tombstone written, `.mp3` deleted, request sent into the void.
2. Force-stopped and relaunched the watch app. Log shows `Read existing watch episodes from
   Data Layer` — the phone's DataItem still listed the episode — and the list stayed at 8
   with the guid absent. No download ran and no file reappeared. This is the field bug, now
   not reproducing.
3. Started the phone app. The watch logged `Re-sending 1 unacknowledged removal(s)`; the phone
   logged `Watch asked to remove episode 163093572` then `Watch episodes synced to Data
   Layer`; the watch logged `Live data change: watch episodes updated`.
4. `removedGuids` back to `[]` — pruned once the phone stopped listing it.

Also on the phone: the app now opens on Subscriptions. `unstable_settings.anchor` alone did
not do it — verified by pointing the anchor at `(watch)` and watching the app still open on
Phone. Four tab groups each had an `index.tsx`, so all four matched `/` and the
alphabetically first won. `(downloads)`, `(watch)` and `(settings)` now use named anchor
routes, leaving `(subscriptions)/index.tsx` as the only owner of `/`. All four tabs and a
push into an episode detail were re-checked.

### 2026-08-04 — high-bandwidth network, and a visible download

Fixes **K16** and **K17**. Downloads were slow for a reason none of Phase 1-3 touched: every
fix there addressed a stall or a restart, and the transport was the actual problem.

- New `HighBandwidthNetwork`. Requests a network with an explicit transport list
  (`TRANSPORT_WIFI`, plus `TRANSPORT_CELLULAR` when Wi-Fi-only is off), which is what
  excludes the Bluetooth companion proxy. Needs the new `CHANGE_NETWORK_STATE` permission.
- `EpisodeDownloadWorker` opens every connection — audio and artwork — on the acquired
  `Network`, and releases the lease in a `finally`. An unreleased lease keeps Wi-Fi awake.
- When no high-bandwidth network can be had and the default is the proxy, the worker
  downloads nothing and reports `waiting-wifi`. `isDefaultHighBandwidth()` keeps a
  standalone watch and the emulator working, where the default network is already Wi-Fi.
- `WatchDownloadStatusReporter` now treats a failed acquisition as `waiting-wifi` too. The
  existing `isWaitingForWifi` check cannot catch it, because the proxy reports `NOT_METERED`.
  No new wire status, so the three hand-mirrored contract files are untouched.
- `MainActivity` requests `POST_NOTIFICATIONS` on first launch. Without the grant, Android 13+
  suppresses the foreground service notification — the download runs invisibly.
- `getForegroundInfo()` wraps the notification in a Wear `OngoingActivity`
  (new `androidx.wear:wear-ongoing` dependency), so a running download reaches the watch face.

Verified on the Wear emulator (`emulator-5556`, dev variant) against the paired phone
emulator. Logs showed `Acquired high-bandwidth network` → download → `Released
high-bandwidth network` → `Worker result SUCCESS`. A deleted 15,877,482-byte episode came
back byte-exact, as did a 129,048,379-byte one. `dumpsys notification --noredact` showed
`category=progress`, `flags=ONGOING_EVENT|NO_CLEAR|FOREGROUND_SERVICE|SILENT`, and
`android.wearable.ongoingactivities.EXTENSIONS`. The permission prompt appeared on first
launch and `POST_NOTIFICATIONS: granted=true` afterwards.

Also confirmed on a physical Pixel Watch 3 running the prod build: downloads went from
unusably slow to fast. That is the change this entry exists for, and the emulator could not
have shown it — its default network is already Wi-Fi, so it never had a Bluetooth proxy to
escape.

Not exercised: the refusal path. For the same reason, the emulator always has a
high-bandwidth network available. Confirming that a Bluetooth-only watch reports
`waiting-wifi` and downloads nothing still needs a device out of Wi-Fi range.

### 2026-08-02 — Wi-Fi-only downloads

New setting, owned by the phone and honoured by both apps. Also fixes **K14** and **K15**.

- New Data Layer path `/podcatch/settings`, mirrored into all three contract files. Payload
  is `{ wifiOnlyDownloads: boolean }`, default `true` on both sides.
- Watch: new `SyncedSettings`, persisted to `SharedPreferences("watch-settings")`.
- Watch: all enqueue sites now build their request through
  `EpisodeDownloadWorker.buildRequest`, which picks `UNMETERED` vs `CONNECTED`. A settings
  change re-enqueues with `REPLACE`, since the constraint is fixed at enqueue time.
- New wire status `waiting-wifi`, derived from `NET_CAPABILITY_NOT_METERED` so it agrees
  with the WorkManager constraint. Rendered as "Waiting for Wi-Fi" on the phone and a
  wifi-off icon on the watch.
- Phone: gated in `DownloadProvider` using `expo-network` (new dependency). Queued items
  stay `pending` and drain automatically when an unmetered network returns.
- Phone: the mount-time cleanup no longer marks `pending` items as errored — with this
  setting, `pending` is a legitimate resting state.

Verified end to end on both emulators: toggling the switch wrote `wifiOnlyDownloads=false`
to the watch's prefs; with Wi-Fi disabled a queued episode showed "Waiting for Wi-Fi" and did
not download; re-enabling Wi-Fi drained the queue without further input.

### 2026-08-02 — Phase 3: manual retry only

Fixes **K6**, **K11**, **K12**. See `pr-plan.md`.

- No auto-retry. A download failure marks the episode and the queue moves on; the worker
  still finishes with `success()`. Removes the exponential backoff that `KEEP` turned into
  silently-dropped requests.
- `markError` resets `downloadProgress` to `0`, and added `clearError` for manual retry.
- Failed episodes show a red error icon in the watch list, distinct from "not downloaded
  yet", so the retry affordance is discoverable.
- **Long-press** a non-downloaded episode for a menu with **Retry download** / **Cancel**.
  Implemented with `combinedClickable` on the `Row` inside the card — Wear Compose Material
  1.4 has no `Card(onLongClick)`, and a child clickable wins over the Card's own.
- Removed tap-to-download and its "Downloading…" toast. `enqueueEpisodeDownload` is gone,
  replaced by `retryEpisodeDownload`.

Verified on the Wear emulator: a seeded failure survived a phone sync and the worker skipped
it; long-press opened the menu; Retry cleared the flag and the episode downloaded to a
byte-exact file; a plain tap on a failed episode started nothing.

### 2026-08-02 — Phase 2: download robustness

Fixes **K3**, **K4**, **K5**, **K7**, **K8**, **K13**. See `pr-plan.md`.

- `connectTimeout = 15s`, `readTimeout = 30s`. Both previously defaulted to 0 = infinite.
- `Range`-based resume. Partial `.tmp` files now persist across attempts, including
  failures. A `206` appends; a `200` means the server ignored the range, so the partial is
  discarded and the download restarts. `update()` deletes the `.tmp` when an episode leaves
  the watch list.
- `setForeground()` at the top of `doWork`, with `FOREGROUND_SERVICE_DATA_SYNC` and a
  `dataSync` type on WorkManager's `SystemForegroundService`. Removes the ~10 minute
  execution limit. Promotion failure is logged, not fatal.
- Progress uses `getContentLengthLong()` plus the resumed offset. When the server sends no
  `Content-Length`, progress is `INDETERMINATE` (`-1`) and the UI shows activity without a
  number instead of freezing at 1%.
- Expedited work reallocated: automatic Data Layer syncs no longer spend quota; the phone's
  force-download, opening the watch app, and episode taps still do.
- `isStopped` is checked per loop pass and per read. A stopped worker returns `retry()` and
  keeps its partial file.
- Non-2xx responses now throw instead of being written to disk as if they were audio.

Verified on the Wear emulator: killed a download at 37,644,971 / 108,552,377 bytes and the
next attempt logged `Resuming ... at 37644971 bytes`, finishing to a byte-exact file with a
valid ID3 header. `dumpsys` confirmed `isForeground=true types=0x1` during the run. Log
confirmed `expedited=true` for the phone's sync button and `expedited=false` for the
automatic list sync.

Not exercised end to end: the `INDETERMINATE` path. A synthetic chunked-encoding episode
cannot survive on the watch, because every trigger resyncs the list from the phone and drops
it. The reachable half of that change was verified — pending episodes still report `pending`,
not `downloading`, under the reporter's new `!= 0` test.

### 2026-08-02 — Phase 1: persist watch state

Fixes **K1**, **K2**, **K10**. See `pr-plan.md` for the full phase plan.

- `SyncedWatchEpisodes` now persists to `SharedPreferences("watch-episodes")`. Added
  `init`, `load`, and an internal `persist` called from every mutator. Progress writes are
  throttled to every 5%.
- Added the load contract: `load(context)` is called by `EpisodeDownloadWorker.doWork`,
  both `DataLayerListenerService` message branches, `onDataChanged`, and
  `MainActivity.onCreate`. First call wins, so a stale disk copy cannot clobber live state.
- `update()` now carries `error` through. Failures are sticky; retry is manual as of Phase 3.
- `doWork` returns `Result.failure()` — not `success()` — when no persisted list exists.
- `reportStatus` returns early on an empty list instead of broadcasting `[]`.
- Restore validates paths on disk. A record claiming a completed file that no longer exists
  resets to `0%` instead of reporting a phantom `100%`.
- Mutators use `MutableStateFlow.update {}` rather than read-modify-write on `.value`, so
  concurrent updates from the worker thread and the UI thread cannot lose each other.

Verified on the Wear emulator against the paired phone emulator: a force-stopped watch app
reported all 10 episode statuses from a fresh process, and a worker in that fresh process
downloaded a deleted episode using a list restored entirely from disk.

### 2026-08-02 — initial document

Documented existing behavior. No code changes. Catalogued K1–K15 above.
