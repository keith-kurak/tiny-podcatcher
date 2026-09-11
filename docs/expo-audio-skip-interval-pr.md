# PR spec: configurable skip intervals in `expo-audio`

**Verified against** `expo/expo` `origin/main` at `95ea613c1a5` (2026-09-11).
**Status of the limitation: still present.** The lock-screen and notification skip
interval is hardcoded to 10 seconds on every platform, and `AudioLockScreenOptions`
has no field to change it.

---

## 1. Evidence on `main`

Five hardcoded values, in four places:

| Platform | File | Value |
| --- | --- | --- |
| Android — notification + session commands | `packages/expo-audio/android/src/main/java/expo/modules/audio/service/AudioControlsService.kt:639` | `const val SEEK_INTERVAL_MS = 10000L` (private, in the companion object) |
| Android — ExoPlayer increments | `packages/expo-audio/android/src/main/java/expo/modules/audio/AudioPlayer.kt:26` | `private const val SEEK_JUMP_INTERVAL_MS: Long = 10_000`, fed to `setSeekForwardIncrementMs` / `setSeekBackIncrementMs` at lines 40–41 |
| Android — button glyphs | `AudioControlsService.kt` ~277, ~306 | `CommandButton.ICON_SKIP_BACK_10` / `ICON_SKIP_FORWARD_10` |
| iOS | `packages/expo-audio/ios/MediaController.swift:332,347` | `remoteCommandCenter.skipForwardCommand.preferredIntervals = [10.0]` and the same for `skipBackwardCommand` |
| Web | `packages/expo-audio/src/MediaSessionController.web.ts:16` | `const SKIP_SECONDS = 10`, used as the fallback when the browser omits `details.seekOffset` |

The option record has no interval field on any of the three mirrors:

- TS: `packages/expo-audio/src/AudioConstants.ts:5` — `AudioLockScreenOptions`
- Kotlin: `packages/expo-audio/android/.../AudioRecords.kt:112` — `class AudioLockScreenOptions`
- Swift: `packages/expo-audio/ios/AudioRecords.swift:79` — `struct LockScreenOptions`

So the comment in `apps/mobile/src/lib/audio-context.tsx` is still correct. Setting
`SKIP_BACK_S` / `SKIP_FORWARD_S` to anything other than 10 still makes the in-app
buttons disagree with the notification buttons, and there is no supported fix.

## 2. Prior art — read this before starting

