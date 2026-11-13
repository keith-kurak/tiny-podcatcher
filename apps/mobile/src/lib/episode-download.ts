import { DownloadTask, File } from 'expo-file-system';
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';

import { HTTP_HEADERS } from './http';
import { logPhoneDownloadCompleted } from './observe';
import { episodesDir, getDownloadPath, getWifiOnlyDownloads, updateDownloadItem } from './storage';

/**
 * Downloads running in this JS runtime, by episode guid.
 *
 * Module-level rather than inside `DownloadProvider`, because the background task can
 * run in the same runtime as the UI. Both must see the same set, or the UI would mark a
 * background download as interrupted, or start a second copy of it.
 */
const inFlight = new Map<string, DownloadTask>();

/** Told when a download changes status, so the UI can re-read storage. */
const statusListeners = new Set<() => void>();

export function addDownloadStatusListener(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function notifyStatus() {
  for (const listener of statusListeners) listener();
}

/** Tell listeners the stored downloads changed for a reason other than a download, such as pruning. */
export function notifyDownloadsChanged(): void {
  notifyStatus();
}

export function isDownloadInFlight(episodeGuid: string): boolean {
  return inFlight.has(episodeGuid);
}

/**
 * True when Wi-Fi-only downloads are on and the phone is not on an unmetered network.
 *
 * An unknown network type counts as metered. Guessing "probably Wi-Fi" would be the
 * expensive way to be wrong.
 */
export async function isDownloadBlockedByNetwork(): Promise<boolean> {
  if (!getWifiOnlyDownloads()) return false;
  const state = await getNetworkStateAsync();
  return !(state.type === NetworkStateType.WIFI || state.type === NetworkStateType.ETHERNET);
}

export type DownloadOutcome = 'complete' | 'error' | 'blocked' | 'already-running';

/**
 * Download one episode's audio to its fixed path, and record the result in storage.
 *
 * `blocked` leaves the item `pending`: with Wi-Fi-only downloads on, waiting is a normal
 * state, and the queue is drained again when Wi-Fi returns.
 */
export async function downloadEpisode(
  audioUrl: string,
  podcastId: string,
  episodeGuid: string,
  onProgress?: (fraction: number) => void,
): Promise<DownloadOutcome> {
  if (inFlight.has(episodeGuid)) return 'already-running';
  if (await isDownloadBlockedByNetwork()) {
    notifyStatus();
    return 'blocked';
  }

  if (!episodesDir.exists) episodesDir.create();

  const localPath = getDownloadPath(episodeGuid);
  const task = new DownloadTask(audioUrl, new File(localPath), {
    headers: HTTP_HEADERS,
    onProgress: onProgress
      ? (progress) =>
          onProgress(progress.totalBytes > 0 ? progress.bytesWritten / progress.totalBytes : 0)
      : undefined,
  });
  inFlight.set(episodeGuid, task);

  updateDownloadItem(episodeGuid, { status: 'downloading' });
  notifyStatus();
  const startedAt = Date.now();

  try {
    await task.downloadAsync();
    updateDownloadItem(episodeGuid, { status: 'complete', localPath });
    logPhoneDownloadCompleted({ podcastId, episodeGuid, durationMs: Date.now() - startedAt });
    return 'complete';
  } catch {
    updateDownloadItem(episodeGuid, { status: 'error' });
    return 'error';
  } finally {
    inFlight.delete(episodeGuid);
    notifyStatus();
  }
}

export function cancelEpisodeDownload(episodeGuid: string): void {
  const task = inFlight.get(episodeGuid);
  if (!task) return;
  task.cancel();
  inFlight.delete(episodeGuid);
}
