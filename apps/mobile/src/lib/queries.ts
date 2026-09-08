import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { syncWatchEpisodes } from '@/hooks/useWearDataLayer';

import { useDownloadContext } from './download-context';
import { publishPlaybackProgress } from './playback-sync';
import { fetchFeed } from './rss';
import {
  addToDownloads,
  addToWatchList,
  getCachedEpisodes,
  getDownloadedSizeBytes,
  getDownloadItem,
  getDownloads,
  getSubscriptions,
  getWatchList,
  isOnWatchList,
  removeFromDownloads,
  removeFromWatchList,
  setCachedEpisodes,
} from './storage';
import type { DownloadStatus, Episode, Podcast } from './types';

export function useFeedQuery(podcastId: string, feedUrl: string) {
  return useQuery({
    queryKey: ['feed', podcastId],
    queryFn: async () => {
      const { episodes } = await fetchFeed(feedUrl);
      setCachedEpisodes(podcastId, episodes);
      return episodes;
    },
    initialData: () => getCachedEpisodes(podcastId) ?? undefined,
  });
}

export interface EnrichedDownloadItem {
  episodeGuid: string;
  podcastId: string;
  episode: Episode;
  podcast: Podcast | undefined;
  status: DownloadStatus;
  localPath?: string;
  progress?: number;
  /**
   * Bytes the episode audio occupies. For a completed phone download this is the
   * real file size; otherwise it is the size the feed declares, which may be
   * absent. Undefined means "unknown", and the row shows nothing.
   */
  sizeBytes?: number;
}

export function useDownloadsQuery() {
  return useQuery({
    queryKey: ['downloads'],
    queryFn: () => {
      const downloads = getDownloads();
      // Read subscriptions here rather than taking them as an argument. The query
      // key is just ['downloads'], so a caller-supplied array would be captured
      // once and then reused on every later run — a podcast subscribed to during
      // this session would be missing from it, and the join below would silently
      // yield undefined, dropping the row's artwork and podcast title.
      const subscriptions = getSubscriptions();
      const items: EnrichedDownloadItem[] = [];
      for (const di of downloads) {
        const episodes = getCachedEpisodes(di.podcastId);
        const episode = episodes?.find((e) => e.guid === di.episodeGuid);
        if (!episode) continue;
        const podcast = subscriptions.find((s) => s.id === di.podcastId);
        items.push({
          episodeGuid: di.episodeGuid,
          podcastId: di.podcastId,
          episode,
          podcast,
          status: di.status,
          localPath: di.localPath,
          sizeBytes: getDownloadedSizeBytes(di.episodeGuid) ?? episode.sizeBytes,
        });
      }
      return items;
    },
  });
}

export function useIsInDownloads(episodeGuid: string) {
  return useQuery({
    queryKey: ['downloads', 'check', episodeGuid],
    queryFn: () => {
      const item = getDownloadItem(episodeGuid);
      return item ?? null;
    },
  });
}

