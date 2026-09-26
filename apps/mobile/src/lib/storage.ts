import { Directory, File, Paths } from 'expo-file-system';
import { Storage } from 'expo-sqlite/kv-store';

import type { PlaybackProgressEntry } from '@podcatch/shared';

import type { DownloadItem, Episode, PlaybackProgress, Podcast, WatchItem } from './types';

const SUBSCRIPTIONS_KEY = 'subscriptions';
const DOWNLOADS_KEY = 'downloads';
const WATCH_LIST_KEY = 'watchList';
const WIFI_ONLY_KEY = 'wifiOnlyDownloads';
const SUBSCRIPTIONS_VIEW_KEY = 'subscriptionsViewMode';
const SUBSCRIPTIONS_SORT_KEY = 'subscriptionsSortMode';
const SUBSCRIPTIONS_DATES_KEY = 'subscriptionsShowLatestDates';
const PHONE_LIMIT_ON_KEY = 'phoneStorageLimitEnabled';
const PHONE_LIMIT_BYTES_KEY = 'phoneStorageLimitBytes';
const WATCH_LIMIT_ON_KEY = 'watchStorageLimitEnabled';
const WATCH_LIMIT_BYTES_KEY = 'watchStorageLimitBytes';
const WATCH_REPORTED_SIZES_KEY = 'watchReportedSizes';
const SYNC_PLAYBACK_KEY = 'syncPlaybackProgress';
const PLAYBACK_EPOCH_KEY = 'playbackProgressEpoch';
const ONBOARDING_SEEN_KEY = 'onboardingSeen';

function episodesKey(podcastId: string) {
  return `episodes:${podcastId}`;
}

function feedMetaKey(podcastId: string) {
  return `feedMeta:${podcastId}`;
}

function autoDownloadKey(podcastId: string) {
  return `autoDownload:${podcastId}`;
}

export const episodesDir = new Directory(Paths.document, 'episodes');

export function getDownloadPath(episodeGuid: string): string {
  return new File(episodesDir, `${episodeGuid}.mp3`).uri;
}

