import { useSyncExternalStore } from 'react';

import { playedStatusOf, type PlayedStatus } from '@/lib/played-state';
import { getPlaybackProgress, subscribePlaybackProgress } from '@/lib/storage';

/**
 * An episode's played status, kept current as its saved position changes.
 *
 * The snapshot is rounded to what a row can show — the state, the listened share in
 * eighths (the pie has no finer steps), and whole minutes left. The position is saved
 * every few seconds while playing and every subscribed row is told; rounding means only
 * the row whose display actually changed re-renders.
 */
export function usePlayedStatus(episodeGuid: string): PlayedStatus {
  const snapshot = useSyncExternalStore(subscribePlaybackProgress, () => {
    const status = playedStatusOf(getPlaybackProgress(episodeGuid));
    const eighths = Math.round(status.fraction * 8);
    const minutes = Math.ceil(status.remainingSeconds / 60);
    return `${status.state}|${eighths}|${minutes}`;
  });

  const [state, eighths, minutes] = snapshot.split('|');
  return {
    state: state as PlayedStatus['state'],
    fraction: Number(eighths) / 8,
    remainingSeconds: Number(minutes) * 60,
  };
}