export function useDownloadMutations() {
  const queryClient = useQueryClient();
  const { startDownload, cancelDownload } = useDownloadContext();

  const add = useMutation({
    mutationFn: ({
      podcastId,
      episodeGuid,
      audioUrl,
    }: {
      podcastId: string;
      episodeGuid: string;
      audioUrl: string;
    }) => {
      addToDownloads(podcastId, episodeGuid);
      startDownload(audioUrl, podcastId, episodeGuid);
      return Promise.resolve();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });

  const remove = useMutation({
    mutationFn: ({ episodeGuid }: { episodeGuid: string }) => {
      cancelDownload(episodeGuid);
      removeFromDownloads(episodeGuid);
      return Promise.resolve();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });

  /**
   * Delete several downloads at once.
   *
   * One mutation rather than a loop of `remove` so the list is invalidated once at the
   * end. Looping would re-run the downloads query — which walks storage and joins every
   * cached episode — once per deleted row.
   */
  const removeMany = useMutation({
    mutationFn: ({ episodeGuids }: { episodeGuids: string[] }) => {
      for (const guid of episodeGuids) {
        cancelDownload(guid);
        removeFromDownloads(guid);
      }
      return Promise.resolve();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });

  return { add, remove, removeMany };
}

export function useWatchListQuery() {
  return useQuery({
    queryKey: ['watchList'],
    queryFn: () => {
      const list = getWatchList();
      // Read fresh, for the same reason as useDownloadsQuery above.
      const subscriptions = getSubscriptions();
      const items: EnrichedDownloadItem[] = [];
      for (const wi of list) {
        const episodes = getCachedEpisodes(wi.podcastId);
        const episode = episodes?.find((e) => e.guid === wi.episodeGuid);
        if (!episode) continue;
        const podcast = subscriptions.find((s) => s.id === wi.podcastId);
        items.push({
          episodeGuid: wi.episodeGuid,
          podcastId: wi.podcastId,
          episode,
          podcast,
          status: 'pending',
          // Feed-declared: the file lives on the watch, not here.
          sizeBytes: episode.sizeBytes,
        });
      }
      return items;
    },
  });
}

export function useIsOnWatchList(episodeGuid: string) {
  return useQuery({
    queryKey: ['watchList', 'check', episodeGuid],
    queryFn: () => isOnWatchList(episodeGuid),
  });
}

/**
 * Publish the current watch list to the paired watch.
 *
 * Module-level rather than a hook member so callers outside React state — the Data Layer
 * message listener, for one — can re-publish with a stable reference.
 */
export function publishWatchList() {
  const list = getWatchList();
  const enriched = list.flatMap((wi) => {
    const episodes = getCachedEpisodes(wi.podcastId);
    const episode = episodes?.find((e) => e.guid === wi.episodeGuid);
    if (!episode) return [];
    const podcast = getSubscriptions().find((s) => s.id === wi.podcastId);
    return [{
      guid: episode.guid,
      title: episode.title,
      podcastTitle: podcast?.title ?? '',
      podcastId: wi.podcastId,
      audioUrl: episode.audioUrl ?? '',
      duration: episode.duration ?? '',
      pubDate: episode.pubDate ?? '',
      artworkUrl: episode.imageUrl ?? podcast?.artworkUrl ?? '',
    }];
  });
  syncWatchEpisodes(enriched).catch(() => {});
  // The list just changed, so the set of episodes the watch cares about did too. An
  // episode queued after being half-listened to on the phone should arrive with that
  // position, not start from zero.
  publishPlaybackProgress({ immediate: true });
}

export function useWatchListMutations() {
  const queryClient = useQueryClient();

  const triggerSync = publishWatchList;

  const add = useMutation({
    mutationFn: ({ podcastId, episodeGuid }: { podcastId: string; episodeGuid: string }) => {
      addToWatchList(podcastId, episodeGuid);
      return Promise.resolve();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchList'] });
      triggerSync();
    },
  });

  const remove = useMutation({
    mutationFn: ({ episodeGuid }: { episodeGuid: string }) => {
      removeFromWatchList(episodeGuid);
      return Promise.resolve();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchList'] });
      triggerSync();
    },
  });

  /**
   * Remove several episodes from the watch queue at once.
   *
   * The batching matters more here than anywhere else: `triggerSync` publishes the whole
   * list as a DataItem over the Bluetooth companion link, so a loop of single removes
   * would push the same list ten times to delete ten episodes. Storage is mutated once
   * per episode, then published once at the end.
   */
  const removeMany = useMutation({
    mutationFn: ({ episodeGuids }: { episodeGuids: string[] }) => {
      for (const guid of episodeGuids) removeFromWatchList(guid);
      return Promise.resolve();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchList'] });
      triggerSync();
    },
  });

  return { add, remove, removeMany, triggerSync };
}