export function getSubscriptions(): Podcast[] {
  const raw = Storage.getItemSync(SUBSCRIPTIONS_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as Podcast[];
}

export function addSubscription(podcast: Podcast): void {
  const subs = getSubscriptions();
  if (subs.some((s) => s.id === podcast.id)) return;
  subs.push(podcast);
  Storage.setItemSync(SUBSCRIPTIONS_KEY, JSON.stringify(subs));
  // Auto-download is off for a new subscription. A build older than auto-download does
  // not remove this key on unsubscribe, so after an OTA rollback a stale one can outlive
  // its subscription and would otherwise switch the feature back on at resubscribe.
  Storage.removeItemSync(autoDownloadKey(podcast.id));
}

export function removeSubscription(podcastId: string): void {
  const subs = getSubscriptions().filter((s) => s.id !== podcastId);
  Storage.setItemSync(SUBSCRIPTIONS_KEY, JSON.stringify(subs));
  Storage.removeItemSync(episodesKey(podcastId));
  Storage.removeItemSync(feedMetaKey(podcastId));
  Storage.removeItemSync(autoDownloadKey(podcastId));
}

export function getCachedEpisodes(podcastId: string): Episode[] | null {
  const raw = Storage.getItemSync(episodesKey(podcastId));
  if (!raw) return null;
  return JSON.parse(raw) as Episode[];
}

export function setCachedEpisodes(
  podcastId: string,
  episodes: Episode[],
): void {
  Storage.setItemSync(episodesKey(podcastId), JSON.stringify(episodes));
  const meta: FeedMeta = { fetchedAt: Date.now(), latestPubDate: latestPubDate(episodes) };
  Storage.setItemSync(feedMetaKey(podcastId), JSON.stringify(meta));
}

/**
 * A few facts about a podcast's cached episode list, stored beside it.
 *
 * Kept apart from the episodes so the subscriptions tab can sort every podcast by its
 * newest episode without parsing every feed's full episode list on each render.
 */
export interface FeedMeta {
  /**
   * When the episodes were last fetched, in epoch milliseconds. 0 when unknown — a
   * cache written before this record existed — which makes the feed stale at once.
   */
  fetchedAt: number;
  /** Publish time of the newest episode, in epoch milliseconds. Absent if no episode has a parseable date. */
  latestPubDate?: number;
}

function latestPubDate(episodes: Episode[]): number | undefined {
  let latest: number | undefined;
  for (const e of episodes) {
    if (!e.pubDate) continue;
    const t = Date.parse(e.pubDate);
    if (Number.isFinite(t) && (latest === undefined || t > latest)) latest = t;
  }
  return latest;
}

export function getFeedMeta(podcastId: string): FeedMeta {
  const raw = Storage.getItemSync(feedMetaKey(podcastId));
  if (raw) return JSON.parse(raw) as FeedMeta;
  // A cache from before this record existed. Derive it once and write it back, so the
  // episode list is parsed here only the first time.
  const episodes = getCachedEpisodes(podcastId);
  const meta: FeedMeta = { fetchedAt: 0, latestPubDate: episodes ? latestPubDate(episodes) : undefined };
  if (episodes) Storage.setItemSync(feedMetaKey(podcastId), JSON.stringify(meta));
  return meta;
}

export function getDownloads(): DownloadItem[] {
  const raw = Storage.getItemSync(DOWNLOADS_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as DownloadItem[];
}

export function addToDownloads(podcastId: string, episodeGuid: string): void {
  const downloads = getDownloads();
  if (downloads.some((d) => d.episodeGuid === episodeGuid)) return;
  downloads.push({ podcastId, episodeGuid, status: 'pending' });
  Storage.setItemSync(DOWNLOADS_KEY, JSON.stringify(downloads));
}

export function updateDownloadItem(
  episodeGuid: string,
  updates: Partial<Pick<DownloadItem, 'status' | 'localPath'>>,
): void {
  const downloads = getDownloads();
  const idx = downloads.findIndex((d) => d.episodeGuid === episodeGuid);
  if (idx === -1) return;
  downloads[idx] = { ...downloads[idx], ...updates };
  Storage.setItemSync(DOWNLOADS_KEY, JSON.stringify(downloads));
}

export function removeFromDownloads(episodeGuid: string): void {
  const downloads = getDownloads();
  const item = downloads.find((d) => d.episodeGuid === episodeGuid);
  if (item?.localPath) {
    try {
      const file = new File(item.localPath);
      if (file.exists) file.delete();
    } catch {
      // file may already be gone
    }
  }
  const filtered = downloads.filter((d) => d.episodeGuid !== episodeGuid);
  Storage.setItemSync(DOWNLOADS_KEY, JSON.stringify(filtered));
}

export function isInDownloads(episodeGuid: string): boolean {
  return getDownloads().some((d) => d.episodeGuid === episodeGuid);
}

export function getDownloadItem(episodeGuid: string): DownloadItem | undefined {
  return getDownloads().find((d) => d.episodeGuid === episodeGuid);
}

export function getWatchList(): WatchItem[] {
  const raw = Storage.getItemSync(WATCH_LIST_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as WatchItem[];
}

export function addToWatchList(podcastId: string, episodeGuid: string): void {
  const list = getWatchList();
  if (list.some((w) => w.episodeGuid === episodeGuid)) return;
  list.push({ podcastId, episodeGuid });
  Storage.setItemSync(WATCH_LIST_KEY, JSON.stringify(list));
}

export function removeFromWatchList(episodeGuid: string): void {
  const list = getWatchList().filter((w) => w.episodeGuid !== episodeGuid);
  Storage.setItemSync(WATCH_LIST_KEY, JSON.stringify(list));
}

export function isOnWatchList(episodeGuid: string): boolean {
  return getWatchList().some((w) => w.episodeGuid === episodeGuid);
}

/**
 * Restrict episode downloads to unmetered networks. Applies to the phone and, via the
 * Data Layer, to the watch. Defaults to on — podcast episodes are large enough that
 * silently spending cellular data would be a nasty surprise.
 */
export function getWifiOnlyDownloads(): boolean {
  const raw = Storage.getItemSync(WIFI_ONLY_KEY);
  if (raw == null) return true;
  return raw === 'true';
}

export function setWifiOnlyDownloads(enabled: boolean): void {
  Storage.setItemSync(WIFI_ONLY_KEY, String(enabled));
}

/**
 * Whether the one-time onboarding has been shown.
 *
 * Defaults to false so an existing install that predates this flag still sees it once.
 * Written when the flow is completed *or* skipped — skipping is a decision, and showing
 * it again on the next launch would ignore that.
 */
export function getOnboardingSeen(): boolean {
  return Storage.getItemSync(ONBOARDING_SEEN_KEY) === 'true';
}

export function setOnboardingSeen(): void {
  Storage.setItemSync(ONBOARDING_SEEN_KEY, 'true');
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE LIMITS
//
// Soft limits: going over does not delete anything, it only refuses the NEXT
// download. Both default to on, because an unbounded podcast library will fill a
// phone — and especially a watch — without ever announcing it.
//
// The phone limit is measured against bytes actually on disk. The watch limit is
// measured against feed-declared enclosure sizes for queued episodes, since the
// phone cannot see the watch's filesystem. See docs/watch-sync.md.
// ─────────────────────────────────────────────────────────────────────────────

/** Default phone allowance: 10 GB. */
export const DefaultPhoneLimitBytes = 10 * 1024 ** 3;
/** Default watch allowance: 1.5 GB. Watches have far less room than phones. */
export const DefaultWatchLimitBytes = 1.5 * 1024 ** 3;

function getBooleanSetting(key: string, fallback: boolean): boolean {
  const raw = Storage.getItemSync(key);
  if (raw == null) return fallback;
  return raw === 'true';
}

function getBytesSetting(key: string, fallback: number): number {
  const raw = Storage.getItemSync(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  // A corrupt or non-positive stored value would silently block every download.
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getPhoneStorageLimitEnabled(): boolean {
  return getBooleanSetting(PHONE_LIMIT_ON_KEY, true);
}

export function setPhoneStorageLimitEnabled(enabled: boolean): void {
  Storage.setItemSync(PHONE_LIMIT_ON_KEY, String(enabled));
}

export function getPhoneStorageLimitBytes(): number {
  return getBytesSetting(PHONE_LIMIT_BYTES_KEY, DefaultPhoneLimitBytes);
}

export function setPhoneStorageLimitBytes(bytes: number): void {
  Storage.setItemSync(PHONE_LIMIT_BYTES_KEY, String(Math.round(bytes)));
}

export function getWatchStorageLimitEnabled(): boolean {
  return getBooleanSetting(WATCH_LIMIT_ON_KEY, true);
}

export function setWatchStorageLimitEnabled(enabled: boolean): void {
  Storage.setItemSync(WATCH_LIMIT_ON_KEY, String(enabled));
}

export function getWatchStorageLimitBytes(): number {
  return getBytesSetting(WATCH_LIMIT_BYTES_KEY, DefaultWatchLimitBytes);
}

export function setWatchStorageLimitBytes(bytes: number): void {
  Storage.setItemSync(WATCH_LIMIT_BYTES_KEY, String(Math.round(bytes)));
}

/**
 * Size of an episode's audio on this phone, or undefined if it is not downloaded.
 * Reads the file rather than trusting the feed, since this is what actually
 * occupies the device.
 */
export function getDownloadedSizeBytes(episodeGuid: string): number | undefined {
  const item = getDownloads().find((d) => d.episodeGuid === episodeGuid);
  if (item?.status !== 'complete' || !item.localPath) return undefined;
  try {
    const file = new File(item.localPath);
    return file.exists ? (file.size ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/** Total bytes the downloaded episodes occupy on this phone. */
export function getPhoneUsedBytes(): number {
  let total = 0;
  for (const item of getDownloads()) {
    if (item.status !== 'complete' || !item.localPath) continue;
    try {
      const file = new File(item.localPath);
      if (file.exists) total += file.size ?? 0;
    } catch {
      // A file that cannot be read contributes nothing rather than aborting the sum.
    }
  }
  return total;
}

/**
 * Sizes the watch has measured for its completed downloads, keyed by episode guid.
 *
 * Persisted rather than kept in the status context: the watch limit is checked from
 * `WatchToggle` through plain storage calls, which cannot read React state — and the
 * numbers must survive an app restart or the watch being out of range.
 */
export function getWatchReportedSizes(): Record<string, number> {
  const raw = Storage.getItemSync(WATCH_REPORTED_SIZES_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Merge in sizes from a watch status report. Merged, not replaced: a report only covers
 * what the watch currently has queued, and a zero means "not downloaded yet" or "old
 * watch build" — neither should erase a size already measured.
 */
export function mergeWatchReportedSizes(sizes: Record<string, number>): void {
  const current = getWatchReportedSizes();
  let changed = false;
  for (const [guid, size] of Object.entries(sizes)) {
    if (size > 0 && current[guid] !== size) {
      current[guid] = size;
      changed = true;
    }
  }
  // Drop guids no longer on the watch list so the map cannot grow without bound.
  const queued = new Set(getWatchList().map((w) => w.episodeGuid));
  for (const guid of Object.keys(current)) {
    if (!queued.has(guid)) {
      delete current[guid];
      changed = true;
    }
  }
  if (changed) {
    Storage.setItemSync(WATCH_REPORTED_SIZES_KEY, JSON.stringify(current));
  }
}

/**
 * Total bytes of every episode queued for the watch.
 *
 * Prefers the size the watch measured for a completed download, and falls back to the
 * size the feed declared for anything not yet downloaded. Still an estimate at the
 * margin: an episode that is queued but not downloaded, from a feed that omits
 * `enclosure/@length` (audioboom publishes `length="0"`), counts as zero. Erring toward
 * letting a download through beats blocking one that would have fit.
 */
export function getWatchQueuedBytes(): number {
  const reported = getWatchReportedSizes();
  let total = 0;
  for (const item of getWatchList()) {
    const measured = reported[item.episodeGuid];
    if (measured > 0) {
      total += measured;
      continue;
    }
    const episode = getCachedEpisodes(item.podcastId)?.find(
      (e) => e.guid === item.episodeGuid,
    );
    total += episode?.sizeBytes ?? 0;
  }
  return total;
}

export interface StorageLimitState {
  /** False only when the limit is on AND already reached. */
  allowed: boolean;
  enabled: boolean;
  usedBytes: number;
  limitBytes: number;
}

/**
 * Whether the phone may take on another download. Soft limit: being over it blocks
 * the next download but never deletes what is already there, so the used total can
 * legitimately exceed the limit.
 */
export function getPhoneLimitState(): StorageLimitState {
  const enabled = getPhoneStorageLimitEnabled();
  const limitBytes = getPhoneStorageLimitBytes();
  const usedBytes = getPhoneUsedBytes();
  return { allowed: !enabled || usedBytes < limitBytes, enabled, usedBytes, limitBytes };
}

/** Whether another episode may be queued for the watch. See getWatchQueuedBytes. */
export function getWatchLimitState(): StorageLimitState {
  const enabled = getWatchStorageLimitEnabled();
  const limitBytes = getWatchStorageLimitBytes();
  const usedBytes = getWatchQueuedBytes();
  return { allowed: !enabled || usedBytes < limitBytes, enabled, usedBytes, limitBytes };
}

/** How the subscriptions tab lays out its podcasts. */
export type SubscriptionsViewMode = 'tile' | 'list';

/**
 * Defaults to the tile grid — artwork is how people recognise a podcast, and the grid
 * shows far more of it per screen.
 */
export function getSubscriptionsViewMode(): SubscriptionsViewMode {
  return Storage.getItemSync(SUBSCRIPTIONS_VIEW_KEY) === 'list' ? 'list' : 'tile';
}

export function setSubscriptionsViewMode(mode: SubscriptionsViewMode): void {
  Storage.setItemSync(SUBSCRIPTIONS_VIEW_KEY, mode);
}

/**
 * How the subscriptions tab orders its podcasts. `unsorted` is the order they were
 * subscribed in; `latest` puts the podcast with the newest episode first.
 */
export type SubscriptionsSortMode = 'unsorted' | 'latest';

export function getSubscriptionsSortMode(): SubscriptionsSortMode {
  return Storage.getItemSync(SUBSCRIPTIONS_SORT_KEY) === 'latest' ? 'latest' : 'unsorted';
}

export function setSubscriptionsSortMode(mode: SubscriptionsSortMode): void {
  Storage.setItemSync(SUBSCRIPTIONS_SORT_KEY, mode);
}

/** Whether each podcast on the subscriptions tab shows its newest episode's date. On by default. */
export function getSubscriptionsShowLatestDates(): boolean {
  return Storage.getItemSync(SUBSCRIPTIONS_DATES_KEY) !== 'false';
}

export function setSubscriptionsShowLatestDates(show: boolean): void {
  Storage.setItemSync(SUBSCRIPTIONS_DATES_KEY, String(show));
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-DOWNLOAD
//
// Per podcast, opt-in, and off by default. See lib/auto-download.ts for the rule
// that reads and writes this.
// ─────────────────────────────────────────────────────────────────────────────

export type AutoDownloadDestination = 'phone' | 'watch';

/**
 * What the last auto-download check did for one destination.
 *
 * - `queued`: the latest episode was added to the download queue or the watch list.
 * - `present`: the latest episode was already there, so nothing was added.
 * - `limit`: the storage limit was reached, so nothing was added. Retried on the next check.
 */
export interface AutoDownloadCheck {
  at: number;
  outcome: 'queued' | 'present' | 'limit';
  episodeTitle: string;
}

export interface AutoDownloadDestinationState {
  enabled: boolean;
  /**
   * The newest episode this destination has already handled — queued, or found already
   * present. Never queued again, so deleting an auto-downloaded episode (or removing it
   * on the watch) does not bring it straight back on the next check.
   */
  handledGuid?: string;
  lastCheck?: AutoDownloadCheck;
}

export type AutoDownloadState = Record<AutoDownloadDestination, AutoDownloadDestinationState>;

export function getAutoDownloadState(podcastId: string): AutoDownloadState {
  const raw = Storage.getItemSync(autoDownloadKey(podcastId));
  const stored = raw ? (JSON.parse(raw) as Partial<AutoDownloadState>) : {};
  return {
    phone: stored.phone ?? { enabled: false },
    watch: stored.watch ?? { enabled: false },
  };
}

export function setAutoDownloadState(podcastId: string, state: AutoDownloadState): void {
  Storage.setItemSync(autoDownloadKey(podcastId), JSON.stringify(state));
}

function playbackKey(episodeGuid: string) {
  return `playback:${episodeGuid}`;
}

/**
 * Timestamp substituted for progress entries written before sync existed.
 *
 * Those entries have no `updatedAt`, and treating them as 0 would mean the first sync
 * after upgrading rewound every episode to whatever the watch had. Stamped once, the
 * first time anything asks, so all legacy entries share one plausible recording time —
 * older than anything recorded from now on, newer than nothing.
 */
function legacyProgressEpoch(): number {
  const raw = Storage.getItemSync(PLAYBACK_EPOCH_KEY);
  if (raw != null) return Number(raw);
  const now = Date.now();
  Storage.setItemSync(PLAYBACK_EPOCH_KEY, String(now));
  return now;
}

export function getPlaybackProgress(episodeGuid: string): PlaybackProgress | null {
  const raw = Storage.getItemSync(playbackKey(episodeGuid));
  if (!raw) return null;
  const progress = JSON.parse(raw) as PlaybackProgress;
  return { ...progress, updatedAt: progress.updatedAt ?? legacyProgressEpoch() };
}

/**
 * @param progress `updatedAt` is stamped with the current time when omitted. Pass it
 * explicitly only when writing a position that came from the watch — keeping the watch's
 * timestamp is what stops the same position bouncing back as "newer" on the next sync.
 */
const playbackProgressListeners = new Set<() => void>();

/**
 * Be told whenever any episode's saved position changes — a periodic save while playing,
 * or a position merged in from the watch. Returns the unsubscribe function, in the shape
 * `useSyncExternalStore` expects.
 */
export function subscribePlaybackProgress(listener: () => void): () => void {
  playbackProgressListeners.add(listener);
  return () => playbackProgressListeners.delete(listener);
}

export function setPlaybackProgress(
  episodeGuid: string,
  progress: PlaybackProgress,
): void {
  const stamped: PlaybackProgress = {
    ...progress,
    updatedAt: progress.updatedAt ?? Date.now(),
  };
  Storage.setItemSync(playbackKey(episodeGuid), JSON.stringify(stamped));
  for (const listener of playbackProgressListeners) listener();
}

/**
 * Keep the listen position of an episode the same on the phone and the watch.
 *
 * Defaults to on. Picking up on the watch where the phone left off is the reason the two
 * apps are paired at all, so it is the behaviour people expect without asking for it.
 */
export function getSyncPlaybackProgress(): boolean {
  const raw = Storage.getItemSync(SYNC_PLAYBACK_KEY);
  if (raw == null) return true;
  return raw === 'true';
}

export function setSyncPlaybackProgress(enabled: boolean): void {
  Storage.setItemSync(SYNC_PLAYBACK_KEY, String(enabled));
}

/**
 * Progress for every episode queued on the watch, as wire entries.
 *
 * Scoped to the watch list on purpose. The watch has no use for the position of an
 * episode it does not have, and the phone's full listening history grows without bound.
 */
export function getWatchListPlaybackProgress(): PlaybackProgressEntry[] {
  const entries: PlaybackProgressEntry[] = [];
  for (const item of getWatchList()) {
    const progress = getPlaybackProgress(item.episodeGuid);
    if (!progress || progress.position <= 0) continue;
    entries.push({
      guid: item.episodeGuid,
      positionMs: Math.round(progress.position * 1000),
      durationMs: Math.round(progress.duration * 1000),
      updatedAt: progress.updatedAt ?? legacyProgressEpoch(),
    });
  }
  return entries;
}

/**
 * Apply positions reported by the watch, newest-wins per episode.
 *
 * @param isPlayingLocally guids the phone is playing right now. Their position is moving
 * and is not written to storage on every tick, so a stored value there is stale by
 * construction — applying an incoming position would jump the audio the user is listening
 * to. Skipped entirely, whatever the timestamps say.
 * @returns the guids whose stored position actually changed, so the caller can move a
 * loaded-but-paused player to match.
 */
export function mergeRemotePlaybackProgress(
  entries: PlaybackProgressEntry[],
  isPlayingLocally: (guid: string) => boolean,
): string[] {
  if (!getSyncPlaybackProgress()) return [];
  const applied: string[] = [];
  for (const entry of entries) {
    if (!entry.guid || entry.positionMs <= 0) continue;
    if (isPlayingLocally(entry.guid)) continue;
    const local = getPlaybackProgress(entry.guid);
    if (local && (local.updatedAt ?? 0) >= entry.updatedAt) continue;
    setPlaybackProgress(entry.guid, {
      position: entry.positionMs / 1000,
      // A remote entry may not know the duration yet; the local one often does.
      duration: entry.durationMs > 0 ? entry.durationMs / 1000 : (local?.duration ?? 0),
      // The watch's timestamp, not ours. Re-stamping would make the phone look like the
      // more recent listener and push this same position straight back.
      updatedAt: entry.updatedAt,
    });
    applied.push(entry.guid);
  }
  return applied;
}
