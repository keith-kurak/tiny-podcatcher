import { notifyDownloadsChanged } from './episode-download';
import {
  getAutoDownloadedGuids,
  getAutoPruneEnabled,
  getAutoPruneKeepCount,
  getCachedEpisodes,
  getDownloads,
  getWatchList,
  removeFromDownloads,
  removeFromWatchList,
  unmarkAutoDownloaded,
  type AutoDownloadDestination,
} from './storage';

/**
 * The episode loaded in the phone player, if any. Never pruned, even when it is old:
 * removing the file under a loaded player breaks playback.
 *
 * Set by `AudioProvider`. Module-level so that the background task, which has no React
 * tree, still sees it when it runs in the same runtime as the UI.
 */
let loadedPhoneEpisodeGuid: string | null = null;

export function setLoadedPhoneEpisode(episodeGuid: string | null): void {
  loadedPhoneEpisodeGuid = episodeGuid;
}

interface Candidate {
  podcastId: string;
  episodeGuid: string;
}

/** Publish time of an episode from the cached feed. Unknown dates sort as newest, so they are kept. */
function publishTime(podcastId: string, episodeGuid: string): number {
  const pubDate = getCachedEpisodes(podcastId)?.find((e) => e.guid === episodeGuid)?.pubDate;
  const t = pubDate ? Date.parse(pubDate) : NaN;
  return Number.isFinite(t) ? t : Infinity;
}

/** For each podcast, the candidates past the newest `keep`. */
function overflow(candidates: Candidate[], keep: number): Candidate[] {
  const byPodcast = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byPodcast.get(c.podcastId) ?? [];
    list.push(c);
    byPodcast.set(c.podcastId, list);
  }
  const out: Candidate[] = [];
  for (const [podcastId, list] of byPodcast) {
    if (list.length <= keep) continue;
    const sorted = list
      .map((c) => ({ c, t: publishTime(podcastId, c.episodeGuid) }))
      .sort((a, b) => b.t - a.t)
      .map((x) => x.c);
    out.push(...sorted.slice(keep));
  }
  return out;
}

/** Drop marks whose episode is no longer present at that destination. */
function dropStaleMarks(dest: AutoDownloadDestination, present: Set<string>) {
  const stale = [...getAutoDownloadedGuids(dest)].filter((g) => !present.has(g));
  if (stale.length > 0) unmarkAutoDownloaded(dest, stale);
}

function prunePhone(keep: number): string[] {
  const downloads = getDownloads();
  dropStaleMarks('phone', new Set(downloads.map((d) => d.episodeGuid)));
  const marked = getAutoDownloadedGuids('phone');
  // Only finished downloads count. A queued or running one is not playable yet, so
  // counting it would delete an older episode before its replacement exists.
  const candidates = downloads.filter(
    (d) => d.status === 'complete' && marked.has(d.episodeGuid),
  );
  const removed: string[] = [];
  for (const c of overflow(candidates, keep)) {
    if (c.episodeGuid === loadedPhoneEpisodeGuid) continue;
    removeFromDownloads(c.episodeGuid);
    removed.push(c.episodeGuid);
  }
  if (removed.length > 0) notifyDownloadsChanged();
  return removed;
}

function pruneWatch(keep: number): string[] {
  const list = getWatchList();
  dropStaleMarks('watch', new Set(list.map((w) => w.episodeGuid)));
  const marked = getAutoDownloadedGuids('watch');
  // Every queued episode counts. The phone cannot see which ones the watch has finished
  // downloading, and the watch deletes a file as soon as its episode leaves the list.
  const candidates = list.filter((w) => marked.has(w.episodeGuid));
  const removed: string[] = [];
  for (const c of overflow(candidates, keep)) {
    removeFromWatchList(c.episodeGuid);
    removed.push(c.episodeGuid);
  }
  return removed;
}

export interface PruneResult {
  phone: string[];
  /** Non-empty means the watch list changed. The caller must publish it. */
  watch: string[];
}

/**
 * Remove auto-downloaded episodes past the newest N of each podcast, at each destination
 * that has pruning on. Episodes added by hand are never touched.
 *
 * Does not publish the watch list: the foreground and background callers batch that with
 * their own changes, since each publish sends the full list over Bluetooth.
 */
export function pruneAutoDownloads(
  dests: AutoDownloadDestination[] = ['phone', 'watch'],
): PruneResult {
  const keep = getAutoPruneKeepCount();
  return {
    phone: dests.includes('phone') && getAutoPruneEnabled('phone') ? prunePhone(keep) : [],
    watch: dests.includes('watch') && getAutoPruneEnabled('watch') ? pruneWatch(keep) : [],
  };
}

/**
 * Called when a phone download finishes. A newly finished auto-download is what pushes a
 * podcast past its limit, so this is when the oldest one goes.
 */
export function pruneAutoDownloadsAfterCompletion(episodeGuid: string): void {
  if (!getAutoDownloadedGuids('phone').has(episodeGuid)) return;
  pruneAutoDownloads(['phone']);
}
