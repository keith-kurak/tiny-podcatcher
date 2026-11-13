import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { autoDownloadQueryKey, runAutoDownloadCheck } from './auto-download';
import { pruneAutoDownloads, pruneAutoDownloadsAfterCompletion } from './auto-prune';
import {
  BACKGROUND_REFRESH_TASK,
  syncBackgroundRefreshRegistration,
} from './background-task-registration';
import { downloadEpisode } from './episode-download';
import { feedQueryOptions, publishWatchList } from './queries';
import { queryClient } from './query-client';
import { getAutoDownloadState, getCachedEpisodes, getDownloads, getSubscriptions } from './storage';

/** Feeds fetched at once, as in `useFeedAutoRefresh`. */
const FEED_CONCURRENCY = 4;

/**
 * Stop starting new downloads after this long. WorkManager stops a worker after ten
 * minutes. A download cut off there is left as `downloading`, and the next app start
 * marks it failed, so it is better not to start one that cannot finish.
 */
const DOWNLOAD_BUDGET_MS = 7 * 60 * 1000;

let running = false;

/**
 * One background run: fetch the stale feeds of podcasts that auto-download, apply the
 * auto-download rule, prune, publish the watch list, and download phone episodes.
 *
 * The same steps the app runs when it comes to the foreground, without a React tree.
 * It also drains every pending phone download, so an episode held for Wi-Fi downloads
 * when Wi-Fi arrives, not when the app is next opened.
 */
export async function runBackgroundRefresh(): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    const podcasts = getSubscriptions().filter((p) => {
      const state = getAutoDownloadState(p.id);
      return state.phone.enabled || state.watch.enabled;
    });
    if (podcasts.length === 0) {
      // Auto-download was turned off everywhere, or the last such podcast was removed.
      await syncBackgroundRefreshRegistration();
      return;
    }

    // `prefetchQuery` honours the feed's stale time and never throws, so a fresh feed
    // costs nothing and an unreachable one cannot stop the rest.
    const queue = [...podcasts];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        await queryClient.prefetchQuery(feedQueryOptions(queryClient, p.id, p.feedUrl));
      }
    };
    await Promise.all(Array.from({ length: FEED_CONCURRENCY }, worker));

    const result = runAutoDownloadCheck(podcasts.map((p) => p.id));
    for (const podcastId of result.changedPodcastIds) {
      queryClient.invalidateQueries({ queryKey: autoDownloadQueryKey(podcastId) });
    }

    // The watch downloads by itself once it has the list, so publish before the phone
    // downloads take up the rest of the run.
    const pruned = pruneAutoDownloads(['watch']);
    if (result.watchQueued || pruned.watch.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['watchList'] });
      publishWatchList();
    }

    for (const item of getDownloads()) {
      if (Date.now() - startedAt > DOWNLOAD_BUDGET_MS) break;
      if (item.status !== 'pending') continue;
      const episode = getCachedEpisodes(item.podcastId)?.find((e) => e.guid === item.episodeGuid);
      if (!episode?.audioUrl) continue;
      const outcome = await downloadEpisode(episode.audioUrl, item.podcastId, item.episodeGuid);
      // Wi-Fi-only and not on Wi-Fi. Every other pending item is held for the same reason.
      if (outcome === 'blocked') break;
      if (outcome === 'complete') pruneAutoDownloadsAfterCompletion(item.episodeGuid);
    }
    queryClient.invalidateQueries({ queryKey: ['downloads'] });
  } finally {
    running = false;
  }
}

// Must run at module scope, when the bundle loads. A run with the app closed starts a
// runtime with no UI, and the task has to be defined before the system asks for it.
// `index.ts` imports this file first for that reason.
TaskManager.defineTask(BACKGROUND_REFRESH_TASK, async () => {
  try {
    await runBackgroundRefresh();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('Background refresh failed', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
