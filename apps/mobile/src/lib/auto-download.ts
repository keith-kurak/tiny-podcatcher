import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { useDownloadContext } from './download-context';
import { publishWatchList } from './queries';
import {
  addToDownloads,
  addToWatchList,
  getAutoDownloadState,
  getCachedEpisodes,
  getPhoneLimitState,
  getSubscriptions,
  getWatchLimitState,
  isInDownloads,
  isOnWatchList,
  setAutoDownloadState,
  type AutoDownloadDestination,
  type AutoDownloadDestinationState,
} from './storage';
import type { Episode } from './types';

/**
 * The newest episode in a feed, by publish date.
 *
 * Feeds are usually newest-first, but not all of them, so the date decides. Falls back to
 * the first item when no episode has a parseable date.
 */
export function latestEpisode(episodes: Episode[]): Episode | undefined {
  let latest: Episode | undefined;
  let latestTime = -Infinity;
  for (const e of episodes) {
    const t = e.pubDate ? Date.parse(e.pubDate) : NaN;
    if (Number.isFinite(t) && t > latestTime) {
      latest = e;
      latestTime = t;
    }
  }
  return latest ?? episodes[0];
}

export function autoDownloadQueryKey(podcastId: string) {
  return ['autoDownload', podcastId] as const;
}

/**
 * Decide what one destination does with the latest episode.
 *
 * Returns the destination's next state, and whether to queue the episode. The episode is
 * queued exactly as a manual download would be: with Wi-Fi-only downloads on and no
 * Wi-Fi, it waits in the queue like any other. A full storage limit is the one case that
 * adds nothing — a manual download refuses there too — and it leaves `handledGuid`
 * alone, so the next check tries again once there is room.
 */
function decide(
  dest: AutoDownloadDestination,
  state: AutoDownloadDestinationState,
  episode: Episode,
): { next: AutoDownloadDestinationState; queue: boolean } {
  if (!state.enabled || state.handledGuid === episode.guid) {
    return { next: state, queue: false };
  }

  const present = dest === 'phone' ? isInDownloads(episode.guid) : isOnWatchList(episode.guid);
  if (present) {
    return { next: { ...state, handledGuid: episode.guid }, queue: false };
  }
  const limit = dest === 'phone' ? getPhoneLimitState() : getWatchLimitState();
  if (!limit.allowed) {
    return { next: state, queue: false };
  }
  return {
    next: { ...state, handledGuid: episode.guid },
    queue: true,
  };
}

/**
 * Returns a function that runs the auto-download check for the given podcasts, from
 * their cached episode lists. Cheap and idempotent: a podcast with nothing enabled, or
 * whose latest episode is already handled, does nothing.
 */
export function useAutoDownloadCheck() {
  const queryClient = useQueryClient();
  const { startDownload } = useDownloadContext();

  return useCallback(
    (podcastIds: string[]) => {
      let phoneQueued = false;
      let watchQueued = false;

      for (const podcastId of podcastIds) {
        const state = getAutoDownloadState(podcastId);
        if (!state.phone.enabled && !state.watch.enabled) continue;
        const episode = latestEpisode(getCachedEpisodes(podcastId) ?? []);
        if (!episode?.audioUrl) continue;

        const phone = decide('phone', state.phone, episode);
        const watch = decide('watch', state.watch, episode);
        if (phone.next === state.phone && watch.next === state.watch) continue;

        setAutoDownloadState(podcastId, { phone: phone.next, watch: watch.next });
        queryClient.invalidateQueries({ queryKey: autoDownloadQueryKey(podcastId) });

        if (phone.queue) {
          addToDownloads(podcastId, episode.guid);
          void startDownload(episode.audioUrl, podcastId, episode.guid);
          phoneQueued = true;
        }
        if (watch.queue) {
          addToWatchList(podcastId, episode.guid);
          watchQueued = true;
        }
      }

      if (phoneQueued) queryClient.invalidateQueries({ queryKey: ['downloads'] });
      if (watchQueued) {
        queryClient.invalidateQueries({ queryKey: ['watchList'] });
        // Once for the whole batch: each publish sends the full list over Bluetooth.
        publishWatchList();
      }
    },
    [queryClient, startDownload],
  );
}

/**
 * Turn auto-download on or off for one destination of one podcast.
 *
 * Turning it on forgets the previously handled episode and checks at once, so the latest
 * episode downloads now if it is not already there.
 */
export function useSetAutoDownload() {
  const queryClient = useQueryClient();
  const check = useAutoDownloadCheck();

  return useCallback(
    (podcastId: string, dest: AutoDownloadDestination, enabled: boolean) => {
      const state = getAutoDownloadState(podcastId);
      setAutoDownloadState(podcastId, { ...state, [dest]: { enabled } });
      queryClient.invalidateQueries({ queryKey: autoDownloadQueryKey(podcastId) });
      if (enabled) check([podcastId]);
    },
    [queryClient, check],
  );
}

/**
 * App-wide auto-download runner. Must render inside `DownloadProvider`.
 *
 * Checks every podcast on start and on each return to the foreground, and checks a
 * podcast again whenever its feed is fetched. The network cost is set by the feed
 * query's one-hour stale time, not here: the checks themselves read only cached episodes,
 * so running them on every foreground is what lets a check skipped for a full storage
 * limit succeed soon after room is made.
 */
export function useAutoDownload() {
  const queryClient = useQueryClient();
  const check = useAutoDownloadCheck();

  useEffect(() => {
    const checkAll = () => check(getSubscriptions().map((p) => p.id));
    checkAll();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAll();
    });
    // Any successful feed fetch — the app-wide refresh, opening a podcast, or
    // pull-to-refresh. The fetch writes the episode cache before it resolves.
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const [scope, podcastId] = event.query.queryKey;
      if (scope === 'feed' && typeof podcastId === 'string') check([podcastId]);
    });
    return () => {
      appState.remove();
      unsubscribeCache();
    };
  }, [queryClient, check]);
}