**An open PR already does this: [expo/expo#44804](https://github.com/expo/expo/pull/44804),
"[audio] Add customizable lock screen skip intervals" by `@radko93`.**

- Opened 2026-04-15. Last activity 2026-08-17. Still `OPEN`.
- Merge state is `DIRTY` / `CONFLICTING` — it conflicts in 7 of the 10 files it touches.
- No approving review. `@alanjhughes` (an expo-audio owner) ran `/verify` on it, so a
  maintainer is interested in the feature.
- The verify bot confirmed a merge blocker, asked the author to rebase, and recorded
  review points. The author has not pushed since.

The API in that PR (`seekForwardIntervalSeconds` / `seekBackwardIntervalSeconds`, both
optional, default 10) matches what this spec proposes. **Reuse it.** Two options:

1. **Preferred:** comment on #44804 offering to take it over, then push a rebased branch.
   Credit `@radko93` as co-author. This keeps the maintainer's review context.
2. Open a fresh PR that supersedes #44804 and links to it, if the author does not reply.

Do not open a competing PR without linking #44804.

## 3. API

Add two optional fields to `AudioLockScreenOptions`:

```ts
/**
 * Number of seconds the lock screen seek-forward button moves playback.
 * @default 10
 */
seekForwardIntervalSeconds?: number;

/**
 * Number of seconds the lock screen seek-backward button moves playback.
 * @default 10
 */
seekBackwardIntervalSeconds?: number;
```

Both optional, both defaulting to 10, so the change is backward compatible.

The TSDoc must state the platform limits, because they are not uniform:

- **Android** only has glyphs for 5, 10, 15, and 30 seconds. Any other value draws the
  generic skip icon, so the button does not show a number.
- **Web** cannot set the interval the browser displays. The value is only a fallback for
  when the browser omits `seekOffset` in the action details.
- **iOS** accepts any interval. `MPSkipIntervalCommand` renders a number for values it
  has a glyph for; state what happens otherwise.

## 4. Validation — one rule, in TypeScript

The previous attempt validated three times and the three disagreed: iOS clamped `0` to
0.1 s, Android clamped to 100 ms (the same interval), and web fell back to 10 s — 100×
longer. The maintainer asked for a single check.

**Do the check once in TypeScript, where the option enters,** then pass the resolved
number to all three platforms. Suggested rule: a non-finite or non-positive value falls
back to the 10 s default. Native code then trusts the value it receives.

## 5. Per-platform work

### iOS — `ios/MediaController.swift`, `ios/AudioRecords.swift`

Small. Add the two fields to `LockScreenOptions`, then set
`skipForwardCommand.preferredIntervals` / `skipBackwardCommand.preferredIntervals`
from them instead of `[10.0]`.

The existing handlers already read `event.interval` off the `MPSkipIntervalCommandEvent`,
so they pick up the configured value with no change. `enableRemoteCommands` runs again on
every option update via `refreshActivePlayable`, so a runtime change to the interval does
reach the command centre.

### Android — three seek paths, not two

This is the part the previous attempt got incomplete. All three must be covered:

1. **Notification action intent** — `ACTION_SEEK_FORWARD` / `ACTION_SEEK_BACKWARD` land in
   `onStartCommand` and call `AudioControlsService.seekForward()` / `seekBackward()`
   (`AudioControlsService.kt:510,516`).
2. **Custom session command** — `AudioMediaSessionCallback.onCustomCommand` calls the same
   two service methods.
3. **media3 player commands** — `onConnect` grants `Player.COMMAND_SEEK_FORWARD` and
   `Player.COMMAND_SEEK_BACK` to every controller. media3 runs these **on the player**, using
   the player's own seek increments, and never calls `service.seekForward()`. This is the
   path used by headphone controls and Android Auto.

Paths 1 and 2 are one edit: make `seekForward()` / `seekBackward()` read the interval from
`currentOptions` instead of `SEEK_INTERVAL_MS`.

Path 3 needs the session player wrapped in a `ForwardingPlayer` that overrides
`getSeekForwardIncrement()` / `getSeekBackIncrement()` and `seekForward()` / `seekBack()`.
Note `AudioControlsService` already imports `ForwardingPlayer` and already wraps the player
in `MetadataInjectingPlayer`, so there is an established place to add this.

Also:

- **Keep the negative-position clamp.** `main` has none: `player.seekTo(player.currentPosition - SEEK_INTERVAL_MS)`
  asks for a negative position near the start of a track. Add `.coerceAtLeast(0)`.
  The maintainer explicitly asked to keep this.
- **Icons.** In `updateSessionCustomLayout`, map the interval to `ICON_SKIP_FORWARD_5` /
  `_10` / `_15` / `_30` and fall back to the generic `ICON_SKIP_FORWARD` / `ICON_SKIP_BACK`.
  Pick the icon from the **same resolved value the seek uses**, so the glyph never disagrees
  with the behaviour.
- `AudioPlayer.kt`'s `SEEK_JUMP_INTERVAL_MS` sets the increments at `ExoPlayer.Builder` time,
  before any options exist. Decide whether to leave it as the default and let the
  `ForwardingPlayer` override it, or to plumb it through. The `ForwardingPlayer` route is
  simpler and keeps the player constructor unchanged.

### Web — `src/MediaSessionController.web.ts`

Best-effort only. Use the configured value in place of `SKIP_SECONDS` as the fallback when
`details.seekOffset` is absent. The browser still decides what it displays.

## 6. Checklist before opening

- [ ] Branch is rebased on current `main` and merges clean.
- [ ] **No `packages/expo-audio/build/` files in the diff.** `/packages/**/build/` is now in
      `.gitignore`; the previous attempt shipped two build artifacts and two of its conflicts
      were files that no longer exist.
- [ ] `AudioMediaSessionCallback` already takes the service in its constructor — no interval
      provider lambda is needed.
- [ ] `resolveSessionPlayer` takes a `LockScreenPlayable`, not an `AudioPlayer`. The previous
      branch was written against the old signature.
- [ ] Contract mirrored in all three files: `AudioConstants.ts`, `AudioRecords.kt`,
      `AudioRecords.swift`.
- [ ] Tests. There is an iOS test target at `packages/expo-audio/ios/Tests/` and a JS test
      directory at `packages/expo-audio/src/__tests__/`. Cover the record defaults and the
      TypeScript validation rule — both are cheap, and the previous attempt had no tests.
- [ ] `CHANGELOG.md` entry under Unpublished, in the repo's format.
- [ ] Docs: `docs/pages/versions/unversioned/sdk/audio.mdx` if the option needs prose beyond
      the generated TSDoc.

## 7. Testing notes

The verify run on #44804 could not measure runtime behaviour. Two traps it recorded:

- `expo-audio` never reached a loaded state on a hosted iOS simulator — `isLoaded` stayed
  `false` and `duration` stayed `0` for both a remote URL and a local file. Cause unknown.
  **Test iOS on a physical device or a local Mac.**
- A `patch-package` patch of `node_modules/expo-audio` silently did nothing on EAS Build,
  because the project had no `postinstall` script. The build carried unmodified `expo-audio`.
  Verify the patch actually applied before trusting a build.

For this repo specifically: the phone app is Android-only, so the Pixel 9a emulator plus a
locally built `expo-audio` is the real test target. Confirm all three Android seek paths —
the notification buttons, the lock screen, and a headphone/Bluetooth skip command.

## 8. Payoff here

Once this lands, `apps/mobile/src/lib/audio-context.tsx` can raise `SKIP_FORWARD_S` to 30
and pass the matching intervals to `setLockScreenOptions`, and the in-app buttons, the
notification, and the lock screen will finally agree. Update the comment at lines 42–58
in the same change.
