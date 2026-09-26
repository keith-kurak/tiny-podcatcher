import { Observe } from 'expo-observe';
import { Platform } from 'react-native';

/**
 * Event names, kept in one place because the dashboard groups by the exact string.
 * `watch.download.completed` and `watch_download_completed` would show up as two
 * unrelated rows, so nothing should ever pass a literal at the call site.
 */
export const ObserveEvent = {
  appStarted: 'app.started',
  watchConnectionChecked: 'watch.connection.checked',
  phoneDownloadCompleted: 'phone.download.completed',
  watchDownloadCompleted: 'watch.download.completed',
  watchPlaybackStarted: 'watch.playback.started',
  watchPlaybackCompleted: 'watch.playback.completed',
} as const;

let configured = false;

/**
 * Configure Observe. Call once, as early as possible — before the first render, so
 * startup metrics are collected under the right settings.
 */
export function configureObserve(): void {
  if (configured) return;
  configured = true;

  Observe.configure({
    environment: __DEV__ ? 'development' : 'production',
    integrations: {
      // Per-route navigation metrics (cold_ttr, warm_ttr, tti) from router state
      // changes. This is what reports navigation; there is no event to log by hand.
      'expo-router': true,
    },
    // Debug builds discard their metrics by default. This app is worked on through a
    // development build, so without this nothing would ever reach the dashboard while
    // developing — the instrumentation would look broken. Set it to false if
    // development traffic starts drowning out real usage.
    dispatchInDebug: true,
  });
}

/**
 * App start. The useful startup numbers are the built-in `cold_ttr`/`warm_ttr`/`tti`
 * metrics that `ObserveRoot` and `markInteractive` record; those land under Metrics,
 * not Events. This event exists so a start is also visible on the Events page and in
 * the session timeline, where the rest of these events appear.
 */
export function logAppStarted(): void {
  Observe.logEvent(ObserveEvent.appStarted, {
    displayName: 'App started',
    attributes: { platform: Platform.OS },
  });
}

/**
 * Whether a watch was paired and reachable at startup.
 *
 * Deliberately records only the count, never node ids or display names — a Wear node's
 * display name is user-set and often a person's name, which has no place in telemetry.
 */
export function logWatchConnectionChecked(nodeCount: number): void {
  Observe.logEvent(ObserveEvent.watchConnectionChecked, {
    displayName: 'Watch connection checked',
    attributes: { connected: nodeCount > 0, nodeCount },
  });
}

/** An episode finished downloading to this phone. */
export function logPhoneDownloadCompleted(attributes: {
  podcastId: string;
  episodeGuid: string;
  durationMs: number;
}): void {
  Observe.logEvent(ObserveEvent.phoneDownloadCompleted, {
    displayName: 'Episode downloaded to phone',
    attributes,
  });
}

/**
 * An episode finished downloading to the watch, as observed from here.
 *
 * The watch does the downloading and reports status back, so this is only ever a
 * second-hand account: it fires when a status the phone has already seen turns
 * `complete`. Completions that happened while this app was closed are not reported —
 * see the seeding note in `watch-status-context`.
 */
export function logWatchDownloadCompleted(attributes: {
  episodeGuid: string;
  sizeBytes: number;
}): void {
  Observe.logEvent(ObserveEvent.watchDownloadCompleted, {
    displayName: 'Episode downloaded to watch',
    attributes,
  });
}

// A type alias, not an interface: only an alias satisfies the attributes' index signature.
type WatchPlaybackAttributes = {
  episodeGuid: string;
  /** `unknown` when the episode is no longer on the watch list. */
  podcastId: string;
  durationSeconds: number;
};

/**
 * An episode was started on the watch, as observed from here: a position synced back
 * from the watch moved it off unplayed.
 *
 * Unlike downloads, this needs no seeding. The phone stores the positions it merges, so a
 * listen synced on one launch is already known on the next and is never logged twice. A
 * listen that happened while this app was closed is logged when it syncs, which can be
 * later than the listen itself.
 *
 * Only seen when playback sync is on, and only when the watch's position is the newer
 * one — an episode then continued on the phone is the phone's play, not the watch's.
 */
export function logWatchPlaybackStarted(attributes: WatchPlaybackAttributes): void {
  Observe.logEvent(ObserveEvent.watchPlaybackStarted, {
    displayName: 'Episode started on watch',
    attributes,
  });
}

/**
 * An episode was finished on the watch, as observed from here: a position synced back
 * from the watch passed the played threshold. Same caveats as `logWatchPlaybackStarted`.
 */
export function logWatchPlaybackCompleted(attributes: WatchPlaybackAttributes): void {
  Observe.logEvent(ObserveEvent.watchPlaybackCompleted, {
    displayName: 'Episode finished on watch',
    attributes,
  });
}
