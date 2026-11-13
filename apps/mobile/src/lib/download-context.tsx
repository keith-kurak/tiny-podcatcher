import { useQueryClient } from '@tanstack/react-query';
import { addNetworkStateListener, NetworkStateType, useNetworkState } from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { pruneAutoDownloadsAfterCompletion } from './auto-prune';
import {
  addDownloadStatusListener,
  cancelEpisodeDownload,
  downloadEpisode,
  isDownloadInFlight,
} from './episode-download';
import {
  getCachedEpisodes,
  getDownloads,
  getWifiOnlyDownloads,
  updateDownloadItem,
} from './storage';

interface DownloadContextValue {
  startDownload: (audioUrl: string, podcastId: string, episodeGuid: string) => void;
  cancelDownload: (episodeGuid: string) => void;
  getProgress: (episodeGuid: string) => number | undefined;
  /**
   * True when Wi-Fi-only downloads are on and this phone is not on an unmetered
   * network. Queued episodes hold rather than spend cellular data.
   */
  isWaitingForWifi: boolean;
  /**
   * Start every queued download that is currently allowed to run. Called when an
   * unmetered network arrives, and by Settings when the Wi-Fi-only switch is turned
   * off — otherwise held episodes would sit there until something else nudged them.
   */
  drainPendingDownloads: () => void;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const networkState = useNetworkState();

  // Treat an unknown network type as metered. Guessing "probably Wi-Fi" would be
  // the expensive way to be wrong.
  const isUnmetered = networkState.type === NetworkStateType.WIFI ||
    networkState.type === NetworkStateType.ETHERNET;
  const isWaitingForWifi = getWifiOnlyDownloads() && !isUnmetered;

  // Every status change re-reads storage, including downloads the background task
  // runs while the app is open.
  useEffect(
    () =>
      addDownloadStatusListener(() => {
        queryClient.invalidateQueries({ queryKey: ['downloads'] });
      }),
    [queryClient],
  );

  const clearProgress = useCallback((episodeGuid: string) => {
    setProgressMap((prev) => {
      if (!prev.has(episodeGuid)) return prev;
      const next = new Map(prev);
      next.delete(episodeGuid);
      return next;
    });
  }, []);

  const startDownload = useCallback(
    async (audioUrl: string, podcastId: string, episodeGuid: string) => {
      const outcome = await downloadEpisode(audioUrl, podcastId, episodeGuid, (fraction) => {
        setProgressMap((prev) => {
          const next = new Map(prev);
          next.set(episodeGuid, fraction);
          return next;
        });
      });
      if (outcome === 'complete' || outcome === 'error') clearProgress(episodeGuid);
      if (outcome === 'complete') pruneAutoDownloadsAfterCompletion(episodeGuid);
    },
    [clearProgress],
  );

  const cancelDownload = useCallback(
    (episodeGuid: string) => {
      cancelEpisodeDownload(episodeGuid);
      clearProgress(episodeGuid);
    },
    [clearProgress],
  );

  const getProgress = useCallback(
    (episodeGuid: string) => progressMap.get(episodeGuid),
    [progressMap],
  );

  // Mark downloads that were cut off mid-transfer as errored. 'pending' is left
  // alone: with Wi-Fi-only downloads it is a legitimate resting state, not a
  // sign that something died. A download still running in this runtime — the
  // background task started it before the UI mounted — was not cut off.
  useEffect(() => {
    const items = getDownloads();
    for (const item of items) {
      if (item.status === 'downloading' && !isDownloadInFlight(item.episodeGuid)) {
        updateDownloadItem(item.episodeGuid, { status: 'error' });
      }
    }
  }, []);

  /** Start every queued download that is currently allowed to run. */
  const drainPendingDownloads = useCallback(() => {
    for (const item of getDownloads()) {
      if (item.status !== 'pending') continue;
      const episode = getCachedEpisodes(item.podcastId)?.find(
        (e) => e.guid === item.episodeGuid,
      );
      if (episode?.audioUrl) {
        startDownload(episode.audioUrl, item.podcastId, item.episodeGuid);
      }
    }
  }, [startDownload]);

  // Drain when an unmetered network arrives. Driven from the subscription callback
  // rather than an effect body: this reacts to an external system rather than
  // synchronising React state, and starting a download writes state immediately.
  useEffect(() => {
    const subscription = addNetworkStateListener((event) => {
      const unmetered =
        event.type === NetworkStateType.WIFI || event.type === NetworkStateType.ETHERNET;
      if (unmetered) drainPendingDownloads();
    });
    return () => subscription.remove();
  }, [drainPendingDownloads]);

  return (
    <DownloadContext.Provider
      value={{
        startDownload,
        cancelDownload,
        getProgress,
        isWaitingForWifi,
        drainPendingDownloads,
      }}>
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownloadContext() {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error('useDownloadContext must be used within DownloadProvider');
  return ctx;
}
